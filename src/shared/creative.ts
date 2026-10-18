// Creative library (Giai đoạn 3): kiểu + hàm thuần dùng chung main/renderer.
import { z } from 'zod';
import { getCountry } from './geo';
import type { AppError } from './types';

export type CreativeKind = 'video' | 'image';
export type Aspect = 'landscape' | 'portrait' | 'square';
export const ASPECTS: Aspect[] = ['landscape', 'portrait', 'square'];
export const ASPECT_LABEL: Record<Aspect, string> = { landscape: 'Ngang', portrait: 'Dọc', square: 'Vuông' };

// Vòng đời video; PAUSED = người dùng tạm dừng khi đang upload (phiên resumable vẫn giữ).
export type CreativeStatus = 'LOCAL' | 'QUEUED' | 'UPLOADING' | 'PAUSED' | 'PROCESSING' | 'READY' | 'LOCKED' | 'FAILED';

export interface Creative {
  id: string;
  source: 'file' | 'youtube';
  appId: string | null;
  name: string;
  path: string; // '' khi nhập ID YouTube tay
  kind: CreativeKind;
  durationS: number | null;
  width: number | null;
  height: number | null;
  aspect: Aspect | null;
  sizeBytes: number | null;
  countries: string[];
  youtubeId: string | null;
  status: CreativeStatus;
  privacy: string | null;
  error: AppError | null;
  linkedCustomers: number; // số customer Google Ads đã có asset của video này (LINKED)
  createdAt: string;
}

export const YT_DAILY_UPLOADS = 100; // bucket videos.insert riêng mỗi project, reset 0h giờ PT

export const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'];
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

