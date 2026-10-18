import { randomUUID } from 'node:crypto';
import { Notification, BrowserWindow, net } from 'electron';
import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import log from 'electron-log/main';
import { db } from '../db';
import { adsCustomers, apps, auditLog, campaignMeta, revenueDaily, ruleSuggestions, rules, spendDaily } from '../db/schema';
import { broadcast } from '../events';
import { UserFacingError } from '../ipc/register';
import type { JobContext } from '../jobs/queue';
import { applyChanges } from './googleAds/campaigns';
import { addDays, isoDate } from '@shared/analytics';
import { evaluateRule, RuleSchema, type Fmt, type Rule, type RuleCampaign, type RuleHistory, type RuleTestResult, type RuleWithMeta, type Skipped, type Suggestion, type SuggestionRow } from '@shared/rules';
import type { CampaignChange } from '@shared/types';

// Rule chạy sau mỗi lần đồng bộ báo cáo, trên số liệu SQLite. SUGGEST → hàng chờ duyệt; AUTO → ghi luôn,
// mọi thay đổi ghi audit_log với actor `rule:<id>` (dùng cho cooldown và giới hạn số lần/tuần).

// ── CRUD rule ───────────────────────────────────────────────────────────────
export function listRules(): RuleWithMeta[] {
  return db.select().from(rules).all().map((r) => ({ ...(JSON.parse(r.json) as Rule), enabled: r.enabled, lastRunAt: r.lastRunAt }));
}

export function saveRule(input: Rule) {
  const rule = RuleSchema.parse(input);
  const row = { id: rule.id, name: rule.name, json: JSON.stringify(rule), enabled: rule.enabled };
  db.insert(rules).values(row).onConflictDoUpdate({ target: rules.id, set: row }).run();
  return rule;
}

export function removeRule(id: string) {
  db.delete(rules).where(eq(rules.id, id)).run();
  db.update(ruleSuggestions).set({ status: 'expired', decidedAt: new Date().toISOString() }).where(and(eq(ruleSuggestions.ruleId, id), eq(ruleSuggestions.status, 'pending'))).run();
  emitCount();
}

// ── Số liệu theo camp ───────────────────────────────────────────────────────
const currencyOf = (customerId: string) => db.select({ c: adsCustomers.currency }).from(adsCustomers).where(eq(adsCustomers.customerId, customerId)).get()?.c ?? 'USD';

export const fmtFor = (currency: string): Fmt => ({
  money: (v) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(v),
  pct: (v) => new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 }).format(v),
  num: (v) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(v),
});

