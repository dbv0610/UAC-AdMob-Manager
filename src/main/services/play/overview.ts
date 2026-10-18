import { and, desc, eq, like } from 'drizzle-orm';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { toAppError } from '../../ipc/register';
import type { JobContext } from '../../jobs/queue';
import { getJson, setJson } from '../settingsStore';
import { forgetPlayAccount, playApps, resolvePlayAccount } from './client';
import { listTracks } from './releases';
import { listReviews } from './reviews';
import { alertVitals, syncVitals, vitalsCached } from './vitals';
import { appStage, reviewStats, summarizeVitals, type AppOverview, type PlayOverview } from '@shared/playOps';

// Bảng tổng quan mọi app Google Play: release, vitals, review, lần sửa listing gần nhất.
// Mỗi app lỗi riêng phần nào ghi vào errors của app đó, không làm hỏng cả bảng.

const VITALS_STALE_MS = 20 * 3600_000;

function lastListingAt(packageName: string) {
  return (
    db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'play.listing'), like(auditLog.entityId, `${packageName}/%`)))
      .orderBy(desc(auditLog.at))
      .limit(1)
      .get()?.at ?? null
  );
}

async function overviewOf(app: { id: string; name: string; storeAppId: string }): Promise<AppOverview> {
  const pkg = app.storeAppId;
  const row: AppOverview = { appId: app.id, name: app.name, packageName: pkg, accountId: null, stage: 'none', tracks: [], vitals: null, vitalsAt: null, reviews: null, lastListingAt: lastListingAt(pkg), errors: [] };
  const note = (part: string, err: unknown) => {
    const e = toAppError(err);
    if (e.code === 'SCOPE_MISSING') return void (row.vitalsScopeMissing = true);
    if (e.code === 'PERMISSION_DENIED') forgetPlayAccount(pkg);
    row.errors.push(`${part}: ${e.message}`);
  };
  try {
    row.accountId = await resolvePlayAccount(pkg);
  } catch (err) {
    note('Tài khoản', err);
    return row;
  }
  const acc = row.accountId;
  const [tracks, reviews] = await Promise.allSettled([listTracks(acc, pkg), listReviews(acc, pkg)]);
  if (tracks.status === 'fulfilled') {
    row.tracks = tracks.value;
    row.stage = appStage(tracks.value);
  } else note('Release', tracks.reason);
  if (reviews.status === 'fulfilled') row.reviews = reviewStats(reviews.value);
  // App đang thử nghiệm: góp ý của tester là riêng tư, Play không trả qua API — không tính là lỗi
  else if (row.stage === 'production' || row.stage === 'open') note('Review', reviews.reason);

  let vitals = vitalsCached(pkg);
  if (!vitals || Date.now() - Date.parse(vitals.at) > VITALS_STALE_MS) {
    try {
      vitals = await syncVitals(acc, pkg);
      await alertVitals(app.name, acc, vitals);
    } catch (err) {
      note('Vitals', err);
    }
  }
  if (vitals) {
    row.vitals = summarizeVitals(vitals.days);
    row.vitalsAt = vitals.at;
  }
  return row;
}

export async function buildOverview(ctx: JobContext): Promise<PlayOverview> {
  const apps = playApps();
  const out: AppOverview[] = [];
  for (const [i, a] of apps.entries()) {
    ctx.progress(i, apps.length);
    out.push(await overviewOf(a));
  }
  ctx.progress(apps.length, apps.length);
  const reauthAccounts = [...new Set(out.filter((a) => a.vitalsScopeMissing && a.accountId).map((a) => a.accountId!))];
  const result: PlayOverview = { at: new Date().toISOString(), apps: out, reauthAccounts };
  setJson('playOverview', result);
  const failed = out.filter((a) => a.errors.length);
  if (failed.length) ctx.fail({ message: `${failed.length}/${out.length} app có phần không đọc được: ${failed.map((a) => a.name).join(', ')}`, action: 'retry' });
  return result;
}

export const overviewCached = () => getJson<PlayOverview>('playOverview');
