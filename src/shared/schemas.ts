import { z } from 'zod';
import { NameTemplateSchema } from './plan';

// zod dùng chung: renderer validate khi gõ, main validate lại vì không tin renderer.

export const AccountKindSchema = z.enum(['ads', 'admob', 'youtube', 'play', 'firebase']);

export const PrefsPatchSchema = z
  .object({
    theme: z.enum(['system', 'dark', 'light']),
    density: z.enum(['compact', 'comfortable']),
    zoom: z.number().min(0.9).max(1.25),
    locale: z.enum(['vi-VN', 'en-US']),
    sidebarCollapsed: z.boolean(),
    jobDrawerOpen: z.boolean(),
    currentAppId: z.string().nullable(),
    currentAdsCustomerId: z.string().nullable(),
    range: z.enum(['last7', 'last14', 'last30', 'all']),
    onboardingDone: z.boolean(),
    nameTemplate: NameTemplateSchema,
    youtubeAccountId: z.string().nullable(),
    uploadVia: z.enum(['ads', 'youtube']),
    uploadCustomerId: z.string().regex(/^\d{10}$/).nullable(),
    autoSync: z.boolean(),
    syncHour: z.number().int().min(0).max(23),
    closeToTray: z.boolean(),
  })
  .partial();

export const OAuthClientSchema = z.object({
  clientId: z.string().trim().regex(/\.apps\.googleusercontent\.com$/, 'Client ID phải kết thúc bằng .apps.googleusercontent.com'),
  clientSecret: z.string().trim().min(1, 'Thiếu client secret'),
});

export const DeveloperTokenSchema = z.string().trim().min(10, 'Developer token quá ngắn');

export const AppMappingSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Nhập tên app'),
  store: z.enum(['GOOGLE_PLAY', 'APPLE_APP_STORE']),
  storeAppId: z.string().trim().min(1, 'Nhập package name hoặc App Store ID'),
  admobAppId: z
    .string()
    .trim()
    .regex(/^ca-app-pub-\d+~\d+$/, 'Dạng ca-app-pub-…~…')
    .nullable(),
  adsCustomerId: z.string().regex(/^\d{10}$/, 'Customer ID 10 chữ số').nullable(),
  roasTarget: z.number().positive().nullable(),
  iconUrl: z.string().url().startsWith('https://').max(1000).nullable().default(null),
});

export const IdSchema = z.string().min(1);
export const AiKeySchema = z.string().trim().regex(/^sk-ant-[\w-]{20,}$/, 'API key Claude bắt đầu bằng sk-ant-…');

export const CustomerIdSchema = z.string().regex(/^\d{10}$/, 'Customer ID 10 chữ số');

export const CampaignChangeSchema = z.object({
  campaignId: z.string().regex(/^\d+$/),
  name: z.string(),
  field: z.enum(['budget', 'status', 'targetCpa', 'targetRoas']),
  before: z.union([z.number(), z.string()]),
  after: z.union([z.number().positive(), z.enum(['ENABLED', 'PAUSED'])]),
  budgetResource: z.string().optional(),
});

export const BulkEditSchema = z.object({
  customerId: CustomerIdSchema,
  changes: z.array(CampaignChangeSchema).min(1).max(500),
});
