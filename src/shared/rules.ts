// Rules engine (Giai đoạn 5): rule dạng JSON + bộ đánh giá thuần (test được, không gọi API).
// Mặc định chế độ ĐỀ XUẤT: app liệt kê thay đổi, người dùng duyệt. Chỉ bật TỰ ÁP DỤNG khi đã tin rule.
import { z } from 'zod';
import { addDays } from './analytics';
import type { CampaignChange } from './types';

export const METRICS = {
  spend: { label: 'Chi phí', kind: 'money' },
  installs: { label: 'Cài đặt', kind: 'count' },
  cpi: { label: 'CPI', kind: 'money' },
  revenue: { label: 'Doanh thu QC', kind: 'money' },
  roas: { label: 'ROAS', kind: 'ratio' },
} as const;
export type Metric = keyof typeof METRICS;

export const WINDOWS = { LAST_3_DAYS: 3, LAST_7_DAYS: 7, LAST_14_DAYS: 14 } as const;
export type RuleWindow = keyof typeof WINDOWS;

export const ACTIONS = {
  PAUSE_CAMPAIGN: 'Tạm dừng camp',
  ADJUST_TARGET: 'Chỉnh tCPI / tROAS',
  ADJUST_BUDGET: 'Chỉnh ngân sách/ngày',
} as const;
export type RuleAction = keyof typeof ACTIONS;

// Giới hạn an toàn bắt buộc: mỗi lần chỉnh tối đa ±20%
export const MAX_CHANGE_PCT = 20;

const ConditionSchema = z
  .object({
    metric: z.enum(Object.keys(METRICS) as [Metric, ...Metric[]]),
    op: z.enum(['>', '>=', '<', '<=']),
    value: z.number().finite().optional(),
    ref: z.enum(['targetCpi', 'targetRoas']).optional(), // so với target của chính camp
    factor: z.number().positive().max(10).optional(),
  })
  .refine((c) => c.value != null || c.ref != null, { error: 'Điều kiện cần một con số hoặc so với target' });
export type Condition = z.infer<typeof ConditionSchema>;

export const RuleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1, 'Đặt tên rule').max(80),
    enabled: z.boolean(),
    scope: z.object({
      appId: z.string().nullable(), // null = mọi app
      countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(100), // [] = mọi quốc gia
    }),
    window: z.enum(Object.keys(WINDOWS) as [RuleWindow, ...RuleWindow[]]),
    when: z.object({ all: z.array(ConditionSchema).min(1, 'Cần ít nhất một điều kiện').max(6) }),
    then: z.object({
      action: z.enum(Object.keys(ACTIONS) as [RuleAction, ...RuleAction[]]),
      changePct: z.number().min(-MAX_CHANGE_PCT, `Tối đa ±${MAX_CHANGE_PCT}%`).max(MAX_CHANGE_PCT, `Tối đa ±${MAX_CHANGE_PCT}%`).optional(),
      floor: z.number().min(0).optional(), // sàn tCPI / ngân sách (đơn vị tiền tệ)
      ceiling: z.number().positive().optional(),
    }),
    mode: z.enum(['SUGGEST', 'AUTO']),
    cooldownHours: z.number().int().min(0).max(24 * 30),
    maxChangesPerWeek: z.number().int().min(1).max(14),
  })
  .superRefine((r, ctx) => {
    if (r.then.action !== 'PAUSE_CAMPAIGN' && !r.then.changePct) {
      ctx.addIssue({ code: 'custom', path: ['then', 'changePct'], message: 'Nhập % thay đổi (khác 0)' });
    }
  });
export type Rule = z.infer<typeof RuleSchema>;

// Hai rule mẫu theo thiết kế
export const RULE_TEMPLATES: Omit<Rule, 'id'>[] = [
  {
    name: 'Pause quốc gia ROAS thấp',
    enabled: true,
    scope: { appId: null, countries: [] },
    window: 'LAST_7_DAYS',
    when: { all: [{ metric: 'spend', op: '>=', value: 50 }, { metric: 'roas', op: '<', value: 0.3 }] },
    then: { action: 'PAUSE_CAMPAIGN' },
    mode: 'SUGGEST',
    cooldownHours: 72,
    maxChangesPerWeek: 2,
  },
  {
    name: 'Hạ tCPI khi CPI vượt mục tiêu',
    enabled: true,
    scope: { appId: null, countries: [] },
    window: 'LAST_3_DAYS',
    when: { all: [{ metric: 'installs', op: '>=', value: 30 }, { metric: 'cpi', op: '>', ref: 'targetCpi', factor: 1.3 }] },
    then: { action: 'ADJUST_TARGET', changePct: -10, floor: 0.05 },
    mode: 'SUGGEST',
    cooldownHours: 72,
    maxChangesPerWeek: 2,
  },
];

// ── Đầu vào đánh giá ────────────────────────────────────────────────────────
export interface CampaignDay {
  date: string;
  spend: number;
  installs: number;
  revenue: number; // doanh thu AdMob của (app, nước) chia theo tỉ lệ chi phí giữa các camp cùng nước
}

