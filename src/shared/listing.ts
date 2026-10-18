// Trang thông tin cửa hàng Google Play (main store listing) theo từng ngôn ngữ.
// Dùng chung main + renderer: giới hạn ký tự, kiểm tra, đọc file Excel và thư mục ảnh.
import { z } from 'zod';

// ── Ngôn ngữ Play Console (BCP-47 theo đúng mã Play nhận) ───────────────────
export interface PlayLanguage {
  code: string;
  name: string;
}

export const PLAY_LANGUAGES: PlayLanguage[] = [
  { code: 'af', name: 'Tiếng Afrikaans' },
  { code: 'am', name: 'Tiếng Amharic' },
  { code: 'ar', name: 'Tiếng Ả Rập' },
  { code: 'hy-AM', name: 'Tiếng Armenia' },
  { code: 'az-AZ', name: 'Tiếng Azerbaijan' },
  { code: 'eu-ES', name: 'Tiếng Basque' },
  { code: 'be', name: 'Tiếng Belarus' },
  { code: 'bn-BD', name: 'Tiếng Bengal' },
  { code: 'bg', name: 'Tiếng Bulgaria' },
  { code: 'my-MM', name: 'Tiếng Miến Điện' },
  { code: 'ca', name: 'Tiếng Catalan' },
  { code: 'zh-HK', name: 'Tiếng Trung (Hồng Kông)' },
  { code: 'zh-CN', name: 'Tiếng Trung giản thể' },
  { code: 'zh-TW', name: 'Tiếng Trung phồn thể' },
  { code: 'hr', name: 'Tiếng Croatia' },
  { code: 'cs-CZ', name: 'Tiếng Séc' },
  { code: 'da-DK', name: 'Tiếng Đan Mạch' },
  { code: 'nl-NL', name: 'Tiếng Hà Lan' },
  { code: 'en-AU', name: 'Tiếng Anh (Úc)' },
  { code: 'en-CA', name: 'Tiếng Anh (Canada)' },
  { code: 'en-IN', name: 'Tiếng Anh (Ấn Độ)' },
  { code: 'en-SG', name: 'Tiếng Anh (Singapore)' },
  { code: 'en-ZA', name: 'Tiếng Anh (Nam Phi)' },
  { code: 'en-GB', name: 'Tiếng Anh (Anh)' },
  { code: 'en-US', name: 'Tiếng Anh (Mỹ)' },
  { code: 'et', name: 'Tiếng Estonia' },
  { code: 'fil', name: 'Tiếng Philippines' },
  { code: 'fi-FI', name: 'Tiếng Phần Lan' },
  { code: 'fr-CA', name: 'Tiếng Pháp (Canada)' },
  { code: 'fr-FR', name: 'Tiếng Pháp (Pháp)' },
  { code: 'gl-ES', name: 'Tiếng Galicia' },
  { code: 'ka-GE', name: 'Tiếng Gruzia' },
  { code: 'de-DE', name: 'Tiếng Đức' },
  { code: 'el-GR', name: 'Tiếng Hy Lạp' },
  { code: 'gu', name: 'Tiếng Gujarat' },
  { code: 'iw-IL', name: 'Tiếng Do Thái' },
  { code: 'hi-IN', name: 'Tiếng Hindi' },
  { code: 'hu-HU', name: 'Tiếng Hungary' },
  { code: 'is-IS', name: 'Tiếng Iceland' },
  { code: 'id', name: 'Tiếng Indonesia' },
  { code: 'it-IT', name: 'Tiếng Ý' },
  { code: 'ja-JP', name: 'Tiếng Nhật' },
  { code: 'kn-IN', name: 'Tiếng Kannada' },
  { code: 'kk', name: 'Tiếng Kazakh' },
  { code: 'km-KH', name: 'Tiếng Khmer' },
  { code: 'ko-KR', name: 'Tiếng Hàn' },
  { code: 'ky-KG', name: 'Tiếng Kyrgyz' },
  { code: 'lo-LA', name: 'Tiếng Lào' },
  { code: 'lv', name: 'Tiếng Latvia' },
  { code: 'lt', name: 'Tiếng Litva' },
  { code: 'mk-MK', name: 'Tiếng Macedonia' },
  { code: 'ms', name: 'Tiếng Mã Lai' },
  { code: 'ms-MY', name: 'Tiếng Mã Lai (Malaysia)' },
  { code: 'ml-IN', name: 'Tiếng Malayalam' },
  { code: 'mr-IN', name: 'Tiếng Marathi' },
  { code: 'mn-MN', name: 'Tiếng Mông Cổ' },
  { code: 'ne-NP', name: 'Tiếng Nepal' },
  { code: 'no-NO', name: 'Tiếng Na Uy' },
  { code: 'fa', name: 'Tiếng Ba Tư' },
  { code: 'fa-AE', name: 'Tiếng Ba Tư (UAE)' },
  { code: 'fa-AF', name: 'Tiếng Ba Tư (Afghanistan)' },
  { code: 'fa-IR', name: 'Tiếng Ba Tư (Iran)' },
  { code: 'pl-PL', name: 'Tiếng Ba Lan' },
  { code: 'pt-BR', name: 'Tiếng Bồ Đào Nha (Brazil)' },
  { code: 'pt-PT', name: 'Tiếng Bồ Đào Nha (Bồ Đào Nha)' },
  { code: 'pa', name: 'Tiếng Punjab' },
  { code: 'ro', name: 'Tiếng Romania' },
  { code: 'rm', name: 'Tiếng Romansh' },
  { code: 'ru-RU', name: 'Tiếng Nga' },
  { code: 'sr', name: 'Tiếng Serbia' },
  { code: 'si-LK', name: 'Tiếng Sinhala' },
  { code: 'sk', name: 'Tiếng Slovakia' },
  { code: 'sl', name: 'Tiếng Slovenia' },
  { code: 'es-419', name: 'Tiếng Tây Ban Nha (Mỹ Latinh)' },
  { code: 'es-ES', name: 'Tiếng Tây Ban Nha (Tây Ban Nha)' },
  { code: 'es-US', name: 'Tiếng Tây Ban Nha (Mỹ)' },
  { code: 'sw', name: 'Tiếng Swahili' },
  { code: 'sv-SE', name: 'Tiếng Thụy Điển' },
  { code: 'ta-IN', name: 'Tiếng Tamil' },
  { code: 'te-IN', name: 'Tiếng Telugu' },
  { code: 'th', name: 'Tiếng Thái' },
  { code: 'tr-TR', name: 'Tiếng Thổ Nhĩ Kỳ' },
  { code: 'uk', name: 'Tiếng Ukraina' },
  { code: 'ur', name: 'Tiếng Urdu' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'zu', name: 'Tiếng Zulu' },
];

