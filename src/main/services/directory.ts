import { eq } from 'drizzle-orm';
import { admob } from '@googleapis/admob';
import { youtube } from '@googleapis/youtube';
import log from 'electron-log/main';
import { db } from '../db';
import { accounts, adsCustomers } from '../db/schema';
import { authClientFor, getAccount, isInvalidGrant, loadRefreshToken, reauthError } from './auth/accounts';
import { adsApi, adsErrorCode, apiDisabledError, customerFor, testAccessMessage, wrapAdsError } from './googleAds/client';
import { UserFacingError } from '../ipc/register';
import { syncFirebase } from './firebase/remoteConfig';
import type { AdmobPublisher, AdsCustomer, YoutubeChannel } from '@shared/types';
import type { JobContext } from '../jobs/queue';

// ── Google Ads: cây customer dưới MCC ───────────────────────────────────────
const TREE_GAQL = `
  SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
         customer_client.time_zone, customer_client.manager, customer_client.level
  FROM customer_client
  WHERE customer_client.status = 'ENABLED'`;

// Lỗi hay gặp khi đọc từng customer → lời giải thích + việc cần làm
const fmtCid = (id: string) => id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
function skipReason(err: unknown): { code: string; message: string } {
  const e = err as { errors?: { error_code?: Record<string, unknown>; message?: string }[] };
  const first = e?.errors?.[0];
  const msg = first?.message ?? '';
  // Mã lỗi theo nhánh oneof có giá trị; không đọc được mã (enum dạng số…) thì nhận theo nội dung thông báo
  let code = adsErrorCode(first?.error_code)?.split('.').pop() ?? '';
  if (!code && /only approved for use with test accounts/i.test(msg)) code = 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION';
  if (!code && /not yet enabled or has been deactivated/i.test(msg)) code = 'CUSTOMER_NOT_ENABLED';
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|DEVELOPER_TOKEN_NOT_APPROVED/.test(code)) {
    return { code, message: 'Cloud project đang ở mức Test (chỉ đọc được tài khoản test)' };
  }
  if (code === 'CUSTOMER_NOT_ENABLED') return { code, message: 'tài khoản chưa thiết lập xong (chưa nhập thanh toán) hoặc đã bị hủy — API chỉ đọc được tài khoản đã thiết lập xong' };
  if (code === 'USER_PERMISSION_DENIED') return { code, message: 'email đăng nhập không có quyền với tài khoản này' };
  return { code, message: first?.message ?? (err as Error)?.message ?? String(err) };
}

async function syncAds(accountId: string, ctx: JobContext) {
  let resourceNames: string[];
  try {
    const res = await adsApi().listAccessibleCustomers(loadRefreshToken(accountId));
    resourceNames = res.resource_names ?? [];
  } catch (err) {
    throw wrapAdsError(accountId, err);
  }
  const roots = resourceNames.map((r) => r.split('/')[1]);
  const found = new Map<string, AdsCustomer>();
  const skipped: { id: string; code: string; message: string }[] = [];

  for (const [i, root] of roots.entries()) {
    ctx.progress(i, roots.length);
    try {
      const rows = await customerFor(accountId, root, root).query(TREE_GAQL);
      for (const r of rows) {
        const c = r.customer_client!;
        const id = String(c.id);
        const prev = found.get(id);
        // Một customer có thể truy cập qua nhiều đường; ưu tiên đường qua MCC ở tầng cao nhất (level lớn nhất).
        if (prev && prev.level >= (c.level ?? 0)) continue;
        found.set(id, {
          customerId: id,
          loginCustomerId: id === root ? null : root,
          name: c.descriptive_name || id,
          currency: c.currency_code ?? 'USD',
          timeZone: c.time_zone ?? 'UTC',
          manager: !!c.manager,
          level: Number(c.level ?? 0),
          accountId,
        });
      }
    } catch (err) {
      if (isInvalidGrant(err)) throw reauthError(accountId);
      // Customer bị hủy hoặc không có quyền đọc: bỏ qua, không làm hỏng cả cây — nhưng ghi lại lý do để báo
      log.warn(`[directory] bỏ qua customer ${root}`, (err as Error)?.message ?? err);
      skipped.push({ id: root, ...skipReason(err) });
    }
  }

  db.transaction((tx) => {
    tx.delete(adsCustomers).where(eq(adsCustomers.accountId, accountId)).run();
    for (const c of found.values()) {
      tx.insert(adsCustomers).values(c).onConflictDoUpdate({ target: adsCustomers.customerId, set: c }).run();
    }
  });
  ctx.progress(roots.length, roots.length);

  // Trước đây job báo “xong” dù không đọc được tài khoản nào → ô chọn tài khoản trống mà không biết vì sao
  const testToken = skipped.some((s) => /CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|DEVELOPER_TOKEN_NOT_APPROVED/.test(s.code));
  const detail = skipped.map((s) => `${fmtCid(s.id)}: ${s.message}`).join(' · ');
  const hint = testToken ? ` — ${testAccessMessage()}` : '';
  if (!roots.length) {
    throw new UserFacingError({ message: 'Email này không có tài khoản Google Ads nào — đăng nhập bằng email có quyền trên tài khoản quảng cáo hoặc MCC', code: 'NO_CUSTOMERS', action: 'reauth', accountId });
  }
  if (!found.size && skipped.length) {
    throw new UserFacingError({ message: `Không đọc được tài khoản Ads nào. ${detail}${hint}`, code: testToken ? 'DEVELOPER_TOKEN_TEST' : skipped[0].code, action: testToken ? 'openSettings' : 'retry' });
  }
  // Ô chọn tài khoản chỉ liệt kê tài khoản quảng cáo: đọc được MCC mà không có tài khoản con hoạt động thì vẫn trống
  const leaves = [...found.values()].filter((c) => !c.manager);
  if (!leaves.length) {
    const mccs = [...found.values()].map((c) => `${c.name} (${fmtCid(c.customerId)})`).join(', ');
    ctx.fail({
      message: `Đọc được MCC ${mccs} nhưng chưa có tài khoản quảng cáo nào đang hoạt động bên dưới — hoàn tất thiết lập tài khoản con (nhập thanh toán) hoặc liên kết tài khoản vào MCC.${skipped.length ? ` Bỏ qua: ${detail}${hint}` : ''}`,
      code: 'NO_ACTIVE_CLIENTS',
      action: 'retry',
    });
  } else if (skipped.length) ctx.fail({ message: `Bỏ qua ${skipped.length} tài khoản: ${detail}${hint}`, code: 'CUSTOMERS_SKIPPED', action: testToken ? 'openSettings' : 'retry' });
}

