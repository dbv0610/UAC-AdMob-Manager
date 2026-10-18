import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Tiền lưu bằng micros (số nguyên), ngày lưu 'YYYY-MM-DD'.
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// ── Tài khoản ───────────────────────────────────────────────────────────────
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), // `${kind}:${googleSub}`
  email: text('email').notNull(),
  kind: text('kind', { enum: ['ads', 'admob', 'youtube', 'play', 'firebase'] }).notNull(),
  scopes: text('scopes').notNull(), // cách nhau bởi dấu cách
  refreshTokenEnc: text('refresh_token_enc'),
  status: text('status', { enum: ['active', 'reauth'] }).notNull().default('active'),
  meta: text('meta'), // JSON: publisher AdMob / kênh YouTube đọc được
  createdAt: createdAt(),
});

export const adsCustomers = sqliteTable('ads_customers', {
  customerId: text('customer_id').primaryKey(),
  loginCustomerId: text('login_customer_id'),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  timeZone: text('time_zone').notNull(),
  manager: integer('manager', { mode: 'boolean' }).notNull().default(false),
  level: integer('level').notNull().default(0),
});

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  store: text('store', { enum: ['GOOGLE_PLAY', 'APPLE_APP_STORE'] }).notNull(),
  storeAppId: text('store_app_id').notNull().unique(),
  admobAppId: text('admob_app_id'),
  adsCustomerId: text('ads_customer_id'),
  roasTarget: real('roas_target'),
  iconUrl: text('icon_url'), // ảnh biểu tượng (Play Console / trang cửa hàng)
});

// ── Creative ────────────────────────────────────────────────────────────────
export const creatives = sqliteTable('creatives', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  sha256: text('sha256').notNull().unique(),
  kind: text('kind', { enum: ['video', 'image'] }).notNull(),
  durationS: real('duration_s'),
  width: integer('width'),
  height: integer('height'),
  aspect: text('aspect', { enum: ['landscape', 'portrait', 'square'] }),
  countries: text('countries').notNull().default('[]'), // JSON ISO-2[]
  youtubeId: text('youtube_id'),
  status: text('status').notNull().default('LOCAL'),
  createdAt: createdAt(),
  // Thêm ở GĐ 3
  source: text('source', { enum: ['file', 'youtube'] }).notNull().default('file'), // youtube = nhập ID tay
  appId: text('app_id'),
  name: text('name').notNull().default(''), // tên hiển thị = tiêu đề YouTube
  sizeBytes: integer('size_bytes'),
  privacy: text('privacy'), // privacyStatus YouTube trả về sau upload
  uploadSession: text('upload_session'), // URI phiên resumable: mở lại app vẫn upload tiếp được
  error: text('error'), // JSON AppError
  updatedAt: text('updated_at'),
  // Upload qua Google Ads (kênh YouTube do Google quản lý): 'ads:<customerId>' | 'youtube:<accountId>'
  uploadTarget: text('upload_target'),
  adsUpload: text('ads_upload'), // resource name youTubeVideoUploads/… để poll trạng thái
});

export const assets = sqliteTable(
  'assets',
  {
    customerId: text('customer_id').notNull(),
    creativeId: text('creative_id').notNull(),
    assetResourceName: text('asset_resource_name').notNull(),
    type: text('type', { enum: ['YOUTUBE_VIDEO', 'IMAGE'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.creativeId] })],
);

export const texts = sqliteTable('texts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  appId: text('app_id').notNull(),
  lang: text('lang').notNull(),
  field: text('field', { enum: ['headline', 'description'] }).notNull(),
  text: text('text').notNull(),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
});

// ── Campaign ────────────────────────────────────────────────────────────────
export const plans = sqliteTable('plans', {
  id: text('id').notNull(),
  appId: text('app_id').notNull(),
  version: integer('version').notNull(),
  json: text('json').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.id, t.version] })]);

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), // campaign ID của Google Ads
  planId: text('plan_id'),
  customerId: text('customer_id').notNull(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  goal: text('goal').notNull(),
  status: text('status').notNull(),
  createdAt: createdAt(),
});

// Thuộc tính camp đọc khi đồng bộ chi phí (mọi App campaign, không chỉ camp app tạo): tên + target cho cảnh báo CPI
export const campaignMeta = sqliteTable('campaign_meta', {
  campaignId: text('campaign_id').primaryKey(),
  customerId: text('customer_id').notNull(),
  name: text('name').notNull(),
  appId: text('app_id'),
  status: text('status'),
  targetCpaMicros: integer('target_cpa_micros'),
  targetRoas: real('target_roas'),
  updatedAt: text('updated_at').notNull(),
  // GĐ 5: rule chỉnh ngân sách cần biết ngân sách hiện tại
  budgetMicros: integer('budget_micros'),
  budgetResource: text('budget_resource'),
  budgetShared: integer('budget_shared', { mode: 'boolean' }),
});

