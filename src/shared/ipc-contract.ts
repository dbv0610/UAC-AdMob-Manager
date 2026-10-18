import type { Plan, PlanDraft, PlanRecord, ValidateResult } from './plan';
import type { AdUnitDetail, AlertPrefs, CampaignDetail, AnalyticsRange, AnalyticsResult, Breakdown, CountryDetail, Dim, SyncStatus } from './analytics';
import type { Rule, RuleTestResult, RuleWithMeta, SuggestionRow } from './rules';
import type { ChangeEventRow, Pacing, VideoPerfResult } from './insights';
import type { TranslateRequest, TranslateResult, TextField } from './adtext';
import type { AppLookup } from './storeLink';
import type { ApplyReplaceRequest, RcFetched, RcProject, RcTemplate, RcVersion, ReplacePlan, ReplaceQuery } from './remoteConfig';
import type { PlayOverview, PlayReview, PlayTrack, ReplyRequest, ReplyTemplate, UpdateReleaseRequest, VitalsAlertPrefs, VitalsData } from './playOps';
import type { LanguageImages, ListingText, PickImagesResult, PlayListing, PushListingRequest, PushResult } from './listing';
import type { AttachPreview, Aspect, Creative, CreativePatch, ImportResult, LowVideo, UploadRequest } from './creative';
import type {
  TelegramStatus,
  Account,
  AccountKind,
  AdmobPublisher,
  AdsCustomer,
  AppEvent,
  AppInfo,
  AppMapping,
  CampaignChange,
  CampaignRow,
  ConversionAction,
  Job,
  Prefs,
  QuotaToday,
  RangePreset,
  SecretsStatus,
  UploaderState,
  YoutubeChannel,
} from './types';

// Mọi kênh IPC định nghĩa ở đây. Main và preload cùng đọc CHANNELS nên sai tên kênh
// hoặc sai kiểu sẽ báo lỗi lúc build.

