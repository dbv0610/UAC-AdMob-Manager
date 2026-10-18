import { net } from 'electron';
import { desc, eq } from 'drizzle-orm';
import log from 'electron-log/main';
import { admob } from '@googleapis/admob';
import { db } from '../db';
import { campaignMeta } from '../db/schema';
import { UserFacingError, toAppError } from '../ipc/register';
import { authClientFor, listAccounts } from './auth/accounts';
import { listAdmobPublishers } from './directory';
import { listApps, saveApp } from './appsStore';
import { resolvePlayAccount, withEdit } from './play/client';
import { parseStoreLink, rankAdmobCandidates, type AppLookup } from '@shared/storeLink';

// Dán link cửa hàng → điền sẵn form map app. Mỗi nguồn lỗi riêng chỉ ghi chú, không chặn các nguồn khác.

interface StoreInfo {
  name: string | null;
  icon: string | null;
}

// Ảnh googleusercontent nhận hậu tố kích thước: lấy bản 128px cho nhẹ
const sized = (url: string | null | undefined) => (!url ? null : /googleusercontent\.com\//.test(url) ? `${url.replace(/=[^/]*$/, '')}=s128` : url);

// Tên + icon trên Play Console (đọc được cả app đang thử nghiệm kín / chưa công khai)
async function playConsoleInfo(pkg: string): Promise<StoreInfo | null> {
  if (!listAccounts().some((a) => a.kind === 'play' && a.status === 'active')) return null;
  const acc = await resolvePlayAccount(pkg);
  return withEdit(acc, pkg, async (api, editId) => {
    const language = (await api.edits.details.get({ packageName: pkg, editId })).data.defaultLanguage ?? 'en-US';
    const [listing, icons] = await Promise.all([
      api.edits.listings.get({ packageName: pkg, editId, language }),
      api.edits.images.list({ packageName: pkg, editId, language, imageType: 'icon' }),
    ]);
    return { name: listing.data.title || null, icon: sized(icons.data.images?.[0]?.url) };
  });
}

// Mọi app trong các tài khoản AdMob đã đăng nhập (đã liên kết store hoặc tạo tay)
async function admobApps() {
  const out: { appId: string; name: string; platform: string; storeId: string | null }[] = [];
  for (const p of listAdmobPublishers()) {
    const api = admob({ version: 'v1', auth: authClientFor(p.accountId) as never });
    let pageToken: string | undefined;
    do {
      const res = await api.accounts.apps.list({ parent: `accounts/${p.publisherId}`, pageSize: 1000, pageToken });
      for (const a of res.data.apps ?? []) {
        if (!a.appId) continue;
        out.push({ appId: a.appId, name: a.linkedAppInfo?.displayName || a.manualAppInfo?.displayName || a.appId, platform: a.platform ?? '', storeId: a.linkedAppInfo?.appStoreId ?? null });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return out;
}

const unescape = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Trang cửa hàng công khai (app đang thử nghiệm kín sẽ 404 — bình thường)
async function storePageInfo(store: AppLookup['store'], id: string): Promise<StoreInfo | null> {
  if (store === 'APPLE_APP_STORE') {
    const res = await net.fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`);
    const j = (await res.json()) as { results?: { trackName?: string; artworkUrl100?: string }[] };
    const r = j.results?.[0];
    return r ? { name: r.trackName ?? null, icon: r.artworkUrl100?.startsWith('https://') ? r.artworkUrl100 : null } : null;
  }
  const res = await net.fetch(`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en`);
  if (!res.ok) return null;
  const html = await res.text();
  const meta = (prop: string) => html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]+)"`))?.[1];
  const title = meta('og:title') ?? html.match(/<title>([^<]+)<\/title>/)?.[1];
  const image = meta('og:image');
  return {
    name: title ? unescape(title).replace(/\s*-\s*Apps on Google Play\s*$/i, '').trim() || null : null,
    icon: image?.startsWith('https://') ? sized(unescape(image)) : null,
  };
}

// Icon cho app đã map: Play Console trước, rồi trang cửa hàng
async function iconFor(store: AppLookup['store'], id: string) {
  if (store === 'GOOGLE_PLAY') {
    const p = await playConsoleInfo(id).catch(() => null);
    if (p?.icon) return p.icon;
  }
  return (await storePageInfo(store, id).catch(() => null))?.icon ?? null;
}

// Lấy bù icon cho app đã map trước khi có tính năng này; lỗi từng app bỏ qua
export async function refreshAppIcons(force = false) {
  let updated = 0;
  for (const a of listApps()) {
    if (a.iconUrl && !force) continue;
    const icon = await iconFor(a.store, a.storeAppId);
    if (icon && icon !== a.iconUrl) {
      saveApp({ ...a, iconUrl: icon });
      updated++;
    }
  }
  return updated;
}

// Tài khoản Ads đã từng chạy camp cho app này (đọc từ dữ liệu đồng bộ)
function adsCustomerFor(storeAppId: string) {
  return db.select({ c: campaignMeta.customerId }).from(campaignMeta).where(eq(campaignMeta.appId, storeAppId)).orderBy(desc(campaignMeta.updatedAt)).limit(1).get()?.c ?? null;
}

export async function lookupApp(input: string): Promise<AppLookup> {
  const ref = parseStoreLink(input);
  if (!ref) {
    throw new UserFacingError({ message: 'Không đọc được link — dán link Google Play (…details?id=…), link mời thử nghiệm, link App Store hoặc package name', code: 'BAD_STORE_LINK', action: 'fix', field: 'storeAppId' });
  }
  const out: AppLookup = { ...ref, name: null, admobAppId: null, adsCustomerId: null, existingId: listApps().find((a) => a.storeAppId === ref.storeAppId)?.id ?? null, iconUrl: null, sources: {}, admobCandidates: [], notes: [] };
  const note = (src: string, err: unknown) => {
    const msg = toAppError(err).message;
    log.warn(`[appLookup] ${src}: ${msg}`);
    out.notes.push(`${src}: ${msg}`);
  };

  const [play, adm, page] = await Promise.allSettled([
    ref.store === 'GOOGLE_PLAY' ? playConsoleInfo(ref.storeAppId) : Promise.resolve(null),
    listAdmobPublishers().length ? admobApps() : Promise.resolve(null),
    storePageInfo(ref.store, ref.storeAppId),
  ]);

  if (play.status === 'fulfilled' && play.value?.name) [out.name, out.sources.name] = [play.value.name, 'Play Console'];
  out.iconUrl = (play.status === 'fulfilled' ? play.value?.icon : null) ?? (page.status === 'fulfilled' ? page.value?.icon : null) ?? null;
  // App đã live và liên kết store trong AdMob: khớp chắc chắn theo package / ID
  const linked = adm.status === 'fulfilled' ? adm.value?.find((a) => a.storeId === ref.storeAppId) : undefined;
  if (linked) {
    [out.admobAppId, out.sources.admobAppId] = [linked.appId, 'AdMob (đã liên kết store)'];
    if (!out.name) [out.name, out.sources.name] = [linked.name, 'AdMob'];
  }
  if (!out.name && page.status === 'fulfilled' && page.value?.name) [out.name, out.sources.name] = [page.value.name, ref.store === 'GOOGLE_PLAY' ? 'trang Google Play' : 'App Store'];
  // App chưa live: AdMob không liên kết store được → app tạo tay, chỉ khớp được theo tên.
  // Chỉ tự điền khi đúng một app trùng tên; còn lại để người dùng chọn.
  if (!linked && adm.status === 'fulfilled' && adm.value) {
    const platform = ref.store === 'GOOGLE_PLAY' ? 'ANDROID' : 'IOS';
    const used = new Set(listApps().map((a) => a.admobAppId)); // app AdMob đã map cho app khác thì không gợi ý
    const unlinked = adm.value.filter((a) => !a.storeId && (!a.platform || a.platform === platform) && !used.has(a.appId));
    out.admobCandidates = rankAdmobCandidates(out.name, unlinked);
    const exact = out.admobCandidates.filter((c) => c.exact);
    if (exact.length === 1) [out.admobAppId, out.sources.admobAppId] = [exact[0].appId, 'AdMob (khớp theo tên, app chưa liên kết store)'];
  }
  out.adsCustomerId = adsCustomerFor(ref.storeAppId);
  if (out.adsCustomerId) out.sources.adsCustomerId = 'lịch sử camp';

  // Chỉ báo lỗi nguồn khi thiếu đúng thông tin nguồn đó cung cấp
  if (!out.name) {
    if (play.status === 'rejected') note('Play Console', play.reason);
    if (page.status === 'rejected') note('Trang cửa hàng', page.reason);
    if (ref.store === 'GOOGLE_PLAY' && page.status === 'fulfilled' && !page.value?.name) out.notes.push('Không có trang công khai trên Google Play (app chưa phát hành hoặc đang thử nghiệm) — đăng nhập Google Play để đọc tên từ Play Console');
  }
  if (!out.admobAppId && adm.status === 'rejected') note('AdMob', adm.reason);
  return out;
}
