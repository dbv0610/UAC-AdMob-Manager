// Đọc link cửa hàng người dùng dán vào form map app → store + package / App Store ID.
import type { Store } from './types';

export interface StoreRef {
  store: Store;
  storeAppId: string;
}

const PACKAGE = /^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/;

export function parseStoreLink(input: string): StoreRef | null {
  const s = input.trim();
  if (!s) return null;
  if (PACKAGE.test(s)) return { store: 'GOOGLE_PLAY', storeAppId: s };
  if (/^(id)?\d{6,12}$/.test(s)) return { store: 'APPLE_APP_STORE', storeAppId: s.replace(/^id/, '') };
  let url: URL;
  try {
    url = new URL(/^[a-z][\w+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  // play.google.com/store/apps/details?id=… · market://details?id=…
  const id = url.searchParams.get('id');
  if ((host === 'play.google.com' || url.protocol === 'market:') && id && PACKAGE.test(id)) return { store: 'GOOGLE_PLAY', storeAppId: id };
  // Link mời thử nghiệm: play.google.com/apps/testing/<package> (cả /apps/internaltest/… không có package → bỏ)
  const testing = host === 'play.google.com' && url.pathname.match(/^\/apps\/testing\/([\w.]+)/);
  if (testing && PACKAGE.test(testing[1])) return { store: 'GOOGLE_PLAY', storeAppId: testing[1] };
  // apps.apple.com/<nước>/app/<tên>/id1234567890 · itunes.apple.com/…/id…
  const apple = /(^|\.)apple\.com$/.test(host) && url.pathname.match(/\/id(\d{6,12})/);
  if (apple) return { store: 'APPLE_APP_STORE', storeAppId: apple[1] };
  return null;
}

export interface AdmobCandidate {
  appId: string; // ca-app-pub-…~…
  name: string;
  exact: boolean; // trùng tên (bỏ dấu, hoa thường, ký tự đặc biệt)
}

// So tên app giữa Play Console và AdMob: bỏ dấu, hoa thường, ký tự không phải chữ/số
export const normalizeAppName = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Ứng viên AdMob cho app chưa liên kết store: trùng tên trước, rồi tên chứa nhau; tối đa 8
export function rankAdmobCandidates(name: string | null, apps: { appId: string; name: string }[]): AdmobCandidate[] {
  const n = name ? normalizeAppName(name) : '';
  const scored = apps.map((a) => {
    const m = normalizeAppName(a.name);
    const exact = !!n && m === n;
    const near = !!n && !exact && m.length >= 3 && (m.includes(n) || n.includes(m));
    return { ...a, exact, score: exact ? 2 : near ? 1 : 0 };
  });
  const hits = scored.filter((a) => a.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, 8).map(({ appId, name: nm, exact }) => ({ appId, name: nm, exact }));
}

export interface AppLookup extends StoreRef {
  name: string | null;
  admobAppId: string | null;
  adsCustomerId: string | null;
  existingId: string | null; // đã map rồi
  iconUrl: string | null;
  sources: { name?: string; admobAppId?: string; adsCustomerId?: string };
  // App chưa live không liên kết store được trong AdMob (tạo tay, chỉ có tên): gợi ý theo tên để người dùng chọn
  admobCandidates: AdmobCandidate[];
  notes: string[];
}
