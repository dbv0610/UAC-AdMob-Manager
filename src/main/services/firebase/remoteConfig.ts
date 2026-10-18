import { eq } from 'drizzle-orm';
import log from 'electron-log/main';
import { db } from '../../db';
import { accounts, auditLog } from '../../db/schema';
import { UserFacingError, toAppError } from '../../ipc/register';
import type { JobContext } from '../../jobs/queue';
import { listAccounts } from '../auth/accounts';
import { assertOnline } from '../googleAds/client';
import { FB_BASE, RC_BASE, fbRequest, wrapRcError } from './client';
import {
  applyChanges,
  diffTemplates,
  planReplace,
  type ApplyReplaceRequest,
  type RcApp,
  type RcFetched,
  type RcProject,
  type RcTemplate,
  type RcVersion,
  type ReplacePlan,
  type ReplaceQuery,
} from '@shared/remoteConfig';

// ── Danh mục project + app (lưu ở accounts.meta như AdMob / YouTube) ────────
interface FbProject {
  projectId: string;
  displayName?: string;
  projectNumber?: string;
}
interface FbApp {
  appId: string;
  displayName?: string;
  packageName?: string;
  bundleId?: string;
  appStoreId?: string;
}

async function pages<T>(accountId: string, url: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fbRequest<Record<string, unknown>>(accountId, { url: `${url}${sep}pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}` });
    out.push(...((res.data[key] as T[]) ?? []));
    token = (res.data.nextPageToken as string) || undefined;
  } while (token);
  return out;
}

export async function syncFirebase(accountId: string) {
  try {
    const projects = await pages<FbProject>(accountId, `${FB_BASE}/projects`, 'results');
    const out: RcProject[] = [];
    for (const p of projects) {
      // App Android / iOS để dựng điều kiện app.id và map với app đã có
      const [android, ios] = await Promise.all([
        pages<FbApp>(accountId, `${FB_BASE}/projects/${p.projectId}/androidApps`, 'apps').catch(() => []),
        pages<FbApp>(accountId, `${FB_BASE}/projects/${p.projectId}/iosApps`, 'apps').catch(() => []),
      ]);
      const apps: RcApp[] = [
        ...android.map((a) => ({ appId: a.appId, platform: 'ANDROID' as const, displayName: a.displayName || a.packageName || a.appId, packageName: a.packageName ?? null, appStoreId: null })),
        ...ios.map((a) => ({ appId: a.appId, platform: 'IOS' as const, displayName: a.displayName || a.bundleId || a.appId, packageName: a.bundleId ?? null, appStoreId: a.appStoreId ?? null })),
      ];
      out.push({ projectId: p.projectId, displayName: p.displayName || p.projectId, projectNumber: p.projectNumber ?? '', accountId, apps });
    }
    db.update(accounts).set({ meta: JSON.stringify({ projects: out }) }).where(eq(accounts.id, accountId)).run();
  } catch (err) {
    throw wrapRcError(accountId, null, err);
  }
}

// Mỗi (tài khoản, project) một dòng: cùng project có thể đọc qua nhiều tài khoản Firebase
export function listFirebaseProjects(): RcProject[] {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.kind, 'firebase'))
    .all()
    .filter((a) => a.status === 'active')
    .flatMap((a) => (a.meta ? ((JSON.parse(a.meta).projects ?? []) as RcProject[]) : []))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// Tài khoản Firebase thấy được project (ưu tiên tài khoản đang active)
export function accountForProject(projectId: string) {
  const p = listFirebaseProjects().find((x) => x.projectId === projectId);
  if (!p) throw new UserFacingError({ message: `Chưa có project ${projectId} trong danh mục — đăng nhập Firebase hoặc bấm Làm mới`, code: 'NO_FIREBASE_PROJECT', action: 'openSettings' });
  return p.accountId;
}

// ── Template ────────────────────────────────────────────────────────────────
const rcUrl = (projectId: string, suffix = '') => `${RC_BASE}/projects/${projectId}/remoteConfig${suffix}`;

export async function getTemplate(accountId: string, projectId: string): Promise<RcFetched> {
  try {
    const res = await fbRequest<RcTemplate>(accountId, { url: rcUrl(projectId) });
    if (!res.etag) throw new Error('Firebase không trả ETag');
    return { projectId, template: res.data, etag: res.etag, fetchedAt: new Date().toISOString() };
  } catch (err) {
    throw wrapRcError(accountId, projectId, err);
  }
}

// Bỏ phần version (Firebase tự đặt) và gắn mô tả cho lần publish
function forPublish(t: RcTemplate, description?: string): RcTemplate {
  const { version: _v, ...rest } = t;
  return description ? { ...rest, version: { description } } : rest;
}

// validateOnly trước, rồi publish với If-Match = ETag lúc đọc (ai đó vừa sửa thì Firebase từ chối, không ghi đè)
async function publish(accountId: string, projectId: string, etag: string, template: RcTemplate, description?: string) {
  const body = forPublish(template, description);
  const headers = { 'If-Match': etag };
  await fbRequest(accountId, { url: rcUrl(projectId, '?validateOnly=true'), method: 'PUT', data: body, headers });
  const res = await fbRequest<RcTemplate>(accountId, { url: rcUrl(projectId), method: 'PUT', data: body, headers });
  return { template: res.data, etag: res.etag ?? '' };
}

