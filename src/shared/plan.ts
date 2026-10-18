import { z } from 'zod';
import { getCountry, getLanguage } from './geo';
import { DescriptionSchema, HeadlineSchema } from './textLength';
import type { Store } from './types';

// ── Mục tiêu giá thầu ───────────────────────────────────────────────────────
export type Goal = 'INSTALLS_TCPI' | 'INSTALLS_MAX' | 'IN_APP_TCPA' | 'TROAS';

export interface GoalInfo {
  label: string;
  short: string; // dùng trong tên camp
  goalType: string; // AppCampaignBiddingStrategyGoalType
  bidding: 'target_cpa' | 'maximize_conversions' | 'target_roas';
  target: 'money' | 'ratio' | null; // money = tiền tệ tài khoản, ratio = 1.2 nghĩa là 120%
  conversions: boolean; // cần selective_optimization
}

export const GOALS: Record<Goal, GoalInfo> = {
  INSTALLS_TCPI: {
    label: 'Cài đặt · có tCPI',
    short: 'tCPI',
    goalType: 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST',
    bidding: 'target_cpa',
    target: 'money',
    conversions: false,
  },
  INSTALLS_MAX: {
    label: 'Cài đặt · tối đa',
    short: 'MAX',
    goalType: 'OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST',
    bidding: 'maximize_conversions',
    target: null,
    conversions: false,
  },
  IN_APP_TCPA: {
    label: 'Hành động trong app · tCPA',
    short: 'tCPA',
    goalType: 'OPTIMIZE_IN_APP_CONVERSIONS_TARGET_CONVERSION_COST',
    bidding: 'target_cpa',
    target: 'money',
    conversions: true,
  },
  TROAS: {
    label: 'Giá trị · tROAS',
    short: 'tROAS',
    goalType: 'OPTIMIZE_RETURN_ON_ADVERTISING_SPEND',
    bidding: 'target_roas',
    target: 'ratio',
    conversions: true,
  },
};

export const GoalSchema = z.enum(['INSTALLS_TCPI', 'INSTALLS_MAX', 'IN_APP_TCPA', 'TROAS']);

// ── Một dòng quốc gia ──────────────────────────────────────────────────────
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const CountryRowSchema = z
  .object({
    countryCode: z.string().refine((c) => !!getCountry(c), 'Mã quốc gia không có trong bảng geo'),
    languages: z
      .array(z.string().refine((l) => !!getLanguage(l), 'Ngôn ngữ không hỗ trợ'))
      .min(1, 'Chọn ít nhất 1 ngôn ngữ'),
    dailyBudget: z.number({ error: 'Nhập ngân sách' }).positive('Ngân sách phải > 0'),
    goal: GoalSchema,
    target: z.number().positive('Mục tiêu phải > 0').nullable(),
    conversionActions: z.array(z.string().regex(/^\d+$/, 'ID conversion action là số')),
    headlines: z.array(HeadlineSchema).min(1, 'Cần ít nhất 1 tiêu đề').max(5, 'Tối đa 5 tiêu đề'),
    descriptions: z.array(DescriptionSchema).min(1, 'Cần ít nhất 1 mô tả').max(5, 'Tối đa 5 mô tả'),
    videoIds: z.array(z.string().regex(YOUTUBE_ID, 'YouTube ID gồm 11 ký tự')).max(20, 'Tối đa 20 video'),
    imageAssetIds: z.array(z.string().regex(/^customers\/\d+\/assets\/\d+$/, 'Dạng customers/…/assets/…')).max(20, 'Tối đa 20 ảnh'),
  })
  .superRefine((row, ctx) => {
    const g = GOALS[row.goal];
    if (g.target && row.target == null) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: g.target === 'ratio' ? 'Nhập tROAS (vd 1.2 = 120%)' : 'Nhập mục tiêu chi phí' });
    }
    if (g.target === 'ratio' && row.target != null && row.target > 100) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'tROAS dạng tỉ lệ: 1.2 = 120%' });
    }
    if (g.conversions && row.conversionActions.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['conversionActions'], message: 'Mục tiêu này cần conversion action' });
    }
  });

export type CountryRow = z.infer<typeof CountryRowSchema>;