export interface RuleCampaign {
  campaignId: string;
  customerId: string;
  name: string;
  appId: string | null; // id app trong bảng apps
  country: string | null;
  status: string; // ENABLED | PAUSED
  budgetMicros: number | null;
  budgetResource: string | null;
  budgetShared: boolean;
  targetCpaMicros: number | null;
  targetRoas: number | null;
  days: CampaignDay[];
}

export interface RuleHistory {
  ruleId: string;
  campaignId: string;
  at: string; // ISO
}

export interface Suggestion {
  ruleId: string;
  ruleName: string;
  campaignId: string;
  customerId: string;
  name: string;
  country: string | null;
  action: RuleAction;
  change: CampaignChange;
  reason: string;
}

export interface Skipped {
  ruleId: string;
  campaignId: string;
  name: string;
  reason: string;
}

export interface WindowStats {
  spend: number;
  installs: number;
  revenue: number;
  cpi: number | null;
  roas: number | null;
}

export function windowStats(days: CampaignDay[], window: RuleWindow, today: string): WindowStats {
  const n = WINDOWS[window];
  const to = addDays(today, -1); // ngày trọn vẹn
  const from = addDays(to, -(n - 1));
  let spend = 0, installs = 0, revenue = 0;
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    spend += d.spend;
    installs += d.installs;
    revenue += d.revenue;
  }
  return { spend, installs, revenue, cpi: installs > 0 ? spend / installs : null, roas: spend > 0 ? revenue / spend : null };
}

const cmp = (a: number, op: Condition['op'], b: number) => (op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b);

export interface Fmt {
  money(v: number): string;
  pct(v: number): string;
  num(v: number): string;
}

const fmtMetric = (m: Metric, v: number, f: Fmt) => (METRICS[m].kind === 'money' ? f.money(v) : METRICS[m].kind === 'ratio' ? f.pct(v) : f.num(v));

// Một điều kiện → { khớp?, mô tả }. Thiếu số liệu (CPI khi 0 cài, target chưa đặt) = không khớp.
export function checkCondition(c: Condition, s: WindowStats, camp: RuleCampaign, f: Fmt): { ok: boolean; text: string } {
  const v = s[c.metric];
  let target: number | null = c.value ?? null;
  let targetText = target != null ? fmtMetric(c.metric, target, f) : '';
  if (c.ref) {
    const base = c.ref === 'targetCpi' ? (camp.targetCpaMicros != null ? camp.targetCpaMicros / 1e6 : null) : camp.targetRoas;
    if (base == null) return { ok: false, text: `camp chưa có ${c.ref === 'targetCpi' ? 'tCPI' : 'tROAS'}` };
    target = base * (c.factor ?? 1);
    targetText = `${c.ref === 'targetCpi' ? 'tCPI' : 'tROAS'} ${fmtMetric(c.metric, base, f)}${c.factor && c.factor !== 1 ? ` × ${c.factor}` : ''}`;
  }
  if (v == null || target == null) return { ok: false, text: `${METRICS[c.metric].label} chưa có số liệu` };
  return { ok: cmp(v, c.op, target), text: `${METRICS[c.metric].label} ${fmtMetric(c.metric, v, f)} ${c.op} ${targetText}` };
}

const roundMicros = (micros: number) => Math.max(10_000, Math.round(micros / 10_000) * 10_000);
const clampPct = (p: number) => Math.max(-MAX_CHANGE_PCT, Math.min(MAX_CHANGE_PCT, p));

// Hành động → thay đổi cụ thể (trước/sau). null = không áp được (kèm lý do).
export function planChange(rule: Rule, camp: RuleCampaign, f: Fmt): { change: CampaignChange } | { skip: string } {
  const { action } = rule.then;
  if (action === 'PAUSE_CAMPAIGN') {
    if (camp.status !== 'ENABLED') return { skip: 'camp đã tạm dừng' };
    return { change: { campaignId: camp.campaignId, name: camp.name, field: 'status', before: 'ENABLED', after: 'PAUSED' } };
  }
  const pct = clampPct(rule.then.changePct ?? 0);
  if (action === 'ADJUST_BUDGET') {
    if (camp.budgetMicros == null || !camp.budgetResource) return { skip: 'chưa đọc được ngân sách camp' };
    if (camp.budgetShared) return { skip: 'ngân sách dùng chung với camp khác — không tự chỉnh' };
    let after = roundMicros(camp.budgetMicros * (1 + pct / 100));
    if (rule.then.floor != null) after = Math.max(after, Math.round(rule.then.floor * 1e6));
    if (rule.then.ceiling != null) after = Math.min(after, Math.round(rule.then.ceiling * 1e6));
    if (after === camp.budgetMicros) return { skip: `ngân sách đã chạm ${pct < 0 ? 'sàn' : 'trần'} ${f.money(after / 1e6)}` };
    return { change: { campaignId: camp.campaignId, name: camp.name, field: 'budget', before: camp.budgetMicros, after, budgetResource: camp.budgetResource } };
  }
  // ADJUST_TARGET: tCPA (cài đặt / hành động) hoặc tROAS, tùy camp đang dùng
  if (camp.targetCpaMicros != null) {
    let after = roundMicros(camp.targetCpaMicros * (1 + pct / 100));
    if (rule.then.floor != null) after = Math.max(after, Math.round(rule.then.floor * 1e6));
    if (rule.then.ceiling != null) after = Math.min(after, Math.round(rule.then.ceiling * 1e6));
    if (after === camp.targetCpaMicros) return { skip: `tCPI đã chạm ${pct < 0 ? 'sàn' : 'trần'}` };
    return { change: { campaignId: camp.campaignId, name: camp.name, field: 'targetCpa', before: camp.targetCpaMicros, after } };
  }
  if (camp.targetRoas != null) {
    let after = Math.round(camp.targetRoas * (1 + pct / 100) * 1000) / 1000;
    if (rule.then.floor != null) after = Math.max(after, rule.then.floor);
    if (rule.then.ceiling != null) after = Math.min(after, rule.then.ceiling);
    if (after === camp.targetRoas) return { skip: 'tROAS đã chạm giới hạn' };
    return { change: { campaignId: camp.campaignId, name: camp.name, field: 'targetRoas', before: camp.targetRoas, after } };
  }
  return { skip: 'camp không dùng tCPI/tROAS (Tối đa hóa chuyển đổi)' };
}

