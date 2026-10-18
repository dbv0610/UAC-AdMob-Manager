// Kiểu dùng chung giữa main, preload và renderer. Không import gì từ Node/Electron ở đây.
import type { PlanRecord } from './plan';
import type { Creative } from './creative';
import type { SyncStatus } from './analytics';

export type AccountKind = 'ads' | 'admob' | 'youtube' | 'play' | 'firebase';
export type AccountStatus = 'active' | 'reauth';

export interface Account {
  id: string; // `${kind}:${googleSub}`
  email: string;
  kind: AccountKind;
  scopes: string[];
  status: AccountStatus;
  createdAt: string;
}

export interface AdsCustomer {
  customerId: string;
  loginCustomerId: string | null; // MCC dùng làm login-customer-id, null nếu truy cập trực tiếp
  name: string;
  currency: string;
  timeZone: string;
  manager: boolean;
  level: number; // 0 = gốc, dùng để vẽ cây
  accountId: string;
}

export interface AdmobPublisher {
  publisherId: string; // pub-xxxx
  name: string;
  currency: string;
  timeZone: string;
  accountId: string;
}

export interface YoutubeChannel {
  channelId: string;
  title: string;
  thumbnail: string | null;
  accountId: string;
}

export type Store = 'GOOGLE_PLAY' | 'APPLE_APP_STORE';

export interface AppMapping {
  id: string;
  name: string;
  store: Store;
  storeAppId: string; // package name hoặc App Store ID
  admobAppId: string | null;
  adsCustomerId: string | null;
  roasTarget: number | null;
  iconUrl: string | null; // https, lấy tự động khi dò link cửa hàng
}

export type Theme = 'system' | 'dark' | 'light';
export type Density = 'compact' | 'comfortable';
export type RangePreset = 'last7' | 'last14' | 'last30' | 'all'; // all = từ trước đến nay

export interface Prefs {
  theme: Theme;
  density: Density;
  zoom: number; // 0.9 – 1.25
  locale: 'vi-VN' | 'en-US';
  sidebarCollapsed: boolean;
  jobDrawerOpen: boolean;
  currentAppId: string | null;
  currentAdsCustomerId: string | null;
  range: RangePreset;
  onboardingDone: boolean;
  nameTemplate: string;
  youtubeAccountId: string | null; // tài khoản YouTube dùng để upload
  uploadVia: 'ads' | 'youtube'; // mặc định qua Google Ads (không cần tài khoản YouTube/audit)
  uploadCustomerId: string | null;
  autoSync: boolean; // đồng bộ báo cáo + chạy rule mỗi ngày
  syncHour: number; // 0–23 giờ máy
  closeToTray: boolean; // đóng cửa sổ = chạy nền ở tray
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  safeStorage: { available: boolean; backend: string | null };
  online: boolean;
}

export interface SecretsStatus {
  oauthClient: 'settings' | 'bundled' | 'missing';
  clientId: string | null; // không phải bí mật; hiện để đối chiếu đúng project Google Cloud
  projectNumber: string | null; // phần số đầu của client ID
  developerToken: boolean;
  aiKey: boolean; // API key Claude cho AI dịch
}

export type JobKind = 'signIn' | 'syncDirectory' | 'validatePlan' | 'createCampaigns' | 'bulkEdit' | 'importCreatives' | 'uploadVideos' | 'runRules' | 'translate' | 'replaceCreatives' | 'syncReports' | 'pushListing' | 'playRelease' | 'playOverview' | 'syncVitals' | 'rcPublish' | 'rcReplace';
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'paused';

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  state: JobState;
  progress: { done: number; total: number; unit?: '%' | 'items' } | null;
  error: AppError | null;
  createdAt: string;
  updatedAt: string;
}

// Lỗi trả về UI luôn có gợi ý hành động (nguyên tắc 5)
export type ErrorAction = 'retry' | 'reauth' | 'openSettings' | 'fix';
export interface AppError {
  message: string;
  code?: string;
  action?: ErrorAction;
  accountId?: string;
  requestId?: string;
  field?: string;
}

export type AppEvent =
  | { type: 'job'; job: Job }
  | { type: 'accounts'; accounts: Account[] }
  | { type: 'online'; online: boolean }
  | { type: 'quota'; quota: QuotaToday }
  | { type: 'plan'; plan: PlanRecord }
  | { type: 'creatives'; creatives: Creative[] } // thêm mới hoặc cập nhật
  | { type: 'creativesRemoved'; ids: string[] }
  | { type: 'uploadProgress'; id: string; pct: number }
  | { type: 'uploader'; state: UploaderState }
  | { type: 'reportSync'; status: SyncStatus }
  | { type: 'suggestions'; pending: number }
  | { type: 'update'; version: string } // bản cập nhật đã tải xong
  | { type: 'navigate'; to: string }
  | { type: 'command'; name: 'sync' | 'newPlan' | 'toggleJobs' | 'palette' };

// ── Campaign (Giai đoạn 2) ─────────────────────────────────────────────────
export type CampaignStatus = 'ENABLED' | 'PAUSED';

export interface CampaignRow {
  id: string;
  customerId: string;
  name: string;
  status: CampaignStatus;
  country: string | null; // từ lịch sử tạo hoặc hậu tố _XX trong tên
  goalType: string | null;
  appId: string | null;
  budgetResource: string;
  budgetMicros: number;
  budgetShared: boolean; // ngân sách dùng chung: đổi sẽ ảnh hưởng camp khác
  targetCpaMicros: number | null;
  targetRoas: number | null;
  activeDays: number | null; // số ngày từ khi camp bắt đầu — chia chi phí/ngày khi xem “từ trước đến nay”
  costMicros: number;
  conversions: number;
  impressions: number;
}

export type CampaignField = 'budget' | 'status' | 'targetCpa' | 'targetRoas';

export interface CampaignChange {
  campaignId: string;
  name: string;
  field: CampaignField;
  before: number | string;
  after: number | string;
  budgetResource?: string;
}

export interface ConversionAction {
  id: string;
  name: string;
  category: string;
}

export interface QuotaToday {
  adsOperations: number;
  youtubeUploads: number;
}

// ── Upload YouTube (Giai đoạn 3) ─────────────────────────────────────────────
export interface UploaderState {
  running: string | null; // creative đang upload
  queued: number;
  waiting: 'quota' | 'offline' | 'account' | null; // vì sao hàng đợi đang đứng
  resumeAt: string | null; // ISO: lúc tự chạy lại (hết quota → 0h PT)
  accountId: string | null;
}

// ── Thông báo Telegram ──────────────────────────────────────────────────────
export interface TelegramConfig {
  chatId: string | null;
  chatName: string | null;
  botName: string | null;
  enabled: boolean;
  events: { red: boolean; digest: boolean; weekly: boolean }; // cảnh báo đỏ ngay · tóm tắt mỗi sáng · AI tóm tắt thứ Hai
}
export interface TelegramStatus extends TelegramConfig {
  hasToken: boolean;
}