const BY_LOWER = new Map(PLAY_LANGUAGES.map((l) => [l.code.toLowerCase(), l.code]));
// Mã hay gặp trong file dịch (ISO, Android values-xx, Apple) → mã Play
const ALIAS: Record<string, string> = {
  en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', ru: 'ru-RU', tr: 'tr-TR',
  pl: 'pl-PL', nl: 'nl-NL', sv: 'sv-SE', da: 'da-DK', fi: 'fi-FI', cs: 'cs-CZ', el: 'el-GR', hu: 'hu-HU', hi: 'hi-IN',
  he: 'iw-IL', iw: 'iw-IL', 'he-il': 'iw-IL', in: 'id', 'id-id': 'id', tl: 'fil', nb: 'no-NO', no: 'no-NO', 'nb-no': 'no-NO',
  zh: 'zh-CN', 'zh-hans': 'zh-CN', 'zh-hant': 'zh-TW', 'es-mx': 'es-419', 'es-la': 'es-419', 'vi-vn': 'vi', 'th-th': 'th',
  'uk-ua': 'uk', 'ms-my': 'ms-MY', 'ar-sa': 'ar', 'ro-ro': 'ro',
};

export const languageName = (code: string) => PLAY_LANGUAGES.find((l) => l.code === code)?.name ?? code;

// Chuẩn hóa mã ngôn ngữ về mã Play; null nếu Play không hỗ trợ.
export function normalizeLang(input: string): string | null {
  const k = input.trim().replace(/_/g, '-').replace(/^values-/, '').replace(/-r([A-Z]{2})$/i, '-$1').toLowerCase();
  if (!k) return null;
  return BY_LOWER.get(k) ?? ALIAS[k] ?? BY_LOWER.get(k.split('-')[0]) ?? ALIAS[k.split('-')[0]] ?? null;
}

