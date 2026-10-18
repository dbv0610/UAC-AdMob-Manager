import { and, desc, eq, like } from 'drizzle-orm';
import PQueue from 'p-queue';
import log from 'electron-log/main';
import { db } from '../db';
import { apps, campaigns, plans } from '../db/schema';
import { broadcast } from '../events';
import { UserFacingError } from '../ipc/register';
import type { JobContext } from '../jobs/queue';
import { getJson, getPrefs, setJson } from './settingsStore';
import { addUsage } from './quota';
import { assertOnline, customerById, withRetry, wrapAdsError } from './googleAds/client';
import { existingCampaigns, mutateCountry, resolveVideoAssets } from './googleAds/campaignBuilder';
import { renderName, type Plan, type PlanDraft, type PlanRecord, type RowResult, type ValidateResult } from '@shared/plan';
import type { AppMapping } from '@shared/types';

// ── Bản nháp wizard: lưu liên tục, mở lại app vẫn còn ───────────────────────
export const getDraft = () => getJson<PlanDraft>('planDraft');
export const saveDraft = (d: PlanDraft | null) => setJson('planDraft', d);

// ── Lịch sử kế hoạch (bảng plans, mỗi lần Tạo là một version) ──────────────
type Stored = Omit<PlanRecord, 'id' | 'version' | 'createdAt'>;

function toRecord(r: typeof plans.$inferSelect): PlanRecord {
  return { ...(JSON.parse(r.json) as Stored), id: r.id, version: r.version, createdAt: r.createdAt };
}

export function listPlans(limit = 100): PlanRecord[] {
  // Bản mới nhất của mỗi kế hoạch
  const rows = db.select().from(plans).orderBy(desc(plans.createdAt), desc(plans.version)).limit(limit * 3).all();
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, limit).map(toRecord);
}

export function getPlan(id: string): PlanRecord {
  const r = db.select().from(plans).where(eq(plans.id, id)).orderBy(desc(plans.version)).limit(1).get();
  if (!r) throw new UserFacingError({ message: 'Không tìm thấy kế hoạch', code: 'NOT_FOUND' });
  return toRecord(r);
}

function saveRecord(rec: PlanRecord) {
  const { id, version, createdAt: _c, ...rest } = rec;
  db.update(plans).set({ json: JSON.stringify(rest) }).where(and(eq(plans.id, id), eq(plans.version, version))).run();
  broadcast({ type: 'plan', plan: rec });
}

function appOf(appId: string): AppMapping {
  const a = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!a) throw new UserFacingError({ message: 'App không còn trong danh sách — chọn lại app', code: 'NOT_FOUND', field: 'appId', action: 'fix' });
  return a;
}

// Số thứ tự trong ngày: đếm camp đã tạo hôm nay cùng tiền tố, để tên không trùng giữa các lần chạy
function nextSeq(app: AppMapping, plan: Plan) {
  const probe = renderName(getPrefs().nameTemplate, { app: app.name, store: app.store, geo: plan.rows[0].countryCode, goal: plan.rows[0].goal, date: new Date(), seq: 0 });
  const prefix = probe.split(plan.rows[0].countryCode)[0];
  const day = new Date().toISOString().slice(0, 10);
  const today = db.select().from(campaigns).where(like(campaigns.name, `${prefix}%`)).all().filter((c) => c.createdAt.startsWith(day));
  const seqs = today.map((c) => Number(c.name.match(/_(\d{2,})$/)?.[1] ?? 0));
  return Math.max(0, ...seqs) + 1;
}

export function namesFor(plan: Plan, app: AppMapping, seq: number) {
  const template = getPrefs().nameTemplate;
  const date = new Date();
  return Object.fromEntries(
    plan.rows.map((r) => [r.countryCode, renderName(template, { app: app.name, store: app.store, geo: r.countryCode, goal: r.goal, date, seq })]),
  );
}

export function previewNames(plan: Plan) {
  const app = appOf(plan.appId);
  return namesFor(plan, app, nextSeq(app, plan));
}

