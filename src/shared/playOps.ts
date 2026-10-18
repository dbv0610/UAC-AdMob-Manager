// Vận hành app trên Google Play: release theo track, vitals (crash/ANR), review người dùng, bảng tổng quan.
// Dùng chung main + renderer: quy tắc đổi trạng thái release, ngưỡng vitals, thống kê review.
import { z } from 'zod';
import { PackageNameSchema } from './listing';

// ── Release ─────────────────────────────────────────────────────────────────
export type ReleaseStatus = 'draft' | 'inProgress' | 'halted' | 'completed';

export interface PlayRelease {
  key: string; // versionCodes nối bằng dấu phẩy (draft chưa có bản build thì dùng tên)
  name: string;
  versionCodes: string[];
  status: ReleaseStatus;
  userFraction: number | null; // 0–1, chỉ có khi đang rollout từng phần
  notesLanguages: string[];
}

export interface PlayTrack {
  track: string;
  releases: PlayRelease[];
}

export const TRACK_LABEL: Record<string, string> = {
  production: 'Chính thức',
  beta: 'Thử nghiệm mở',
  alpha: 'Thử nghiệm kín',
  internal: 'Thử nghiệm nội bộ',
};
export const trackLabel = (t: string) => TRACK_LABEL[t] ?? `Kênh kín: ${t}`;
export const TRACK_ORDER = ['production', 'beta', 'alpha', 'internal'];

export const STATUS_LABEL: Record<ReleaseStatus, string> = { draft: 'Bản nháp', inProgress: 'Đang rollout', halted: 'Tạm dừng', completed: 'Hoàn tất' };

interface ReleaseLike {
  name?: string | null;
  versionCodes?: string[] | null;
  status?: string | null;
  userFraction?: number | null;
}
export const releaseKey = (r: ReleaseLike) => (r.versionCodes?.length ? r.versionCodes.join(',') : `name:${r.name ?? ''}`);

export type ReleaseAction = { kind: 'rollout'; fraction: number } | { kind: 'complete' } | { kind: 'halt' } | { kind: 'resume' };

export const ROLLOUT_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5];

export function describeAction(a: ReleaseAction) {
  if (a.kind === 'rollout') return `Rollout ${+(a.fraction * 100).toFixed(2)}%`;
  return { complete: 'Phát hành 100%', halt: 'Tạm dừng rollout', resume: 'Tiếp tục rollout' }[a.kind];
}

// Áp hành động lên danh sách release của một track theo quy tắc Play:
// - inProgress/halted bắt buộc có userFraction trong (0, 1); completed không có userFraction
// - mỗi track tối đa 1 completed + 1 inProgress/halted; hoàn tất bản mới thì bản completed cũ bị thay
// - không giảm % rollout được (phải tạm dừng)
// Giữ nguyên mọi trường khác của release (release notes, quốc gia…) để tracks.update không làm mất.
export function applyReleaseAction<R extends ReleaseLike>(releases: R[], key: string, action: ReleaseAction): { releases: R[] } | { error: string } {
  const target = releases.find((r) => releaseKey(r) === key);
  if (!target) return { error: 'Không tìm thấy bản phát hành — tải lại rồi thử lại' };
  if (!target.versionCodes?.length) return { error: 'Bản nháp chưa có APK/AAB — thêm bản build trên Play Console trước' };
  const status = target.status as ReleaseStatus;
  const cur = target.userFraction ?? null;
  let next: R;

  switch (action.kind) {
    case 'rollout': {
      const f = action.fraction;
      if (!(f > 0 && f < 1)) return { error: 'Tỉ lệ rollout phải lớn hơn 0% và nhỏ hơn 100% (100% = Phát hành 100%)' };
      if (status === 'completed') return { error: 'Bản này đã phát hành 100%' };
      if (cur != null && f <= cur + 1e-9) return { error: `Play không cho giảm hoặc giữ nguyên % rollout (đang ${+(cur * 100).toFixed(2)}%) — muốn dừng thì bấm Tạm dừng` };
      next = { ...target, status: 'inProgress', userFraction: f };
      break;
    }
    case 'complete':
      if (status === 'completed') return { error: 'Bản này đã phát hành 100%' };
      next = { ...target, status: 'completed', userFraction: null };
      break;
    case 'halt':
      if (status !== 'inProgress') return { error: 'Chỉ tạm dừng được bản đang rollout' };
      next = { ...target, status: 'halted' };
      break;
    case 'resume':
      if (status !== 'halted') return { error: 'Chỉ tiếp tục được bản đang tạm dừng' };
      next = { ...target, status: 'inProgress' };
      break;
  }
  // Bản đang rollout/tạm dừng khác trong cùng track không được tồn tại song song
  if (next.status === 'inProgress' && releases.some((r) => r !== target && (r.status === 'inProgress' || r.status === 'halted'))) {
    return { error: 'Track đang có bản khác rollout dở — hoàn tất hoặc tạm dừng bản đó trước' };
  }
  const out = releases
    .filter((r) => r === target || !(next.status === 'completed' && r.status === 'completed'))
    .map((r) => {
      if (r !== target) return r;
      const { userFraction: _drop, ...rest } = next;
      return (next.status === 'completed' ? rest : next) as R;
    });
  return { releases: out };
}