export function kindOf(file: string): CreativeKind | null {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

// Lệch ±10% vẫn coi là vuông (1080×1080, 1080×1000…)
export function aspectOf(width: number, height: number): Aspect {
  const r = width / height;
  if (r > 1.1) return 'landscape';
  if (r < 0.9) return 'portrait';
  return 'square';
}

// Đoán quốc gia từ tên file: `_US_`, `_VN.` — có biên để `_USA_` hay `_GPS` không khớp nhầm.
export function guessCountries(fileName: string) {
  const out: string[] = [];
  for (const m of fileName.matchAll(/_([A-Z]{2})(?=[_.])/g)) {
    if (getCountry(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ID 11 ký tự từ link YouTube (watch, youtu.be, shorts, embed) hoặc ID trần
export function youtubeIdOf(s: string): string | null {
  const t = s.trim();
  const m = t.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(t) ? t : null;
}

export function parseYoutubeIds(text: string) {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const id = youtubeIdOf(part);
    if (!id) invalid.push(part);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

// Video gắn được vào camp: đã xử lý xong, không bị khóa Private
export const isUsable = (c: Creative) => c.kind === 'video' && c.status === 'READY' && !!c.youtubeId;

// Ma trận quốc gia × tỉ lệ: đếm video dùng được; ô 0 = thiếu.
// Video không gán quốc gia là video dùng chung → tính cho mọi nước (đếm riêng ở `shared`).
export type CoverageCell = { own: number; shared: number };
export type Coverage = Record<string, Record<Aspect, CoverageCell>>;
export function coverage(list: Creative[], countries: string[]): Coverage {
  const out: Coverage = {};
  const cell = () => ({ own: 0, shared: 0 });
  for (const c of countries) out[c] = { landscape: cell(), portrait: cell(), square: cell() };
  for (const cr of list) {
    if (!isUsable(cr) || !cr.aspect) continue;
    if (cr.countries.length === 0) for (const c of countries) out[c][cr.aspect].shared++;
    else for (const c of cr.countries) if (out[c]) out[c][cr.aspect].own++;
  }
  return out;
}

// Số ô thiếu (không có video riêng lẫn dùng chung)
export const missingCells = (cov: Coverage) =>
  Object.values(cov).reduce((n, row) => n + ASPECTS.filter((a) => row[a].own + row[a].shared === 0).length, 0);

// Video cho một quốc gia: gán đúng nước trước, video không gán nước (dùng chung) sau; tối đa 20.
export function videosForCountry(list: Creative[], country: string, max = 20) {
  const usable = list.filter(isUsable);
  const own = usable.filter((c) => c.countries.includes(country));
  const global = usable.filter((c) => c.countries.length === 0);
  return [...own, ...global].slice(0, max).map((c) => c.youtubeId!);
}

// ── Schema IPC ──────────────────────────────────────────────────────────────
const Iso2 = z.string().regex(/^[A-Z]{2}$/).refine((c) => !!getCountry(c), { error: (i) => `Mã quốc gia lạ: ${String(i.input)}` });

export const CreativePatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  countries: z.array(Iso2).max(100).optional(),
  addCountries: z.array(Iso2).max(100).optional(),
  aspect: z.enum(['landscape', 'portrait', 'square']).optional(),
  name: z.string().trim().min(1).max(100).optional(), // tiêu đề YouTube tối đa 100 ký tự
  appId: z.string().nullable().optional(),
});
export type CreativePatch = z.infer<typeof CreativePatchSchema>;

export const ImportPathsSchema = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(2000),
  appId: z.string().nullable(),
});

export const ManualIdsSchema = z.object({
  text: z.string().max(50_000),
  appId: z.string().nullable(),
  aspect: z.enum(['landscape', 'portrait', 'square']).nullable(),
  countries: z.array(Iso2).max(100),
});

export const UploadRequestSchema = z.discriminatedUnion('kind', [
  // Qua Google Ads: kênh YouTube do Google quản lý, không cần tài khoản YouTube / audit
  z.object({ kind: z.literal('ads'), ids: z.array(z.string().min(1)).min(1).max(500), customerId: z.string().regex(/^\d{10}$/) }),
  z.object({
    kind: z.literal('youtube'),
    ids: z.array(z.string().min(1)).min(1).max(500),
    accountId: z.string().min(1),
    // Bắt buộc người dùng xác nhận — khai sai "made for kids" vi phạm chính sách COPPA của YouTube
    notMadeForKids: z.literal(true, { error: 'Cần xác nhận nội dung không dành cho trẻ em' }),
  }),
]);
export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const AttachVideosSchema = z.object({
  customerId: z.string().regex(/^\d{10}$/),
  campaignIds: z.array(z.string().regex(/^\d+$/)).min(1).max(200),
  videoIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).min(1).max(20),
});

export interface ImportResult {
  added: number;
  duplicates: number; // SHA-256 đã có trong thư viện
  skipped: string[]; // file không phải video/ảnh hoặc ffprobe đọc lỗi
}

export interface AttachPreview {
  campaignId: string;
  name: string;
  before: number;
  after: number;
  added: string[];
  overLimit: boolean; // vượt 20 video → bị cắt
}

// ── Thay video hiệu quả thấp (performance_label = LOW) ──────────────────────
export interface LowVideo {
  customerId: string;
  campaignId: string;
  campaignName: string;
  country: string | null;
  adResource: string;
  lowAsset: string; // asset resource name đang LOW
  lowVideoId: string;
  lowAspect: Aspect | null; // từ thư viện, nếu video có trong thư viện
  candidates: { youtubeId: string; name: string; aspect: Aspect | null; own: boolean }[];
}

// Ứng viên: video Sẵn sàng, gán đúng nước (ưu tiên) hoặc dùng chung, cùng tỉ lệ khung nếu biết, chưa có trong ad.
export function pickReplacements(library: Creative[], country: string | null, aspect: Aspect | null, inAd: string[], max = 5) {
  return library
    .filter(isUsable)
    .filter((c) => !inAd.includes(c.youtubeId!))
    .filter((c) => !aspect || !c.aspect || c.aspect === aspect)
    .filter((c) => c.countries.length === 0 || (!!country && c.countries.includes(country)))
    .map((c) => ({ youtubeId: c.youtubeId!, name: c.name, aspect: c.aspect, own: !!country && c.countries.includes(country) }))
    .sort((a, b) => Number(b.own) - Number(a.own) || Number(b.aspect === aspect) - Number(a.aspect === aspect))
    .slice(0, max);
}

export const ReplaceVideosSchema = z.object({
  customerId: z.string().regex(/^\d{10}$/),
  items: z
    .array(z.object({ adResource: z.string().regex(/^customers\/\d+\/ads\/\d+$/), campaignId: z.string().regex(/^\d+$/), removeAsset: z.string().min(1), addVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }))
    .min(1)
    .max(100),
});