// Đề xuất của rules engine: chế độ SUGGEST chờ người dùng duyệt; AUTO ghi luôn trạng thái applied/failed
export const ruleSuggestions = sqliteTable(
  'rule_suggestions',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id').notNull(),
    customerId: text('customer_id').notNull(),
    campaignId: text('campaign_id').notNull(),
    json: text('json').notNull(), // Suggestion
    status: text('status', { enum: ['pending', 'applied', 'dismissed', 'failed', 'expired'] }).notNull(),
    error: text('error'),
    createdAt: createdAt(),
    decidedAt: text('decided_at'),
  },
  (t) => [index('suggest_status').on(t.status, t.createdAt)],
);

// ── Báo cáo ─────────────────────────────────────────────────────────────────
export const spendDaily = sqliteTable(
  'spend_daily',
  {
    date: text('date').notNull(),
    campaignId: text('campaign_id').notNull(),
    country: text('country').notNull(),
    appId: text('app_id').notNull(),
    costMicros: integer('cost_micros').notNull().default(0),
    installs: real('installs').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    // Thêm ở GĐ 4
    customerId: text('customer_id').notNull().default(''),
    currency: text('currency').notNull().default('USD'), // tiền tệ của tài khoản Ads
    conversions: real('conversions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.campaignId, t.country] }), index('spend_app_date').on(t.appId, t.date)],
);

export const revenueDaily = sqliteTable(
  'revenue_daily',
  {
    date: text('date').notNull(),
    admobAppId: text('admob_app_id').notNull(),
    country: text('country').notNull(),
    format: text('format').notNull(),
    adSource: text('ad_source').notNull(),
    earningsMicros: integer('earnings_micros').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    requests: integer('requests').notNull().default(0),
    matched: integer('matched').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    currency: text('currency').notNull().default('USD'), // AdMob quy đổi theo currencyCode khi kéo báo cáo
  },
  (t) => [
    primaryKey({ columns: [t.date, t.admobAppId, t.country, t.format, t.adSource] }),
    index('revenue_app_date').on(t.admobAppId, t.date),
  ],
);

// Doanh thu theo ad unit (mediation report có AD_UNIT, gộp mọi nguồn) — tách bảng để revenue_daily không phình theo số unit
export const revenueUnitDaily = sqliteTable(
  'revenue_unit_daily',
  {
    date: text('date').notNull(),
    admobAppId: text('admob_app_id').notNull(),
    adUnitId: text('ad_unit_id').notNull(), // ca-app-pub-…/…
    adUnitName: text('ad_unit_name').notNull(),
    country: text('country').notNull(),
    format: text('format').notNull(),
    earningsMicros: integer('earnings_micros').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    requests: integer('requests').notNull().default(0),
    matched: integer('matched').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.adUnitId, t.country] }),
    index('revenue_unit_app_date').on(t.admobAppId, t.date),
  ],
);

// Ad unit × nguồn mediation (không tách nước để bảng nhỏ): eCPM/fill/show của từng nguồn trong unit
export const revenueUnitSourceDaily = sqliteTable(
  'revenue_unit_source_daily',
  {
    date: text('date').notNull(),
    admobAppId: text('admob_app_id').notNull(),
    adUnitId: text('ad_unit_id').notNull(),
    adSource: text('ad_source').notNull(),
    earningsMicros: integer('earnings_micros').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    requests: integer('requests').notNull().default(0),
    matched: integer('matched').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.adUnitId, t.adSource] }),
    index('revenue_unit_source_unit_date').on(t.adUnitId, t.date),
  ],
);

// Thay đổi trên Google Ads (change_event, tối đa 30 ngày gần nhất) — kể cả sửa tay trên web, để chú thích biểu đồ
export const changeEvents = sqliteTable(
  'change_events',
  {
    id: text('id').primaryKey(), // change_event.resource_name
    customerId: text('customer_id').notNull(),
    at: text('at').notNull(),
    date: text('date').notNull(),
    campaignId: text('campaign_id'),
    resourceType: text('resource_type').notNull(),
    operation: text('operation').notNull(),
    clientType: text('client_type').notNull(),
    userEmail: text('user_email'),
    fields: text('fields').notNull(), // JSON string[]
    details: text('details').notNull(), // JSON ChangeDetail[]
  },
  (t) => [index('change_customer_date').on(t.customerId, t.date), index('change_campaign').on(t.campaignId)],
);

// ── Vận hành ────────────────────────────────────────────────────────────────
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  state: text('state').notNull(),
  payload: text('payload'),
  progress: text('progress'), // JSON
  error: text('error'), // JSON AppError
  createdAt: createdAt(),
  updatedAt: text('updated_at').notNull(),
});

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  json: text('json').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: createdAt(),
  actor: text('actor').notNull(), // 'user' | 'rule:<id>'
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  before: text('before'),
  after: text('after'),
  requestId: text('request_id'),
});

export const quotaUsage = sqliteTable(
  'quota_usage',
  {
    day: text('day').notNull(), // ngày theo giờ Thái Bình Dương
    api: text('api').notNull(), // 'youtube.insert' | 'ads.operations'
    used: integer('used').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.api] })],
);

// Key-value: prefs (JSON) và secret đã mã hóa bằng safeStorage (base64).
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