// ── Text ────────────────────────────────────────────────────────────────────
export type ListingField = 'title' | 'shortDescription' | 'fullDescription';
export const LISTING_FIELDS: ListingField[] = ['title', 'shortDescription', 'fullDescription'];
export const LISTING_MAX: Record<ListingField, number> = { title: 30, shortDescription: 80, fullDescription: 4000 };
export const FIELD_LABEL: Record<ListingField | 'video', string> = { title: 'Tên ứng dụng', shortDescription: 'Mô tả ngắn', fullDescription: 'Mô tả đầy đủ', video: 'Video YouTube' };

// Play đếm theo ký tự Unicode (CJK cũng tính 1, khác Google Ads)
export const playLength = (s: string) => [...s].length;

export interface ListingText {
  language: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  video: string; // URL YouTube, '' nếu không có
}

export interface ListingIssue {
  field: ListingField | 'video';
  level: 'error' | 'warning';
  message: string;
}

// Chính sách metadata của Play: tên/mô tả ngắn không được có emoji, viết hoa toàn bộ, từ xếp hạng hay khuyến mãi
const RANKING = [/#\s?1\b/, /\bno\.? ?1\b/i, /\btop\b/i, /\bbest\b/i, /\bnumber one\b/i, /tốt nhất/i, /số 1/i];
const PROMO = [/\bfree\b/i, /\bsale\b/i, /\bdiscount\b/i, /miễn phí/i, /giảm giá/i, /\d+\s?% off/i];
const YOUTUBE = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

export function checkListing(t: ListingText): ListingIssue[] {
  const out: ListingIssue[] = [];
  for (const f of LISTING_FIELDS) {
    const v = t[f].trim();
    const len = playLength(t[f]);
    if (!v) out.push({ field: f, level: 'error', message: 'Đang trống' });
    else if (len > LISTING_MAX[f]) out.push({ field: f, level: 'error', message: `Dài ${len}/${LISTING_MAX[f]}` });
  }
  for (const f of ['title', 'shortDescription'] as const) {
    const v = t[f].trim();
    if (/[\p{Extended_Pictographic}]/u.test(v)) out.push({ field: f, level: 'warning', message: 'Có emoji — Play hay từ chối' });
    // Chỉ xét chữ có hoa/thường: CJK, Thái… không có khái niệm viết hoa
    const cased = v.replace(/[^\p{Lu}\p{Ll}\p{Lt}]/gu, '');
    if (cased.length >= 6 && cased === cased.toUpperCase()) out.push({ field: f, level: 'warning', message: 'Viết hoa toàn bộ' });
    for (const re of [...RANKING, ...PROMO]) {
      const m = v.match(re);
      if (m) out.push({ field: f, level: 'warning', message: `Cụm dễ bị từ chối: “${m[0]}”` });
    }
  }
  if (t.video.trim() && !YOUTUBE.test(t.video.trim())) out.push({ field: 'video', level: 'error', message: 'Phải là link YouTube (youtube.com/watch?v=… hoặc youtu.be/…)' });
  return out;
}

const sameText = (a: ListingText, b: ListingText) =>
  a.title === b.title && a.shortDescription === b.shortDescription && a.fullDescription === b.fullDescription && a.video === b.video;

export interface ListingDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

export function diffListings(before: ListingText[], after: ListingText[]): ListingDiff {
  const prev = new Map(before.map((t) => [t.language, t]));
  const next = new Set(after.map((t) => t.language));
  const d: ListingDiff = { added: [], changed: [], removed: [] };
  for (const t of after) {
    const p = prev.get(t.language);
    if (!p) d.added.push(t.language);
    else if (!sameText(p, t)) d.changed.push(t.language);
  }
  for (const t of before) if (!next.has(t.language)) d.removed.push(t.language);
  return d;
}

// ── Excel / CSV: dòng đầu là tiêu đề, mỗi dòng sau là một ngôn ngữ ───────────
const HEADERS: Record<keyof ListingText, RegExp> = {
  language: /^(language|lang|locale|ngôn ngữ|mã)$/i,
  title: /^(title|tên|tên ứng dụng|app name)$/i,
  shortDescription: /^(short ?description|short|mô tả ngắn)$/i,
  fullDescription: /^(full ?description|full|description|mô tả đầy đủ|mô tả)$/i,
  video: /^(video|youtube|video url)$/i,
};

export function textsFromRows(rows: string[][]): { texts: ListingText[]; errors: string[] } {
  const errors: string[] = [];
  const head = (rows[0] ?? []).map((h) => h.trim());
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as (keyof ListingText)[]).map((k) => [k, head.findIndex((h) => HEADERS[k].test(h))]),
  ) as Record<keyof ListingText, number>;
  const missing = (['language', 'title', 'shortDescription', 'fullDescription'] as const).filter((k) => col[k] < 0);
  if (missing.length) return { texts: [], errors: [`Thiếu cột: ${missing.join(', ')} (dòng 1 phải là tiêu đề cột)`] };

  const seen = new Map<string, number>();
  const texts: ListingText[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (k: keyof ListingText) => (col[k] < 0 ? '' : (r[col[k]] ?? '')).replace(/\r\n/g, '\n').trim();
    if (!r.some((c) => c?.trim())) return;
    const raw = cell('language');
    const language = normalizeLang(raw);
    if (!language) return void errors.push(`Dòng ${line}: Play không hỗ trợ ngôn ngữ “${raw}”`);
    if (seen.has(language)) return void errors.push(`Dòng ${line}: ${language} trùng với dòng ${seen.get(language)}`);
    seen.set(language, line);
    texts.push({ language, title: cell('title'), shortDescription: cell('shortDescription'), fullDescription: cell('fullDescription'), video: cell('video') });
  });
  return { texts, errors };
}