// ── AdMob / YouTube: lưu vào accounts.meta ─────────────────────────────────
async function syncAdmob(accountId: string) {
  const api = admob({ version: 'v1', auth: authClientFor(accountId) as never });
  const res = await api.accounts.list({ pageSize: 50 });
  const pubs: AdmobPublisher[] = (res.data.account ?? []).map((a) => ({
    publisherId: a.publisherId!,
    name: a.name ?? a.publisherId!,
    currency: a.currencyCode ?? 'USD',
    timeZone: a.reportingTimeZone ?? 'America/Los_Angeles',
    accountId,
  }));
  db.update(accounts).set({ meta: JSON.stringify({ publishers: pubs }) }).where(eq(accounts.id, accountId)).run();
}

async function syncYoutube(accountId: string) {
  const api = youtube({ version: 'v3', auth: authClientFor(accountId) as never });
  const res = await api.channels.list({ part: ['snippet'], mine: true });
  const channels: YoutubeChannel[] = (res.data.items ?? []).map((c) => ({
    channelId: c.id!,
    title: c.snippet?.title ?? c.id!,
    thumbnail: c.snippet?.thumbnails?.default?.url ?? null,
    accountId,
  }));
  db.update(accounts).set({ meta: JSON.stringify({ channels }) }).where(eq(accounts.id, accountId)).run();
}

export async function syncDirectory(accountId: string, ctx: JobContext) {
  const acc = getAccount(accountId);
  try {
    if (acc.kind === 'ads') await syncAds(accountId, ctx);
    else if (acc.kind === 'admob') await syncAdmob(accountId);
    else if (acc.kind === 'youtube') await syncYoutube(accountId);
    else if (acc.kind === 'firebase') await syncFirebase(accountId);
    // Google Play: API không có endpoint liệt kê app, package lấy từ phần map app
  } catch (err) {
    if (isInvalidGrant(err)) throw reauthError(accountId);
    throw apiDisabledError(err) ?? err;
  }
}

// ── Đọc cache ───────────────────────────────────────────────────────────────
export function listAdsCustomers(): AdsCustomer[] {
  return db.select().from(adsCustomers).all() as AdsCustomer[];
}

function metaOf<K extends 'publishers' | 'channels'>(kind: 'admob' | 'youtube', key: K) {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.kind, kind))
    .all()
    .flatMap((a) => (a.meta ? ((JSON.parse(a.meta)[key] ?? []) as unknown[]) : []));
}

export const listAdmobPublishers = () => metaOf('admob', 'publishers') as AdmobPublisher[];
export const listYoutubeChannels = () => metaOf('youtube', 'channels') as YoutubeChannel[];