export const PlanSchema = z
  .object({
    id: z.string().min(1),
    appId: z.string().min(1, 'Chọn app'),
    customerId: z.string().regex(/^\d{10}$/, 'Chọn tài khoản Google Ads'),
    rows: z.array(CountryRowSchema).min(1, 'Chọn ít nhất 1 quốc gia'),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.rows.forEach((r, i) => {
      if (seen.has(r.countryCode)) ctx.addIssue({ code: 'custom', path: ['rows', i, 'countryCode'], message: 'Quốc gia bị lặp' });
      seen.add(r.countryCode);
    });
  });

export type Plan = z.infer<typeof PlanSchema>;

// Lỗi zod → map "rows.3.headlines.1" → message, để tô đúng ô trên bảng
export function issueMap(err: z.ZodError | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const iss of err?.issues ?? []) {
    const key = iss.path.join('.');
    out[key] ??= iss.message;
  }
  return out;
}

export function newRow(countryCode: string, base?: Partial<CountryRow>): CountryRow {
  return {
    countryCode,
    languages: getCountry(countryCode)?.languages ?? ['en'],
    dailyBudget: 0,
    goal: 'INSTALLS_MAX',
    target: null,
    conversionActions: [],
    headlines: [''],
    descriptions: [''],
    videoIds: [],
    imageAssetIds: [],
    ...base,
  } as CountryRow;
}

// ── Quy ước đặt tên ────────────────────────────────────────────────────────
export const DEFAULT_NAME_TEMPLATE = '{app}_{store}_{geo}_{goal}_{yyyymmdd}_{seq}';
export const NAME_VARS = ['app', 'store', 'geo', 'goal', 'yyyymmdd', 'seq'] as const;

export interface NameVars {
  app: string;
  store: Store;
  geo: string;
  goal: Goal;
  date: Date;
  seq: number;
}

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'app';

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export function renderName(template: string, v: NameVars): string {
  const map: Record<string, string> = {
    app: slug(v.app),
    store: v.store === 'GOOGLE_PLAY' ? 'GP' : 'AS',
    geo: v.geo,
    goal: GOALS[v.goal].short,
    yyyymmdd: ymd(v.date),
    seq: String(v.seq).padStart(2, '0'),
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => map[k] ?? m);
}

// Template phải có {geo}, nếu không 20 quốc gia sẽ trùng tên; biến lạ báo luôn
export const NameTemplateSchema = z
  .string()
  .trim()
  .min(1, 'Nhập template')
  .max(120, 'Template quá dài')
  .refine((t) => t.includes('{geo}'), 'Template phải có {geo} để tên mỗi quốc gia khác nhau')
  .refine((t) => [...t.matchAll(/\{(\w+)\}/g)].every((m) => (NAME_VARS as readonly string[]).includes(m[1])), {
    error: (iss) => {
      const bad = [...String(iss.input).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).find((k) => !(NAME_VARS as readonly string[]).includes(k));
      return `Biến không hỗ trợ: {${bad}}`;
    },
  });

// Tiền → micros. Micros luôn là ×1.000.000 theo đơn vị tiền tệ của tài khoản (VND cũng vậy);
// làm tròn tới đơn vị nhỏ nhất Google chấp nhận (0.01) để tránh lỗi NON_MULTIPLE_OF_MINIMUM_CURRENCY_UNIT.
export const toMicros = (amount: number) => Math.round(amount * 100) * 10_000;

// ── Bản nháp, lịch sử, kết quả ─────────────────────────────────────────────
export interface PlanDraft {
  id: string;
  appId: string | null;
  customerId: string | null;
  rows: CountryRow[];
  step: number;
  updatedAt: string;
}

export interface CellError {
  field: string; // "headlines.2", "dailyBudget"… ('' = cả dòng)
  message: string;
  code?: string;
}

export type RowState = 'pending' | 'running' | 'done' | 'exists' | 'failed';

export interface RowResult {
  state: RowState;
  name: string;
  campaignId?: string;
  errors?: CellError[];
  requestId?: string;
}

export interface ValidateResult {
  ok: boolean;
  rows: Record<string, RowResult>; // theo countryCode; state 'done' = hợp lệ, 'exists' = tên đã có trên Google
}

export interface PlanRecord {
  id: string;
  version: number;
  appId: string;
  appName: string;
  customerId: string;
  rows: CountryRow[];
  results: Record<string, RowResult>;
  createdAt: string;
}

export const adsCampaignUrl = (customerId: string, campaignId: string) =>
  `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&__e=${customerId}`;