// ── Ảnh ─────────────────────────────────────────────────────────────────────
export const IMAGE_TYPES = ['icon', 'featureGraphic', 'phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

interface ImageSpec {
  label: string;
  max: number; // số ảnh tối đa
  size?: [number, number]; // kích thước bắt buộc
  minSide?: number;
  maxSide?: number;
  maxRatio?: number; // cạnh dài / cạnh ngắn
  maxMb: number;
}

export const IMAGE_SPEC: Record<ImageType, ImageSpec> = {
  icon: { label: 'Biểu tượng', max: 1, size: [512, 512], maxMb: 1 },
  featureGraphic: { label: 'Hình ảnh nổi bật', max: 1, size: [1024, 500], maxMb: 15 },
  phoneScreenshots: { label: 'Ảnh chụp điện thoại', max: 8, minSide: 320, maxSide: 3840, maxRatio: 2, maxMb: 8 },
  sevenInchScreenshots: { label: 'Máy tính bảng 7"', max: 8, minSide: 320, maxSide: 3840, maxRatio: 2, maxMb: 8 },
  tenInchScreenshots: { label: 'Máy tính bảng 10"', max: 8, minSide: 1080, maxSide: 7680, maxRatio: 2, maxMb: 8 },
  tvBanner: { label: 'Biểu ngữ TV', max: 1, size: [1280, 720], maxMb: 15 },
  tvScreenshots: { label: 'Ảnh chụp TV', max: 8, minSide: 320, maxSide: 3840, maxRatio: 2, maxMb: 8 },
  wearScreenshots: { label: 'Ảnh chụp Wear OS', max: 8, minSide: 384, maxSide: 3840, maxRatio: 1, maxMb: 8 },
};

const TYPE_ALIAS: Record<string, ImageType> = {
  icon: 'icon', feature: 'featureGraphic', featuregraphic: 'featureGraphic', banner: 'tvBanner', tvbanner: 'tvBanner',
  phone: 'phoneScreenshots', phonescreenshots: 'phoneScreenshots', screenshots: 'phoneScreenshots',
  tablet7: 'sevenInchScreenshots', '7inch': 'sevenInchScreenshots', seveninchscreenshots: 'sevenInchScreenshots',
  tablet10: 'tenInchScreenshots', tablet: 'tenInchScreenshots', '10inch': 'tenInchScreenshots', teninchscreenshots: 'tenInchScreenshots',
  tv: 'tvScreenshots', tvscreenshots: 'tvScreenshots', wear: 'wearScreenshots', wearscreenshots: 'wearScreenshots',
};
const typeOf = (s: string) => TYPE_ALIAS[s.toLowerCase().replace(/[\s_-]/g, '')] ?? null;

// Đường dẫn tương đối trong thư mục ảnh: <ngôn ngữ>/<loại>/<file> hoặc <ngôn ngữ>/<loại>.png (icon, feature…)
export function imageTarget(rel: string): { language: string; type: ImageType } | null {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2 || !/\.(png|jpe?g)$/i.test(parts.at(-1)!)) return null;
  const language = normalizeLang(parts[0]);
  if (!language) return null;
  const type = parts.length >= 3 ? typeOf(parts[1]) : typeOf(parts[1].replace(/\.[^.]+$/, ''));
  return type ? { language, type } : null;
}