// Giai đoạn của app suy ra từ các track: app chưa lên chính thức (đang thử nghiệm kín/mở/nội bộ) vẫn quản lý được
export type AppStage = 'production' | 'open' | 'closed' | 'internal' | 'none';
export const STAGE_LABEL: Record<AppStage, string> = {
  production: 'Chính thức',
  open: 'Thử nghiệm mở',
  closed: 'Thử nghiệm kín',
  internal: 'Thử nghiệm nội bộ',
  none: 'Chưa phát hành',
};
const live = (t: PlayTrack | undefined) => !!t?.releases.some((r) => r.status === 'completed' || r.status === 'inProgress' || r.status === 'halted');

export function appStage(tracks: PlayTrack[]): AppStage {
  const by = (name: string) => tracks.find((t) => t.track === name);
  if (live(by('production'))) return 'production';
  if (live(by('beta'))) return 'open';
  // alpha = kênh kín mặc định; kênh kín tự đặt tên không nằm trong 4 tên chuẩn
  if (live(by('alpha')) || tracks.some((t) => !TRACK_ORDER.includes(t.track) && live(t))) return 'closed';
  if (live(by('internal'))) return 'internal';
  return 'none';
}

// Track chính để hiển thị ở bảng tổng quan theo giai đoạn
export function stageTrack(tracks: PlayTrack[]): PlayTrack | undefined {
  const st = appStage(tracks);
  if (st === 'production') return tracks.find((t) => t.track === 'production');
  if (st === 'open') return tracks.find((t) => t.track === 'beta');
  if (st === 'closed') return tracks.find((t) => t.track === 'alpha' && live(t)) ?? tracks.find((t) => !TRACK_ORDER.includes(t.track) && live(t));
  if (st === 'internal') return tracks.find((t) => t.track === 'internal');
  return tracks.find((t) => t.releases.length);
}

// ── Vitals ──────────────────────────────────────────────────────────────────
export interface VitalsDay {
  date: string; // YYYY-MM-DD (giờ Thái Bình Dương, như Play Console)
  crashRate: number | null;
  userCrashRate: number | null; // user-perceived: chỉ số Google dùng để xét "hành vi xấu"
  anrRate: number | null;
  userAnrRate: number | null;
  users: number | null;
}

// Theo phiên bản: gộp 7 ngày dữ liệu gần nhất, có trọng số người dùng
export interface VitalsVersion {
  versionCode: string;
  userCrashRate: number | null;
  userAnrRate: number | null;
  users: number;
  lastDate: string;
}

export interface VitalsData {
  packageName: string;
  at: string;
  days: VitalsDay[];
  versions?: VitalsVersion[];
}