export interface DesktopApi {
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    exportDiagnostics(): Promise<string | null>; // đường dẫn file zip, null nếu hủy
    revealDiagnostics(path: string): Promise<void>;
    updateReady(): Promise<string | null>;
    installUpdate(): Promise<void>;
  };
  prefs: {
    get(): Promise<Prefs>;
    set(patch: Partial<Prefs>): Promise<Prefs>;
  };
  secrets: {
    status(): Promise<SecretsStatus>;
    setOAuthClient(input: { clientId: string; clientSecret: string }): Promise<SecretsStatus>;
    setDeveloperToken(token: string): Promise<SecretsStatus>;
    setAiKey(key: string | null): Promise<SecretsStatus>; // null = xóa
  };
  auth: {
    signIn(kind: AccountKind): Promise<Account>;
    listAccounts(): Promise<Account[]>;
    signOut(accountId: string): Promise<void>;
  };
  directory: {
    adsCustomers(): Promise<AdsCustomer[]>; // đọc cache SQLite
    admobPublishers(): Promise<AdmobPublisher[]>;
    youtubeChannels(): Promise<YoutubeChannel[]>;
    refresh(accountId: string): Promise<{ jobId: string }>; // gọi API, chạy nền
  };
  apps: {
    list(): Promise<AppMapping[]>;
    save(app: Omit<AppMapping, 'id'> & { id?: string }): Promise<AppMapping>;
    remove(id: string): Promise<void>;
    lookup(link: string): Promise<AppLookup>; // dán link cửa hàng → tên, icon, package, AdMob app ID, tài khoản Ads
    refreshIcons(force: boolean): Promise<number>; // lấy icon cho app đã map (force = lấy lại cả app đã có)
  };
  jobs: {
    list(): Promise<Job[]>;
  };
  quota: {
    today(): Promise<QuotaToday>;
  };
  plans: {
    getDraft(): Promise<PlanDraft | null>;
    saveDraft(draft: PlanDraft | null): Promise<void>;
    list(): Promise<PlanRecord[]>;
    get(id: string): Promise<PlanRecord>;
    previewNames(plan: Plan): Promise<Record<string, string>>;
    validate(plan: Plan): Promise<ValidateResult>; // chạy nền, có tiến trình trong JobDrawer
    create(plan: Plan): Promise<{ jobId: string; plan: PlanRecord }>;
    retry(planId: string): Promise<{ jobId: string }>; // chỉ các quốc gia lỗi
  };
  ads: {
    campaigns(customerId: string, range: RangePreset): Promise<CampaignRow[]>;
    conversionActions(customerId: string): Promise<ConversionAction[]>;
    applyChanges(input: { customerId: string; changes: CampaignChange[] }): Promise<{ applied: number; operations: number }>;
  };
  creatives: {
    list(): Promise<Creative[]>;
    pick(mode: 'files' | 'folder', appId: string | null): Promise<ImportResult | null>; // hộp thoại chọn của hệ điều hành
    importPaths(input: { paths: string[]; appId: string | null }): Promise<ImportResult>; // kéo thả
    addYoutubeIds(input: { text: string; appId: string | null; aspect: Aspect | null; countries: string[] }): Promise<{ added: number; duplicates: number; invalid: string[] }>;
    patch(p: CreativePatch): Promise<void>;
    remove(ids: string[]): Promise<void>; // chỉ xóa khỏi thư viện, file gốc giữ nguyên
    reveal(id: string): Promise<void>;
    upload(input: UploadRequest): Promise<{ queued: number }>;
    pause(ids: string[]): Promise<void>;
    cancel(ids: string[]): Promise<void>;
    uploaderState(): Promise<UploaderState>;
    refreshStatus(): Promise<void>; // poll YouTube ngay thay vì chờ 60s
    previewAttach(input: { customerId: string; campaignIds: string[]; videoIds: string[] }): Promise<AttachPreview[]>;
    attach(input: { customerId: string; campaignIds: string[]; videoIds: string[] }): Promise<{ campaigns: number; ads: number; operations: number }>;
    scanLow(customerId: string): Promise<LowVideo[]>; // quét video LOW trên Google Ads (chạy nền)
    lowCached(customerId: string): Promise<{ at: string; items: LowVideo[] } | null>;
    replace(input: { customerId: string; items: { adResource: string; campaignId: string; removeAsset: string; addVideoId: string }[] }): Promise<{ ads: number; operations: number }>;
    videoPerf(customerId: string, range: RangePreset): Promise<VideoPerfResult>; // gọi Google Ads
    videoPerfCached(customerId: string): Promise<VideoPerfResult | null>;
  };
  analytics: {
    get(appId: string | null, range: AnalyticsRange): Promise<AnalyticsResult>; // đọc SQLite, không gọi API
    country(appId: string | null, range: AnalyticsRange, country: string): Promise<CountryDetail>;
    breakdown(appId: string | null, range: AnalyticsRange, dim: Dim, country: string | null): Promise<Breakdown>;
    adUnit(appId: string | null, range: AnalyticsRange, unitId: string): Promise<AdUnitDetail>;
    campaign(appId: string | null, range: AnalyticsRange, campaignId: string): Promise<CampaignDetail>;
    changes(appId: string | null, range: AnalyticsRange, campaignId: string | null): Promise<ChangeEventRow[]>;
    pacing(customerId: string): Promise<Pacing & { currency: string }>;
    setMonthlyBudget(customerId: string, amount: number | null): Promise<void>;
    syncStatus(): Promise<SyncStatus>;
    sync(days: number): Promise<{ jobId: string }>;
    export(appId: string | null, range: AnalyticsRange, format: 'csv' | 'xlsx', dim?: Dim): Promise<string | null>;
    revealExport(path: string): Promise<void>;
    alertPrefs(): Promise<AlertPrefs>;
    setAlertPrefs(p: AlertPrefs): Promise<AlertPrefs>;
  };
  ai: {
    translate(req: TranslateRequest): Promise<TranslateResult[]>; // chạy nền, có tiến trình
    saveTexts(input: { appId: string; lang: string; items: { field: TextField; text: string }[] }): Promise<void>;
    library(appId: string): Promise<{ lang: string; field: TextField; text: string }[]>;
    summary(appId: string | null, range: AnalyticsRange, refresh: boolean): Promise<{ at: string; text: string; from: string; to: string }>;
    summaryCached(appId: string | null, range: AnalyticsRange): Promise<{ at: string; text: string; from: string; to: string } | null>;
  };
  notify: {
    status(): Promise<TelegramStatus>;
    setToken(token: string | null): Promise<TelegramStatus>; // null = xóa
    detectChat(): Promise<TelegramStatus>;
    setConfig(c: { enabled: boolean; events: TelegramStatus['events'] }): Promise<TelegramStatus>;
    test(): Promise<void>;
  };
  rules: {
    list(): Promise<RuleWithMeta[]>;
    save(rule: Rule): Promise<Rule>;
    remove(id: string): Promise<void>;
    test(rule: Rule): Promise<RuleTestResult>; // chạy thử trên dữ liệu hôm nay, không ghi gì
    run(): Promise<{ jobId: string }>;
    suggestions(scope: 'pending' | 'history'): Promise<SuggestionRow[]>;
    pendingCount(): Promise<number>;
    approve(ids: string[]): Promise<{ applied: number; failed: number }>;
    dismiss(ids: string[]): Promise<void>;
  };
  play: {
    pull(accountId: string, packageName: string): Promise<PlayListing>; // mở edit, đọc, bỏ edit
    images(accountId: string, packageName: string, language: string): Promise<LanguageImages>;
    push(req: PushListingRequest): Promise<PushResult>; // chạy nền, có tiến trình trong JobDrawer
    pickImages(): Promise<PickImagesResult | null>; // hộp thoại chọn thư mục ảnh
    importXlsx(): Promise<{ file: string; texts: ListingText[]; errors: string[] } | null>;
    exportXlsx(packageName: string, texts: ListingText[]): Promise<string | null>;
    revealExport(path: string): Promise<void>;
    tracks(accountId: string, packageName: string): Promise<PlayTrack[]>;
    updateRelease(req: UpdateReleaseRequest): Promise<PlayTrack>; // đọc lại track trong edit rồi mới ghi
    vitals(packageName: string): Promise<VitalsData | null>; // cache trên máy
    syncVitals(accountId: string, packageName: string): Promise<VitalsData>;
    reviews(accountId: string, packageName: string): Promise<PlayReview[]>;
    reply(req: ReplyRequest): Promise<{ text: string; at: string }>;
    suggestReply(input: { appName: string | null; rating: number; text: string; language: string | null }): Promise<string>;
    overview(): Promise<PlayOverview>; // chạy nền, có tiến trình
    overviewCached(): Promise<PlayOverview | null>;
    resolveAccount(packageName: string): Promise<string>; // tài khoản Play có quyền với app (dò rồi nhớ)
    vitalsAlerts(): Promise<VitalsAlertPrefs>;
    setVitalsAlerts(p: VitalsAlertPrefs): Promise<VitalsAlertPrefs>;
    replyTemplates(): Promise<ReplyTemplate[]>;
    setReplyTemplates(t: ReplyTemplate[]): Promise<ReplyTemplate[]>;
  };
  rc: {
    projects(): Promise<RcProject[]>; // danh mục đã đọc (accounts.meta)
    template(accountId: string, projectId: string): Promise<RcFetched>;
    publish(req: { accountId: string; projectId: string; etag: string; template: RcTemplate; description?: string }): Promise<RcFetched>; // validateOnly rồi publish với If-Match
    planReplace(req: { targets: { accountId: string; projectId: string }[]; query: ReplaceQuery }): Promise<ReplacePlan[]>; // chỉ đọc, chạy nền
    applyReplace(req: ApplyReplaceRequest): Promise<{ projectId: string; ok: boolean; changed: number; message: string | null }[]>;
    versions(accountId: string, projectId: string): Promise<RcVersion[]>;
    version(accountId: string, projectId: string, versionNumber: string): Promise<RcTemplate>;
    rollback(accountId: string, projectId: string, versionNumber: string): Promise<RcFetched>;
  };
  events: {
    on(cb: (e: AppEvent) => void): () => void;
  };
  files: {
    pathFor(file: File): string; // đường dẫn thật của file kéo thả (webUtils, chỉ trong preload)
  };
}