// ── Chạy từng quốc gia, tối đa 2 mutate đồng thời mỗi customer ─────────────
async function runCountries(
  plan: Plan,
  names: Record<string, string>,
  codes: string[],
  validateOnly: boolean,
  ctx: JobContext,
  onRow: (code: string, r: RowResult) => void,
) {
  assertOnline();
  const app = appOf(plan.appId);
  const { customer, row: cust } = customerById(plan.customerId);
  let done = 0;
  ctx.progress(0, codes.length);

  let existing: Map<string, string>;
  try {
    existing = await existingCampaigns(customer, codes.map((c) => names[c]));
  } catch (err) {
    throw wrapAdsError(cust.accountId, err);
  }

  const pq = new PQueue({ concurrency: 2 });
  await pq.addAll(
    codes.map((code) => async () => {
      const row = plan.rows.find((r) => r.countryCode === code)!;
      const name = names[code];
      try {
        if (existing.has(name)) {
          onRow(code, { state: 'exists', name, campaignId: existing.get(name) });
          return;
        }
        if (!validateOnly) onRow(code, { state: 'running', name });
        const videoAssets = await withRetry(() => resolveVideoAssets(customer, plan.customerId, row.videoIds));
        const res = await withRetry(
          () => mutateCountry(customer, { customerId: plan.customerId, appStoreId: app.storeAppId, store: app.store, name, row, videoAssets }, validateOnly),
          (attempt, wait) => log.info(`[plan] ${code} retry ${attempt} sau ${wait}ms`),
        );
        addUsage('ads.operations', res.opCount);
        if (res.ok) {
          onRow(code, { state: 'done', name, campaignId: res.campaignId });
          if (!validateOnly && res.campaignId) {
            db.insert(campaigns)
              .values({ id: res.campaignId, planId: plan.id, customerId: plan.customerId, name, country: code, goal: row.goal, status: 'PAUSED' })
              .onConflictDoNothing()
              .run();
          }
        } else {
          onRow(code, { state: 'failed', name, errors: res.errors, requestId: res.requestId });
        }
      } catch (err) {
        const info = wrapAdsError(cust.accountId, err);
        const e = info as Error & { info?: { message: string; code?: string; requestId?: string; action?: string } };
        if (e.info?.action === 'reauth') throw err; // cả kế hoạch dừng, banner đăng nhập lại
        onRow(code, { state: 'failed', name, errors: [{ field: '', message: e.info?.message ?? e.message, code: e.info?.code }], requestId: e.info?.requestId });
      } finally {
        ctx.progress(++done, codes.length);
      }
    }),
  );
}

// Lớp 3: validate_only — Google kiểm tra chính sách, asset, trùng tên mà không tạo gì
export async function validatePlan(plan: Plan, ctx: JobContext): Promise<ValidateResult> {
  const names = previewNames(plan);
  const rows: Record<string, RowResult> = {};
  await runCountries(plan, names, plan.rows.map((r) => r.countryCode), true, ctx, (code, r) => (rows[code] = r));
  return { ok: Object.values(rows).every((r) => r.state !== 'failed'), rows };
}

export function startPlan(plan: Plan): PlanRecord {
  const app = appOf(plan.appId);
  const prev = db.select().from(plans).where(eq(plans.id, plan.id)).orderBy(desc(plans.version)).limit(1).get();
  // Kế hoạch đã chạy rồi thì giữ nguyên tên cũ để chống trùng hoạt động đúng
  const prevNames = prev ? Object.fromEntries(Object.entries(toRecord(prev).results).map(([k, v]) => [k, v.name])) : {};
  const fresh = namesFor(plan, app, nextSeq(app, plan));
  const names = { ...fresh, ...prevNames };
  const results = Object.fromEntries(plan.rows.map((r) => [r.countryCode, { state: 'pending', name: names[r.countryCode] } as RowResult]));
  const stored: Stored = { appId: plan.appId, appName: app.name, customerId: plan.customerId, rows: plan.rows, results };
  const version = (prev?.version ?? 0) + 1;
  const row = db.insert(plans).values({ id: plan.id, appId: plan.appId, version, json: JSON.stringify(stored) }).returning().get();
  return toRecord(row);
}

export async function executePlan(rec: PlanRecord, codes: string[], ctx: JobContext) {
  const plan: Plan = { id: rec.id, appId: rec.appId, customerId: rec.customerId, rows: rec.rows };
  const names = Object.fromEntries(Object.entries(rec.results).map(([k, v]) => [k, v.name]));
  for (const c of codes) rec.results[c] = { state: 'pending', name: names[c] };
  saveRecord(rec);
  await runCountries(plan, names, codes, false, ctx, (code, r) => {
    rec.results[code] = r;
    saveRecord(rec);
  });
  const failed = codes.filter((c) => rec.results[c].state === 'failed');
  if (failed.length) {
    ctx.fail({ message: `${codes.length - failed.length}/${codes.length} quốc gia thành công · lỗi: ${failed.join(', ')}`, action: 'retry', code: 'PARTIAL' });
  }
}