// Ngưỡng tự đặt: báo khi một ngày hoặc một phiên bản vượt; tự tạm dừng rollout là tùy chọn (mặc định tắt)
export interface VitalsAlertPrefs {
  crash: number; // tỉ lệ 0–1
  anr: number;
  daily: boolean; // báo theo ngày mới nhất, không chờ trung bình 28 ngày
  autoHalt: boolean; // bản đang rollout vượt ngưỡng → tạm dừng rollout
  minUsers: number; // bỏ qua khi quá ít người dùng (app thử nghiệm kín)
}
export const DEFAULT_VITALS_ALERTS: VitalsAlertPrefs = { crash: 0.0109, anr: 0.0047, daily: true, autoHalt: false, minUsers: 200 };

export const VitalsAlertPrefsSchema = z.object({
  crash: z.number().gt(0).lt(1),
  anr: z.number().gt(0).lt(1),
  daily: z.boolean(),
  autoHalt: z.boolean(),
  minUsers: z.number().int().min(0).max(1e7),
});

export interface VitalsBreach {
  scope: 'day' | 'version' | 'avg28';
  label: string; // ngày / version code
  metric: 'crash' | 'anr';
  value: number;
  limit: number;
}

// Các vi phạm ngưỡng tự đặt trong dữ liệu mới nhất (dùng cho cảnh báo và tự tạm dừng)
export function vitalsBreaches(data: VitalsData, prefs: VitalsAlertPrefs): VitalsBreach[] {
  const out: VitalsBreach[] = [];
  const s = summarizeVitals(data.days);
  if (s.userCrash28 != null && s.userCrash28 >= VITALS_BAD.userCrashRate) out.push({ scope: 'avg28', label: '28 ngày', metric: 'crash', value: s.userCrash28, limit: VITALS_BAD.userCrashRate });
  if (s.userAnr28 != null && s.userAnr28 >= VITALS_BAD.userAnrRate) out.push({ scope: 'avg28', label: '28 ngày', metric: 'anr', value: s.userAnr28, limit: VITALS_BAD.userAnrRate });
  const d = s.latest;
  if (prefs.daily && d && (d.users ?? 0) >= prefs.minUsers) {
    if (d.userCrashRate != null && d.userCrashRate >= prefs.crash) out.push({ scope: 'day', label: d.date, metric: 'crash', value: d.userCrashRate, limit: prefs.crash });
    if (d.userAnrRate != null && d.userAnrRate >= prefs.anr) out.push({ scope: 'day', label: d.date, metric: 'anr', value: d.userAnrRate, limit: prefs.anr });
  }
  for (const v of data.versions ?? []) {
    if (v.users < prefs.minUsers) continue;
    if (v.userCrashRate != null && v.userCrashRate >= prefs.crash) out.push({ scope: 'version', label: v.versionCode, metric: 'crash', value: v.userCrashRate, limit: prefs.crash });
    if (v.userAnrRate != null && v.userAnrRate >= prefs.anr) out.push({ scope: 'version', label: v.versionCode, metric: 'anr', value: v.userAnrRate, limit: prefs.anr });
  }
  return out;
}

// Ngưỡng hành vi xấu của Google (trung bình 28 ngày, toàn bộ thiết bị)
export const VITALS_BAD = { userCrashRate: 0.0109, userAnrRate: 0.0047 };
export type VitalsLevel = 'good' | 'warn' | 'bad';

const levelOf = (v: number | null, bad: number): VitalsLevel | null => (v == null ? null : v >= bad ? 'bad' : v >= bad * 0.8 ? 'warn' : 'good');

// Trung bình có trọng số theo số người dùng (ngày thiếu users thì tính đều)
function avg28(days: VitalsDay[], k: 'userCrashRate' | 'userAnrRate') {
  const rows = days.slice(-28).filter((d) => d[k] != null);
  if (!rows.length) return null;
  const w = rows.map((d) => d.users ?? 1);
  return rows.reduce((s, d, i) => s + d[k]! * w[i], 0) / w.reduce((a, b) => a + b, 0);
}