type InvokeNamespaces = Exclude<keyof DesktopApi, 'events' | 'files'>;

// Danh sách whitelist kênh invoke: preload chỉ mở đúng những kênh này.
export const CHANNELS = {
  app: ['info', 'openExternal', 'exportDiagnostics', 'revealDiagnostics', 'updateReady', 'installUpdate'],
  prefs: ['get', 'set'],
  secrets: ['status', 'setOAuthClient', 'setDeveloperToken', 'setAiKey'],
  auth: ['signIn', 'listAccounts', 'signOut'],
  directory: ['adsCustomers', 'admobPublishers', 'youtubeChannels', 'refresh'],
  apps: ['list', 'save', 'remove', 'lookup', 'refreshIcons'],
  jobs: ['list'],
  quota: ['today'],
  plans: ['getDraft', 'saveDraft', 'list', 'get', 'previewNames', 'validate', 'create', 'retry'],
  ads: ['campaigns', 'conversionActions', 'applyChanges'],
  ai: ['translate', 'saveTexts', 'library', 'summary', 'summaryCached'],
  notify: ['status', 'setToken', 'detectChat', 'setConfig', 'test'],
  rules: ['list', 'save', 'remove', 'test', 'run', 'suggestions', 'pendingCount', 'approve', 'dismiss'],
  analytics: ['get', 'country', 'breakdown', 'adUnit', 'campaign', 'changes', 'pacing', 'setMonthlyBudget', 'syncStatus', 'sync', 'export', 'revealExport', 'alertPrefs', 'setAlertPrefs'],
  play: ['pull', 'images', 'push', 'pickImages', 'importXlsx', 'exportXlsx', 'revealExport', 'tracks', 'updateRelease', 'vitals', 'syncVitals', 'reviews', 'reply', 'suggestReply', 'overview', 'overviewCached', 'resolveAccount', 'vitalsAlerts', 'setVitalsAlerts', 'replyTemplates', 'setReplyTemplates'],
  rc: ['projects', 'template', 'publish', 'planReplace', 'applyReplace', 'versions', 'version', 'rollback'],
  creatives: ['list', 'pick', 'importPaths', 'addYoutubeIds', 'patch', 'remove', 'reveal', 'upload', 'pause', 'cancel', 'uploaderState', 'refreshStatus', 'previewAttach', 'attach', 'scanLow', 'lowCached', 'replace', 'videoPerf', 'videoPerfCached'],
} as const satisfies { [N in InvokeNamespaces]: readonly (keyof DesktopApi[N])[] };

export const EVENT_CHANNEL = 'app:event';

export const channelName = (ns: string, method: string) => `${ns}:${method}`;

export type Handler<N extends InvokeNamespaces, M extends keyof DesktopApi[N]> = DesktopApi[N][M];
export type { InvokeNamespaces };