// Doanh thu AdMob tính theo (app, nước); chia cho từng camp theo tỉ lệ chi phí trong ngày của nước đó.
export function loadRuleCampaigns(today = isoDate(new Date())): RuleCampaign[] {
  const from = addDays(today, -15);
  const appRows = db.select().from(apps).all();
  const byStore = new Map(appRows.map((a) => [a.storeAppId, a]));
  const spend = db.select().from(spendDaily).where(gte(spendDaily.date, from)).all();
  const admobIds = appRows.map((a) => a.admobAppId).filter((x): x is string => !!x);
  const rev = admobIds.length ? db.select().from(revenueDaily).where(and(gte(revenueDaily.date, from), inArray(revenueDaily.admobAppId, admobIds))).all() : [];

  const revKey = (date: string, admob: string, country: string, cur: string) => `${date}|${admob}|${country}|${cur}`;
  const revenue = new Map<string, number>();
  for (const r of rev) revenue.set(revKey(r.date, r.admobAppId, r.country, r.currency), (revenue.get(revKey(r.date, r.admobAppId, r.country, r.currency)) ?? 0) + r.earningsMicros / 1e6);
  const totalKey = (date: string, store: string, country: string) => `${date}|${store}|${country}`;
  const totals = new Map<string, number>();
  for (const s of spend) totals.set(totalKey(s.date, s.appId, s.country), (totals.get(totalKey(s.date, s.appId, s.country)) ?? 0) + s.costMicros);

  const byCamp = new Map<string, { days: Map<string, { spend: number; installs: number; revenue: number }>; countrySpend: Map<string, number> }>();
  for (const s of spend) {
    const c = byCamp.get(s.campaignId) ?? { days: new Map(), countrySpend: new Map() };
    const d = c.days.get(s.date) ?? { spend: 0, installs: 0, revenue: 0 };
    const app = byStore.get(s.appId);
    const total = totals.get(totalKey(s.date, s.appId, s.country)) ?? 0;
    const appRev = app?.admobAppId ? (revenue.get(revKey(s.date, app.admobAppId, s.country, s.currency)) ?? 0) : 0;
    d.spend += s.costMicros / 1e6;
    d.installs += s.installs;
    d.revenue += total > 0 ? (appRev * s.costMicros) / total : 0;
    c.days.set(s.date, d);
    c.countrySpend.set(s.country, (c.countrySpend.get(s.country) ?? 0) + s.costMicros);
    byCamp.set(s.campaignId, c);
  }

  return db
    .select()
    .from(campaignMeta)
    .all()
    .filter((m) => m.status !== 'REMOVED')
    .map((m) => {
      const c = byCamp.get(m.campaignId);
      // Nước của camp = nước chi tiêu nhiều nhất (App campaign của app tạo thường 1 nước)
      const country = c ? ([...c.countrySpend].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : (m.name.match(/_([A-Z]{2})(?=_|$)/)?.[1] ?? null);
      return {
        campaignId: m.campaignId,
        customerId: m.customerId,
        name: m.name,
        appId: m.appId ? (byStore.get(m.appId)?.id ?? null) : null,
        country,
        status: m.status ?? 'UNKNOWN',
        budgetMicros: m.budgetMicros,
        budgetResource: m.budgetResource,
        budgetShared: !!m.budgetShared,
        targetCpaMicros: m.targetCpaMicros,
        targetRoas: m.targetRoas,
        days: c ? [...c.days].map(([date, d]) => ({ date, ...d })) : [],
      };
    });
}

function ruleHistory(): RuleHistory[] {
  const since = new Date(Date.now() - 31 * 24 * 3600_000).toISOString();
  return db
    .select({ actor: auditLog.actor, entityId: auditLog.entityId, at: auditLog.at })
    .from(auditLog)
    .where(and(like(auditLog.actor, 'rule:%'), gte(auditLog.at, since)))
    .all()
    .map((h) => ({ ruleId: h.actor.slice(5), campaignId: h.entityId, at: h.at }));
}

// ── Chạy thử / chạy thật ────────────────────────────────────────────────────
export function testRule(input: Rule): RuleTestResult {
  const rule = RuleSchema.parse(input);
  const camps = loadRuleCampaigns();
  const cur = camps[0] ? currencyOf(camps[0].customerId) : 'USD';
  const r = evaluateRule(rule, camps, ruleHistory(), new Date(), fmtFor(cur));
  return { ...r, campaigns: camps.length, currency: cur };
}

export async function runRules(ctx?: JobContext) {
  const all = listRules().filter((r) => r.enabled);
  if (!all.length) return { suggested: 0, applied: 0, failed: 0, skipped: [] as Skipped[] };
  const camps = loadRuleCampaigns();
  const history = ruleHistory();
  const now = new Date();
  const pending = db.select().from(ruleSuggestions).where(eq(ruleSuggestions.status, 'pending')).all();
  let suggested = 0, applied = 0, failed = 0;
  const skippedAll: Skipped[] = [];

  for (const [i, rule] of all.entries()) {
    ctx?.progress(i, all.length);
    // Định dạng theo tiền tệ của từng customer
    const byCustomer = new Map<string, RuleCampaign[]>();
    for (const c of camps) byCustomer.set(c.customerId, [...(byCustomer.get(c.customerId) ?? []), c]);
    const found: Suggestion[] = [];
    for (const [cid, list] of byCustomer) {
      const r = evaluateRule(rule, list, history, now, fmtFor(currencyOf(cid)));
      found.push(...r.suggestions);
      skippedAll.push(...r.skipped);
    }

    // Đề xuất cũ không còn khớp điều kiện → hết hạn; đề xuất trùng (rule, camp) đang chờ → giữ cái cũ
    const mineOld = pending.filter((p) => p.ruleId === rule.id);
    const stale = mineOld.filter((p) => !found.some((s) => s.campaignId === p.campaignId)).map((p) => p.id);
    if (stale.length) db.update(ruleSuggestions).set({ status: 'expired', decidedAt: now.toISOString() }).where(inArray(ruleSuggestions.id, stale)).run();
    const fresh = found.filter((s) => !mineOld.some((p) => p.campaignId === s.campaignId));

    if (rule.mode === 'SUGGEST' || !net.isOnline()) {
      for (const s of fresh) insertSuggestion(s, 'pending');
      suggested += fresh.length;
      continue;
    }
    // AUTO: ghi theo từng customer; lỗi một customer không chặn customer khác
    const groups = new Map<string, Suggestion[]>();
    for (const s of fresh) groups.set(s.customerId, [...(groups.get(s.customerId) ?? []), s]);
    for (const [cid, list] of groups) {
      try {
        await applyChanges(cid, list.map((s) => s.change), `rule:${rule.id}`);
        for (const s of list) insertSuggestion(s, 'applied');
        applied += list.length;
      } catch (err) {
        log.warn(`[rules] AUTO ${rule.name} lỗi ở ${cid}`, err);
        for (const s of list) insertSuggestion(s, 'failed', (err as Error).message);
        failed += list.length;
      }
    }
  }
  db.update(rules).set({ lastRunAt: now.toISOString() }).where(inArray(rules.id, all.map((r) => r.id))).run();
  ctx?.progress(all.length, all.length);
  emitCount();
  if ((suggested || applied) && Notification.isSupported()) {
    const n = new Notification({
      title: 'Rules',
      body: [suggested && `${suggested} đề xuất chờ duyệt`, applied && `${applied} thay đổi đã tự áp dụng`, failed && `${failed} lỗi`].filter(Boolean).join(' · '),
    });
    n.on('click', () => {
      BrowserWindow.getAllWindows()[0]?.show();
      broadcast({ type: 'navigate', to: '/rules' });
    });
    n.show();
  }
  return { suggested, applied, failed, skipped: skippedAll };
}

function insertSuggestion(s: Suggestion, status: SuggestionRow['status'], error?: string) {
  db.insert(ruleSuggestions)
    .values({
      id: randomUUID(),
      ruleId: s.ruleId,
      customerId: s.customerId,
      campaignId: s.campaignId,
      json: JSON.stringify(s),
      status,
      error: error ?? null,
      decidedAt: status === 'pending' ? null : new Date().toISOString(),
    })
    .run();
}

// ── Hàng chờ duyệt ──────────────────────────────────────────────────────────
export function listSuggestions(scope: 'pending' | 'history'): SuggestionRow[] {
  const q = db.select().from(ruleSuggestions);
  const rows = (scope === 'pending' ? q.where(eq(ruleSuggestions.status, 'pending')) : q).orderBy(desc(ruleSuggestions.createdAt)).limit(300).all();
  return rows
    .filter((r) => scope === 'pending' || r.status !== 'pending')
    .map((r) => ({ ...(JSON.parse(r.json) as Suggestion), id: r.id, status: r.status, error: r.error, createdAt: r.createdAt, decidedAt: r.decidedAt, currency: currencyOf(r.customerId) }));
}

export const pendingCount = () => db.select({ id: ruleSuggestions.id }).from(ruleSuggestions).where(eq(ruleSuggestions.status, 'pending')).all().length;
export function emitCount() {
  broadcast({ type: 'suggestions', pending: pendingCount() });
}

// Giá trị hiện tại (sau lần đồng bộ gần nhất) khác "trước" lúc đề xuất → có người đã sửa tay, không ghi đè
function stillValid(ch: CampaignChange) {
  const m = db.select().from(campaignMeta).where(eq(campaignMeta.campaignId, ch.campaignId)).get();
  if (!m) return true;
  const cur = ch.field === 'status' ? m.status : ch.field === 'budget' ? m.budgetMicros : ch.field === 'targetCpa' ? m.targetCpaMicros : m.targetRoas;
  return cur == null || String(cur) === String(ch.before);
}

export async function approveSuggestions(ids: string[]) {
  const rows = db.select().from(ruleSuggestions).where(and(inArray(ruleSuggestions.id, ids), eq(ruleSuggestions.status, 'pending'))).all();
  if (!rows.length) throw new UserFacingError({ message: 'Đề xuất đã được xử lý hoặc hết hạn', code: 'NOT_PENDING', action: 'retry' });
  const now = new Date().toISOString();
  let applied = 0;
  const failed: string[] = [];
  // Gộp theo (customer, rule) để audit_log ghi đúng actor của từng rule
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.customerId}|${r.ruleId}`, [...(groups.get(`${r.customerId}|${r.ruleId}`) ?? []), r]);
  for (const [key, list] of groups) {
    const [cid, ruleId] = key.split('|');
    const ok = list.filter((r) => stillValid((JSON.parse(r.json) as Suggestion).change));
    const changed = list.filter((r) => !ok.includes(r));
    for (const r of changed) {
      db.update(ruleSuggestions).set({ status: 'failed', error: 'Giá trị đã thay đổi kể từ lúc đề xuất — đồng bộ lại để rule tính lại', decidedAt: now }).where(eq(ruleSuggestions.id, r.id)).run();
      failed.push(r.id);
    }
    if (!ok.length) continue;
    try {
      await applyChanges(cid, ok.map((r) => (JSON.parse(r.json) as Suggestion).change), `rule:${ruleId}`);
      db.update(ruleSuggestions).set({ status: 'applied', decidedAt: now }).where(inArray(ruleSuggestions.id, ok.map((r) => r.id))).run();
      // Cập nhật bản sao cục bộ để lần đánh giá sau thấy giá trị mới
      for (const r of ok) {
        const ch = (JSON.parse(r.json) as Suggestion).change;
        const set = ch.field === 'status' ? { status: String(ch.after) } : ch.field === 'budget' ? { budgetMicros: Number(ch.after) } : ch.field === 'targetCpa' ? { targetCpaMicros: Number(ch.after) } : { targetRoas: Number(ch.after) };
        db.update(campaignMeta).set(set).where(eq(campaignMeta.campaignId, ch.campaignId)).run();
      }
      applied += ok.length;
    } catch (err) {
      const msg = (err as Error).message;
      db.update(ruleSuggestions).set({ status: 'failed', error: msg, decidedAt: now }).where(inArray(ruleSuggestions.id, ok.map((r) => r.id))).run();
      failed.push(...ok.map((r) => r.id));
      emitCount();
      throw err;
    }
  }
  emitCount();
  return { applied, failed: failed.length };
}

export function dismissSuggestions(ids: string[]) {
  db.update(ruleSuggestions).set({ status: 'dismissed', decidedAt: new Date().toISOString() }).where(and(inArray(ruleSuggestions.id, ids), eq(ruleSuggestions.status, 'pending'))).run();
  emitCount();
}