function audit(projectId: string, before: RcTemplate, after: RcTemplate, actor = 'user') {
  const rows = diffTemplates(before, after);
  db.transaction((tx) => {
    for (const r of rows.slice(0, 500)) {
      tx.insert(auditLog)
        .values({ actor, entity: `rc.${r.what}`, entityId: `${projectId}/${r.group ? `${r.group}/` : ''}${r.key}${r.slot ? `@${r.slot}` : ''}`, before: r.before == null ? null : JSON.stringify(r.before), after: r.after == null ? null : JSON.stringify(r.after) })
        .run();
    }
  });
  return rows.length;
}

export async function publishTemplate(req: { accountId: string; projectId: string; etag: string; template: RcTemplate; description?: string }): Promise<RcFetched> {
  assertOnline();
  const { accountId, projectId } = req;
  try {
    const cur = await getTemplate(accountId, projectId);
    if (cur.etag !== req.etag) throw wrapRcError(accountId, projectId, { status: 409 });
    const res = await publish(accountId, projectId, req.etag, req.template, req.description);
    audit(projectId, cur.template, res.template);
    return { projectId, template: res.template, etag: res.etag, fetchedAt: new Date().toISOString() };
  } catch (err) {
    throw wrapRcError(accountId, projectId, err);
  }
}

// ── Tìm & thay thế nhiều project ────────────────────────────────────────────
export async function planReplaceAll(targets: { accountId: string; projectId: string }[], query: ReplaceQuery, ctx: JobContext): Promise<ReplacePlan[]> {
  const out: ReplacePlan[] = [];
  for (const [i, t] of targets.entries()) {
    ctx.progress(i, targets.length);
    try {
      const f = await getTemplate(t.accountId, t.projectId);
      const p = planReplace(f.template, query);
      out.push({ ...t, etag: f.etag, changes: p.changes, skipped: p.skipped, error: p.error });
    } catch (err) {
      out.push({ ...t, etag: null, changes: [], skipped: [], error: toAppError(err).message });
    }
  }
  ctx.progress(targets.length, targets.length);
  return out;
}

export async function applyReplace(req: ApplyReplaceRequest, ctx: JobContext) {
  assertOnline();
  const results: { projectId: string; ok: boolean; changed: number; message: string | null }[] = [];
  for (const [i, t] of req.targets.entries()) {
    ctx.progress(i, req.targets.length);
    try {
      const cur = await getTemplate(t.accountId, t.projectId);
      if (cur.etag !== t.etag) throw wrapRcError(t.accountId, t.projectId, { status: 409 });
      const { template, conflicts } = applyChanges(cur.template, t.changes);
      if (conflicts.length) throw new UserFacingError({ message: `Giá trị đã đổi so với lúc xem trước: ${conflicts.slice(0, 5).join(', ')}`, code: 'RC_CONFLICT', action: 'retry' });
      const res = await publish(t.accountId, t.projectId, t.etag, template, req.description ?? 'AppOps Studio: tìm & thay thế');
      audit(t.projectId, cur.template, res.template);
      results.push({ projectId: t.projectId, ok: true, changed: t.changes.length, message: null });
    } catch (err) {
      const e = toAppError(wrapRcError(t.accountId, t.projectId, err));
      log.warn(`[rc] thay thế ${t.projectId} lỗi`, e.message);
      results.push({ projectId: t.projectId, ok: false, changed: 0, message: e.message });
    }
  }
  ctx.progress(req.targets.length, req.targets.length);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) ctx.fail({ message: `${failed.length}/${results.length} project lỗi: ${failed.map((f) => `${f.projectId} (${f.message})`).join(' · ')}`, action: 'retry' });
  return results;
}

// ── Lịch sử & hoàn tác ──────────────────────────────────────────────────────
export async function listVersions(accountId: string, projectId: string): Promise<RcVersion[]> {
  try {
    const res = await fbRequest<{ versions?: RcVersion[] }>(accountId, { url: rcUrl(projectId, ':listVersions?pageSize=100') });
    return res.data.versions ?? [];
  } catch (err) {
    throw wrapRcError(accountId, projectId, err);
  }
}

export async function getVersion(accountId: string, projectId: string, versionNumber: string): Promise<RcTemplate> {
  try {
    return (await fbRequest<RcTemplate>(accountId, { url: rcUrl(projectId, `?versionNumber=${encodeURIComponent(versionNumber)}`) })).data;
  } catch (err) {
    throw wrapRcError(accountId, projectId, err);
  }
}

export async function rollback(accountId: string, projectId: string, versionNumber: string): Promise<RcFetched> {
  assertOnline();
  try {
    const before = (await getTemplate(accountId, projectId)).template;
    const res = await fbRequest<RcTemplate>(accountId, { url: rcUrl(projectId, ':rollback'), method: 'POST', data: { versionNumber } });
    audit(projectId, before, res.data, 'user:rollback');
    return { projectId, template: res.data, etag: res.etag ?? (await getTemplate(accountId, projectId)).etag, fetchedAt: new Date().toISOString() };
  } catch (err) {
    throw wrapRcError(accountId, projectId, err);
  }
}

export const hasFirebaseAccount = () => listAccounts().some((a) => a.kind === 'firebase' && a.status === 'active');