export function checkImage(type: ImageType, img: { width: number; height: number; sizeBytes: number }): string[] {
  const s = IMAGE_SPEC[type];
  const out: string[] = [];
  const { width: w, height: h } = img;
  if (s.size && (w !== s.size[0] || h !== s.size[1])) out.push(`Cần ${s.size[0]}×${s.size[1]}, ảnh là ${w}×${h}`);
  if (s.minSide && Math.min(w, h) < s.minSide) out.push(`Cạnh ngắn tối thiểu ${s.minSide}px`);
  if (s.maxSide && Math.max(w, h) > s.maxSide) out.push(`Cạnh dài tối đa ${s.maxSide}px`);
  if (s.maxRatio && Math.max(w, h) / Math.min(w, h) > s.maxRatio + 1e-9) out.push(s.maxRatio === 1 ? 'Phải là ảnh vuông' : `Tỉ lệ tối đa ${s.maxRatio}:1`);
  if (img.sizeBytes > s.maxMb * 1024 * 1024) out.push(`Tối đa ${s.maxMb} MB`);
  return out;
}

export interface PlayImage {
  id: string;
  url: string;
  sha256: string;
}
export type LanguageImages = Partial<Record<ImageType, PlayImage[]>>;

export interface LocalImage {
  path: string;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  issues: string[];
}

export interface ImageSet {
  language: string;
  type: ImageType;
  files: LocalImage[];
}

export interface PickImagesResult {
  root: string;
  sets: ImageSet[];
  skipped: string[]; // đường dẫn tương đối không đúng cấu trúc
}

// ── Dữ liệu trao đổi qua IPC ────────────────────────────────────────────────
export interface PlayListing {
  packageName: string;
  defaultLanguage: string;
  listings: ListingText[];
  fetchedAt: string;
}

export interface PushResult {
  languages: number;
  removed: number;
  images: number;
  sentForReview: boolean;
}

export const PackageNameSchema = z.string().regex(/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/, 'Package name dạng com.company.app');
const LangSchema = z.string().refine((c) => BY_LOWER.has(c.toLowerCase()), 'Play không hỗ trợ ngôn ngữ này');

export const ListingTextSchema = z.object({
  language: LangSchema,
  title: z.string().trim().min(1).refine((s) => playLength(s) <= LISTING_MAX.title, 'Tên ứng dụng quá 30 ký tự'),
  shortDescription: z.string().trim().min(1).refine((s) => playLength(s) <= LISTING_MAX.shortDescription, 'Mô tả ngắn quá 80 ký tự'),
  fullDescription: z.string().trim().min(1).refine((s) => playLength(s) <= LISTING_MAX.fullDescription, 'Mô tả đầy đủ quá 4000 ký tự'),
  video: z.string().trim().refine((s) => !s || YOUTUBE.test(s), 'Video phải là link YouTube'),
});

export const PushListingSchema = z.object({
  accountId: z.string().min(1),
  packageName: PackageNameSchema,
  upsert: z.array(ListingTextSchema).max(PLAY_LANGUAGES.length),
  remove: z.array(LangSchema).max(PLAY_LANGUAGES.length),
  images: z
    .array(z.object({ language: LangSchema, type: z.enum(IMAGE_TYPES), paths: z.array(z.string().min(1)).min(1).max(8) }))
    .max(PLAY_LANGUAGES.length * IMAGE_TYPES.length),
  sendForReview: z.boolean(),
});
export type PushListingRequest = z.infer<typeof PushListingSchema>;