export interface VitalsSummary {
  latest: VitalsDay | null;
  userCrash28: number | null;
  userAnr28: number | null;
  crash: VitalsLevel | null;
  anr: VitalsLevel | null;
}

export function summarizeVitals(days: VitalsDay[]): VitalsSummary {
  const userCrash28 = avg28(days, 'userCrashRate');
  const userAnr28 = avg28(days, 'userAnrRate');
  return {
    latest: days.at(-1) ?? null,
    userCrash28,
    userAnr28,
    crash: levelOf(userCrash28, VITALS_BAD.userCrashRate),
    anr: levelOf(userAnr28, VITALS_BAD.userAnrRate),
  };
}

// ── Review ──────────────────────────────────────────────────────────────────
const REPLY_MAX_RAW = 350;
export const REPLY_MAX = REPLY_MAX_RAW;
export interface PlayReview {
  id: string;
  author: string;
  rating: number; // 1–5
  text: string;
  language: string | null;
  device: string | null;
  appVersion: string | null;
  androidVersion: number | null;
  at: string; // ISO
  thumbsUp: number;
  reply: { text: string; at: string } | null;
  translated: string | null; // bản dịch tiếng Việt của Google (null nếu review đã là tiếng Việt)
}

// Câu trả lời mẫu: {app} được thay bằng tên app
export interface ReplyTemplate {
  id: string;
  name: string;
  text: string;
}
export const fillTemplate = (t: string, appName: string) => t.replaceAll('{app}', appName);
export const ReplyTemplatesSchema = z
  .array(z.object({ id: z.string().min(1).max(50), name: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(REPLY_MAX_RAW) }))
  .max(50);


export interface ReviewStats {
  count: number;
  avg: number | null;
  unanswered: number;
  lowUnanswered: number; // ≤ 2 sao chưa trả lời: nên xử lý trước
}

export function reviewStats(reviews: PlayReview[]): ReviewStats {
  const n = reviews.length;
  return {
    count: n,
    avg: n ? reviews.reduce((s, r) => s + r.rating, 0) / n : null,
    unanswered: reviews.filter((r) => !r.reply).length,
    lowUnanswered: reviews.filter((r) => !r.reply && r.rating <= 2).length,
  };
}

// ── Tổng quan ───────────────────────────────────────────────────────────────
export interface AppOverview {
  appId: string;
  name: string;
  packageName: string;
  accountId: string | null;
  stage: AppStage;
  tracks: PlayTrack[];
  vitals: VitalsSummary | null;
  vitalsAt: string | null;
  reviews: ReviewStats | null;
  lastListingAt: string | null; // lần đẩy trang thông tin gần nhất từ app này
  vitalsScopeMissing?: boolean; // tài khoản chưa cấp quyền Reporting API — báo một lần ở đầu bảng, không tính là lỗi app
  errors: string[];
}

export interface PlayOverview {
  at: string;
  apps: AppOverview[];
  reauthAccounts?: string[]; // tài khoản Play cần đăng nhập lại để cấp thêm quyền (Vitals)
}

// ── Schema IPC ──────────────────────────────────────────────────────────────
export const ReleaseActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rollout'), fraction: z.number().gt(0).lt(1) }),
  z.object({ kind: z.literal('complete') }),
  z.object({ kind: z.literal('halt') }),
  z.object({ kind: z.literal('resume') }),
]);

export const UpdateReleaseSchema = z.object({
  accountId: z.string().min(1),
  packageName: PackageNameSchema,
  track: z.string().min(1).max(100),
  key: z.string().min(1).max(500),
  action: ReleaseActionSchema,
});
export type UpdateReleaseRequest = z.infer<typeof UpdateReleaseSchema>;

export const ReplySchema = z.object({
  accountId: z.string().min(1),
  packageName: PackageNameSchema,
  reviewId: z.string().min(1).max(500),
  text: z.string().trim().min(1, 'Câu trả lời đang trống').max(REPLY_MAX, `Tối đa ${REPLY_MAX} ký tự`),
});
export type ReplyRequest = z.infer<typeof ReplySchema>;