export const inScope = (rule: Rule, c: RuleCampaign) =>
  (!rule.scope.appId || c.appId === rule.scope.appId) && (!rule.scope.countries.length || (!!c.country && rule.scope.countries.includes(c.country)));

// Đánh giá một rule trên danh sách camp, áp giới hạn cooldown + số lần chỉnh/tuần.
export function evaluateRule(rule: Rule, camps: RuleCampaign[], history: RuleHistory[], now: Date, f: Fmt) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const suggestions: Suggestion[] = [];
  const skipped: Skipped[] = [];
  for (const c of camps) {
    if (!inScope(rule, c)) continue;
    const s = windowStats(c.days, rule.window, today);
    const checks = rule.when.all.map((cond) => checkCondition(cond, s, c, f));
    if (!checks.every((x) => x.ok)) continue;
    const reason = checks.map((x) => x.text).join(' · ');

    const mine = history.filter((h) => h.ruleId === rule.id && h.campaignId === c.campaignId);
    const last = mine.map((h) => Date.parse(h.at)).sort((a, b) => b - a)[0];
    if (last && now.getTime() - last < rule.cooldownHours * 3600_000) {
      skipped.push({ ruleId: rule.id, campaignId: c.campaignId, name: c.name, reason: `đang cooldown ${rule.cooldownHours} giờ (vừa chỉnh lúc ${new Date(last).toLocaleString('vi-VN')})` });
      continue;
    }
    const week = mine.filter((h) => now.getTime() - Date.parse(h.at) < 7 * 24 * 3600_000).length;
    if (week >= rule.maxChangesPerWeek) {
      skipped.push({ ruleId: rule.id, campaignId: c.campaignId, name: c.name, reason: `đã chỉnh ${week} lần trong 7 ngày (tối đa ${rule.maxChangesPerWeek})` });
      continue;
    }
    const plan = planChange(rule, c, f);
    if ('skip' in plan) {
      skipped.push({ ruleId: rule.id, campaignId: c.campaignId, name: c.name, reason: plan.skip });
      continue;
    }
    suggestions.push({ ruleId: rule.id, ruleName: rule.name, campaignId: c.campaignId, customerId: c.customerId, name: c.name, country: c.country, action: rule.then.action, change: plan.change, reason });
  }
  return { suggestions, skipped };
}

// Mô tả rule thành câu (hiện trên danh sách rule)
export function describeRule(r: Rule, f: Fmt) {
  const cond = r.when.all
    .map((c) => {
      const val = c.ref ? `${c.ref === 'targetCpi' ? 'tCPI' : 'tROAS'}${c.factor && c.factor !== 1 ? ` × ${c.factor}` : ''}` : fmtMetric(c.metric, c.value!, f);
      return `${METRICS[c.metric].label} ${c.op} ${val}`;
    })
    .join(' và ');
  const act =
    r.then.action === 'PAUSE_CAMPAIGN'
      ? 'tạm dừng camp'
      : `${r.then.action === 'ADJUST_BUDGET' ? 'chỉnh ngân sách' : 'chỉnh tCPI/tROAS'} ${r.then.changePct! > 0 ? '+' : ''}${r.then.changePct}%`;
  return `Nếu ${cond} (${WINDOWS[r.window]} ngày) thì ${act}`;
}

export interface SuggestionRow extends Suggestion {
  id: string;
  status: 'pending' | 'applied' | 'dismissed' | 'failed' | 'expired';
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  currency: string;
}

export type RuleWithMeta = Rule & { lastRunAt: string | null };

export interface RuleTestResult {
  suggestions: Suggestion[];
  skipped: Skipped[];
  campaigns: number;
  currency: string;
}
