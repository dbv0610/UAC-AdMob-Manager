// Analytics ROAS (Giai đoạn 4): kiểu + hàm thuần (gộp chi phí/doanh thu, KPI, cảnh báo) dùng chung main/renderer/test.
import { z } from 'zod';
import type { RangePreset } from './types';

// ── Dữ liệu ngày đã gộp theo (ngày, app, quốc gia) ─────────────────────────
export interface DayRow {
  date: string; // YYYY-MM-DD
  appId: string; // id app trong bảng apps
  country: string;
  spend: number; // đơn vị tiền tệ (không phải micros)
  installs: number;
  revenue: number;
  adImpressions: number; // AdMob
  matched: number;
  requests: number;
  adClicks: number;
  adsImpressions: number; // Google Ads
  adsClicks: number;
}

export interface Kpis {
  spend: number;
  installs: number;
  cpi: number | null;
  revenue: number;
  roas: number | null;
  ecpm: number | null;
  adImpressions: number;
  profit: number; // doanh thu QC − chi phí
  adsImpressions: number;
  adsClicks: number;
  adsCtr: number | null; // click / hiển thị trên Google Ads
  cvr: number | null; // cài / click
  showRate: number | null; // AdMob: hiển thị / matched
  fillRate: number | null; // AdMob: matched / requests
  adRequests: number; // AdMob
  adClicks: number;
  adCtr: number | null; // AdMob: click / hiển thị
}

export interface CountryStat extends Kpis {
  country: string;
  ctr: number | null; // CTR quảng cáo AdMob (nghi invalid traffic)
  prevRoas: number | null;
  prev: Kpis;
  alerts: Alert[];
}

export interface DailyPoint {
  date: string;
  spend: number;
  revenue: number;
  installs: number;
  adImpressions: number;
  matched: number;
  adsImpressions: number;
  adsClicks: number;
  requests: number;
  adClicks: number;
}

export interface SourceStat {
  adSource: string;
  revenue: number;
  impressions: number;
  ecpm: number | null;
  matchRate: number | null; // matched / requests
}

export type AlertLevel = 'danger' | 'warning';
export type AlertRule = 'ctr' | 'showRate' | 'ecpmDrop' | 'spendSpike' | 'roasLow' | 'cpiHigh';
export interface Alert {
  rule: AlertRule;
  level: AlertLevel;
  appId: string;
  country: string;
  message: string;
}

export interface SourceSync {
  ok: boolean;
  at: string | null;
  error?: string;
}
export interface SyncStatus {
  at: string | null; // lần đồng bộ gần nhất (bất kể thành công một phần)
  from: string | null;
  to: string | null;
  spend: SourceSync;
  revenue: SourceSync;
  earliest?: string | null; // ngày đầu tiên có số liệu trên máy (chi phí hoặc doanh thu)
}

export interface AnalyticsResult {
  currency: string;
  mixedCurrency: string[]; // các app dùng tiền tệ khác bị loại khỏi tổng
  range: { from: string; to: string; prevFrom: string; prevTo: string };
  kpis: Kpis;
  prev: Kpis;
  daily: DailyPoint[];
  prevDaily: DailyPoint[]; // cùng độ dài, để vẽ đường so sánh
  countries: CountryStat[];
  alerts: Alert[];
  hasData: boolean;
  dataFrom: string | null; // ngày sớm nhất có dữ liệu trên máy (để gợi ý đồng bộ thêm)
  roasTarget: number | null; // ngưỡng ROAS của app (hoặc mặc định trong Cài đặt)
  heat: Heatmap;
}

export interface CountryDetail {
  daily: DailyPoint[];
  sources: SourceStat[];
}

// Bản đồ nhiệt quốc gia × ngày (top quốc gia theo chi phí)
export interface Heatmap {
  countries: string[];
  dates: string[];
  cells: { spend: number; revenue: number; installs: number }[][]; // [quốc gia][ngày]
}

// ── Phân tích theo chiều khác (camp, app, định dạng, nguồn) ────────────────
export type Dim = 'country' | 'campaign' | 'app' | 'format' | 'source' | 'adUnit';
export interface BreakRow extends Kpis {
  key: string;
  label: string;
  prev: Kpis;
  country?: string | null; // camp: nước chính
  status?: string | null; // camp: ENABLED/PAUSED
  budget?: number | null; // camp: ngân sách/ngày
  targetCpa?: number | null;
  targetRoas?: number | null;
  format?: string | null; // ad unit
  appName?: string | null; // ad unit khi xem mọi app
  flags?: UnitFlag[]; // ad unit
}

// ── Ad unit ─────────────────────────────────────────────────────────────────
export const FORMAT_LABEL: Record<string, string> = {
  BANNER: 'Banner',
  INTERSTITIAL: 'Xen kẽ (Interstitial)',
  REWARDED: 'Có thưởng (Rewarded)',
  REWARDED_INTERSTITIAL: 'Xen kẽ có thưởng',
  APP_OPEN: 'Mở app (App open)',
  NATIVE: 'Gốc (Native)',
};
export interface UnitFlag {
  level: AlertLevel;
  message: string;
}

// Cờ theo kinh nghiệm mediation: fill thấp = thiếu nguồn/sàn giá cao; show rate thấp = tải QC mà không hiện (đặt chỗ sai, preload thừa)
export function unitFlags(cur: Kpis, prev: Kpis, fmtPct: (v: number) => string, fmtMoney: (v: number) => string): UnitFlag[] {
  const out: UnitFlag[] = [];
  if (cur.adRequests >= 1000 && cur.fillRate != null && cur.fillRate < 0.5) {
    out.push({ level: cur.fillRate < 0.2 ? 'danger' : 'warning', message: `Fill rate ${fmtPct(cur.fillRate)} — thêm nguồn mediation hoặc hạ sàn giá` });
  }
  const matched = cur.fillRate != null ? cur.adRequests * cur.fillRate : 0;
  if (matched >= 1000 && cur.showRate != null && cur.showRate < 0.4) {
    out.push({ level: 'warning', message: `Show rate ${fmtPct(cur.showRate)} — QC tải về nhưng ít được hiện (kiểm tra vị trí gọi show/preload)` });
  }
  if (cur.adImpressions >= 1000 && cur.adCtr != null && cur.adCtr > 0.08) {
    out.push({ level: 'danger', message: `CTR ${fmtPct(cur.adCtr)} — nghi click không hợp lệ (đặt QC sát nút bấm?)` });
  }
  if (cur.adImpressions >= 1000 && prev.adImpressions >= 1000 && cur.ecpm != null && prev.ecpm != null && cur.ecpm < prev.ecpm * 0.7) {
    out.push({ level: 'warning', message: `eCPM giảm ${fmtMoney(prev.ecpm)} → ${fmtMoney(cur.ecpm)} so kỳ trước` });
  }
  if (prev.adImpressions >= 1000 && cur.adImpressions < prev.adImpressions * 0.5) {
    out.push({ level: 'warning', message: `Hiển thị giảm ${fmtPct(1 - cur.adImpressions / prev.adImpressions)} so kỳ trước — unit bị gỡ khỏi app hoặc lỗi SDK?` });
  }
  return out;
}

export interface AdUnitDetail {
  daily: DailyPoint[];
  countries: BreakRow[];
  sources: BreakRow[]; // từng nguồn mediation trong unit (flags = cờ của nguồn)
  sourceDaily: { source: string; points: DailyPoint[] }[]; // top nguồn theo doanh thu, để vẽ eCPM/doanh thu từng nguồn
}

export interface CampaignDetail {
  daily: DailyPoint[];
  countries: BreakRow[];
}

// Cờ cho một nguồn trong unit: so với chính nó kỳ trước và với cả unit
export function sourceFlags(cur: Kpis, prev: Kpis, unit: Kpis, fmtPct: (v: number) => string, fmtMoney: (v: number) => string): UnitFlag[] {
  const out: UnitFlag[] = [];
  if (cur.adRequests >= 5000 && cur.fillRate != null && cur.fillRate < 0.05) {
    out.push({ level: 'warning', message: `Fill ${fmtPct(cur.fillRate)} — gần như không trả giá; giảm sàn hoặc bỏ khỏi waterfall` });
  }
  const matched = cur.fillRate != null ? cur.adRequests * cur.fillRate : 0;
  if (matched >= 1000 && cur.showRate != null && cur.showRate < 0.5) {
    out.push({ level: 'warning', message: `Show ${fmtPct(cur.showRate)} — thắng nhưng ít được hiện (QC hết hạn, timeout tải?)` });
  }
  if (cur.adImpressions >= 1000 && cur.adCtr != null && cur.adCtr > 0.08) {
    out.push({ level: 'danger', message: `CTR ${fmtPct(cur.adCtr)} — nghi click không hợp lệ` });
  }
  const impShare = unit.adImpressions > 0 ? cur.adImpressions / unit.adImpressions : 0;
  if (impShare >= 0.3 && cur.ecpm != null && unit.ecpm != null && cur.ecpm < unit.ecpm * 0.6) {
    out.push({ level: 'warning', message: `Chiếm ${fmtPct(impShare)} hiển thị nhưng eCPM ${fmtMoney(cur.ecpm)} < 60% eCPM unit — kéo giá unit xuống` });
  }
  const revShare = unit.revenue > 0 ? cur.revenue / unit.revenue : 0;
  if (revShare >= 0.8 && unit.revenue > 0) {
    out.push({ level: 'warning', message: `Chiếm ${fmtPct(revShare)} doanh thu unit — phụ thuộc một nguồn, thêm bidder để tăng cạnh tranh` });
  }
  if (cur.adImpressions >= 1000 && prev.adImpressions >= 1000 && cur.ecpm != null && prev.ecpm != null && cur.ecpm < prev.ecpm * 0.7) {
    out.push({ level: 'warning', message: `eCPM giảm ${fmtMoney(prev.ecpm)} → ${fmtMoney(cur.ecpm)} so kỳ trước` });
  }
  return out;
}
export interface Breakdown {
  dim: Dim;
  currency: string;
  rows: BreakRow[];
  note?: string;
}

// ── Ngưỡng cảnh báo (Cài đặt → Cảnh báo) ─────────────────────────────────────
export const AlertPrefsSchema = z.object({
  ctrMax: z.number().min(0.001).max(1), // 8%
  ctrMinImpressions: z.number().int().min(0),
  showRateMin: z.number().min(0).max(1), // 40%
  showRateMinMatched: z.number().int().min(0),
  ecpmDropRatio: z.number().min(0.1).max(1), // hôm qua < 70% trung vị 7 ngày
  ecpmMinImpressions: z.number().int().min(0),
  spendSpikeX: z.number().min(1.1).max(20), // hôm nay > 2× trung vị 7 ngày
  spendSpikeMin: z.number().min(0),
  roasMinSpend: z.number().min(0), // chỉ xét ROAS khi chi ≥ X trong 7 ngày
  defaultRoasTarget: z.number().min(0).max(100).nullable(), // app chưa đặt ngưỡng riêng
  cpiOverRatio: z.number().min(1).max(10), // CPI 3 ngày > tCPI × 1,3
  cpiMinInstalls: z.number().int().min(0),
});
export type AlertPrefs = z.infer<typeof AlertPrefsSchema>;

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  ctrMax: 0.08,
  ctrMinImpressions: 1000,
  showRateMin: 0.4,
  showRateMinMatched: 1000,
  ecpmDropRatio: 0.7,
  ecpmMinImpressions: 1000,
  spendSpikeX: 2,
  spendSpikeMin: 20,
  roasMinSpend: 50,
  defaultRoasTarget: null,
  cpiOverRatio: 1.3,
  cpiMinInstalls: 20,
};

// ── Ngày ───────────────────────────────────────────────────────────────────
export const RANGE_DAYS: Record<Exclude<RangePreset, 'all'>, number> = { last7: 7, last14: 14, last30: 30 };
// null = từ trước đến nay (không có số ngày cố định)
export const rangeDays = (r: RangePreset) => (r === 'all' ? null : RANGE_DAYS[r]);
export const RANGE_LABEL: Record<RangePreset, string> = { last7: '7 ngày qua', last14: '14 ngày qua', last30: '30 ngày qua', all: 'Từ trước đến nay' };
// Mốc đầu khi gọi thẳng Google Ads (không giới hạn bởi dữ liệu đã đồng bộ trên máy)
export const ADS_ALL_TIME_FROM = '2015-01-01';
// Đồng bộ toàn bộ lịch sử: tối đa 3 năm
export const MAX_SYNC_DAYS = 1095;

// Kỳ của màn Analytics: thêm preset ngoài 7/14/30 của thanh ngữ cảnh, hoặc tự chọn từ–đến
export const ANALYTICS_PRESETS = ['yesterday', 'last3', 'last7', 'last14', 'last30', 'last90', 'thisMonth', 'lastMonth', 'all'] as const;
export type AnalyticsPreset = (typeof ANALYTICS_PRESETS)[number];
export type AnalyticsRange = AnalyticsPreset | { from: string; to: string };
export const PRESET_LABEL: Record<AnalyticsPreset, string> = {
  yesterday: 'Hôm qua',
  last3: '3 ngày qua',
  last7: '7 ngày qua',
  last14: '14 ngày qua',
  last30: '30 ngày qua',
  last90: '90 ngày qua',
  thisMonth: 'Tháng này',
  lastMonth: 'Tháng trước',
  all: 'Từ trước đến nay',
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 366;
export const AnalyticsRangeSchema = z.union([
  z.enum(ANALYTICS_PRESETS),
  z
    .object({ from: z.string().regex(ISO), to: z.string().regex(ISO) })
    .refine((r) => r.from <= r.to, 'Ngày bắt đầu phải trước ngày kết thúc')
    .refine((r) => daysBetween(r.from, r.to) <= MAX_RANGE_DAYS, `Tối đa ${MAX_RANGE_DAYS} ngày`),
]);

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

// Kỳ = N ngày trọn vẹn kết thúc hôm qua (hôm nay còn đang chạy, số chưa đủ); kỳ trước liền kề cùng độ dài.
export const rangeOf = (preset: RangePreset, today = isoDate(new Date())) => resolveRange(preset, today);

export interface ResolvedRange {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

// Mọi kỳ có kỳ trước liền kề cùng độ dài để so sánh.
// earliest = ngày đầu tiên có dữ liệu (cho “từ trước đến nay”); chưa có dữ liệu thì lấy 30 ngày.
export function resolveRange(spec: AnalyticsRange, today = isoDate(new Date()), earliest?: string | null): ResolvedRange {
  const yesterday = addDays(today, -1);
  let from: string, to: string;
  if (typeof spec === 'object') ({ from, to } = spec);
  else if (spec === 'all') {
    to = yesterday;
    from = earliest && earliest <= yesterday ? earliest : addDays(yesterday, -29);
  }
  else if (spec === 'thisMonth') {
    to = yesterday; // hôm nay chưa trọn; ngày 1 thì “tháng này” = hôm qua của tháng trước
    from = `${to.slice(0, 8)}01`;
  } else if (spec === 'lastMonth') {
    const firstThis = `${today.slice(0, 8)}01`;
    to = addDays(firstThis, -1);
    from = `${to.slice(0, 8)}01`;
  } else {
    const n = spec === 'yesterday' ? 1 : spec === 'last3' ? 3 : spec === 'last90' ? 90 : RANGE_DAYS[spec];
    to = yesterday;
    from = addDays(to, -(n - 1));
  }
  const n = daysBetween(from, to);
  return { from, to, prevFrom: addDays(from, -n), prevTo: addDays(from, -1) };
}

// Số ngày tính cả hai đầu
export function daysBetween(from: string, to: string) {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(to) - t(from)) / 86400_000) + 1;
}

export function datesBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// AdMob trả 'YYYYMMDD'
export const fromAdmobDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// ── Gộp số liệu ─────────────────────────────────────────────────────────────
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export interface Totals {
  spend: number;
  installs: number;
  revenue: number;
  adImpressions: number;
  matched?: number;
  requests?: number;
  adsImpressions?: number;
  adsClicks?: number;
  adClicks?: number;
}

// Tỉ số tính từ tổng (không lấy trung bình các tỉ số)
export function kpisFromTotals(t: Totals): Kpis {
  const { spend, installs, revenue, adImpressions } = t;
  const matched = t.matched ?? 0, requests = t.requests ?? 0, adsImpressions = t.adsImpressions ?? 0, adsClicks = t.adsClicks ?? 0, adClicks = t.adClicks ?? 0;
  return {
    spend,
    installs,
    cpi: div(spend, installs),
    revenue,
    roas: div(revenue, spend),
    ecpm: div(revenue * 1000, adImpressions),
    adImpressions,
    profit: revenue - spend,
    adsImpressions,
    adsClicks,
    adsCtr: div(adsClicks, adsImpressions),
    cvr: div(installs, adsClicks),
    showRate: div(adImpressions, matched),
    fillRate: div(matched, requests),
    adRequests: requests,
    adClicks,
    adCtr: div(adClicks, adImpressions),
  };
}

export function kpisOf(rows: (DayRow | DailyPoint)[]): Kpis {
  const t: Required<Totals> = { spend: 0, installs: 0, revenue: 0, adImpressions: 0, matched: 0, requests: 0, adsImpressions: 0, adsClicks: 0, adClicks: 0 };
  for (const r of rows) {
    t.spend += r.spend;
    t.installs += r.installs;
    t.revenue += r.revenue;
    t.adImpressions += r.adImpressions;
    t.matched += r.matched;
    t.requests += r.requests;
    t.adsImpressions += r.adsImpressions;
    t.adsClicks += r.adsClicks;
    t.adClicks += r.adClicks;
  }
  return kpisFromTotals(t);
}

const emptyPoint = (date: string): DailyPoint => ({ date, spend: 0, revenue: 0, installs: 0, adImpressions: 0, matched: 0, adsImpressions: 0, adsClicks: 0, requests: 0, adClicks: 0 });
function addPoint(p: DailyPoint, r: DayRow | DailyPoint) {
  p.spend += r.spend;
  p.revenue += r.revenue;
  p.installs += r.installs;
  p.adImpressions += r.adImpressions;
  p.matched += r.matched;
  p.adsImpressions += r.adsImpressions;
  p.adsClicks += r.adsClicks;
  p.requests += r.requests;
  p.adClicks += r.adClicks;
}

export function dailyOf(rows: DayRow[], from: string, to: string): DailyPoint[] {
  const by = new Map(datesBetween(from, to).map((d) => [d, emptyPoint(d)]));
  for (const r of rows) {
    const p = by.get(r.date);
    if (p) addPoint(p, r);
  }
  return [...by.values()];
}

// Gộp theo tuần (bắt đầu thứ Hai); điểm mang ngày đầu tuần
export function bucketDaily(points: DailyPoint[], by: 'day' | 'week'): DailyPoint[] {
  if (by === 'day') return points;
  const out = new Map<string, DailyPoint>();
  for (const p of points) {
    const [y, m, d] = p.date.split('-').map(Number);
    const wd = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = thứ Hai
    const k = addDays(p.date, -wd);
    const b = out.get(k) ?? emptyPoint(k);
    addPoint(b, p);
    out.set(k, b);
  }
  return [...out.values()];
}

// Lũy kế chi phí/doanh thu: thấy ngày hòa vốn trong kỳ
export function cumulative(points: DailyPoint[]): DailyPoint[] {
  const acc = emptyPoint('');
  return points.map((p) => {
    addPoint(acc, p);
    return { ...acc, date: p.date };
  });
}

// ── Chỉ số vẽ được trên biểu đồ / thẻ KPI ───────────────────────────────────
export type Metric = 'spend' | 'revenue' | 'profit' | 'roas' | 'installs' | 'cpi' | 'ecpm' | 'adImpressions' | 'adsCtr' | 'cvr';
export type MetricKind = 'money' | 'pct' | 'count';
export const METRICS: Record<Metric, { label: string; kind: MetricKind; goodUp: boolean; hint: string }> = {
  spend: { label: 'Chi phí', kind: 'money', goodUp: false, hint: 'Chi phí Google Ads (App campaign)' },
  revenue: { label: 'Doanh thu QC', kind: 'money', goodUp: true, hint: 'Doanh thu quảng cáo AdMob ước tính' },
  profit: { label: 'Lợi nhuận', kind: 'money', goodUp: true, hint: 'Doanh thu QC − chi phí (chưa gồm IAP)' },
  roas: { label: 'ROAS', kind: 'pct', goodUp: true, hint: 'Doanh thu quảng cáo ÷ chi phí, cùng kỳ' },
  installs: { label: 'Cài đặt', kind: 'count', goodUp: true, hint: 'Lượt cài từ Google Ads' },
  cpi: { label: 'CPI', kind: 'money', goodUp: false, hint: 'Chi phí ÷ lượt cài' },
  ecpm: { label: 'eCPM', kind: 'money', goodUp: true, hint: 'Doanh thu AdMob trên 1.000 lượt hiển thị' },
  adImpressions: { label: 'Hiển thị QC', kind: 'count', goodUp: true, hint: 'Lượt hiển thị quảng cáo AdMob trong app' },
  adsCtr: { label: 'CTR Ads', kind: 'pct', goodUp: true, hint: 'Click ÷ hiển thị của quảng cáo Google Ads' },
  cvr: { label: 'Tỉ lệ cài', kind: 'pct', goodUp: true, hint: 'Lượt cài ÷ click trên Google Ads' },
};

export function metricOf(p: DailyPoint | Kpis, m: Metric): number | null {
  const k = 'cpi' in p ? p : kpisOf([p]);
  return k[m];
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function countryStats(cur: DayRow[], prev: DayRow[], alerts: Alert[]): CountryStat[] {
  const prevBy = groupBy(prev, (r) => r.country);
  return [...groupBy(cur, (r) => r.country)].map(([country, rows]) => {
    const k = kpisOf(rows);
    const clicks = rows.reduce((s, r) => s + r.adClicks, 0);
    const p = kpisOf(prevBy.get(country) ?? []);
    return {
      country,
      ...k,
      ctr: div(clicks, k.adImpressions),
      prevRoas: p.roas,
      prev: p,
      alerts: alerts.filter((a) => a.country === country),
    };
  });
}

// Bản đồ nhiệt: top N quốc gia theo chi phí (nước chỉ có doanh thu xếp sau)
export function heatmapOf(rows: DayRow[], from: string, to: string, top = 15): Heatmap {
  const dates = datesBetween(from, to);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const by = groupBy(rows, (r) => r.country);
  const countries = [...by]
    .map(([c, list]) => ({ c, spend: list.reduce((s, r) => s + r.spend, 0), revenue: list.reduce((s, r) => s + r.revenue, 0) }))
    .filter((x) => x.spend > 0 || x.revenue > 0)
    .sort((a, b) => b.spend - a.spend || b.revenue - a.revenue)
    .slice(0, top)
    .map((x) => x.c);
  const cells = countries.map((c) => {
    const line = dates.map(() => ({ spend: 0, revenue: 0, installs: 0 }));
    for (const r of by.get(c)!) {
      const i = idx.get(r.date);
      if (i == null) continue;
      line[i].spend += r.spend;
      line[i].revenue += r.revenue;
      line[i].installs += r.installs;
    }
    return line;
  });
  return { countries, dates, cells };
}

// ── Ma trận ROAS × chi phí ───────────────────────────────────────────────────
export type Quadrant = 'star' | 'scale' | 'cut' | 'watch';
export const QUADRANT: Record<Quadrant, { label: string; hint: string; tone: 'success' | 'info' | 'danger' | 'warning' }> = {
  star: { label: 'Ngôi sao', hint: 'ROAS đạt ngưỡng, chi nhiều — giữ ổn định', tone: 'success' },
  scale: { label: 'Nên tăng', hint: 'ROAS đạt ngưỡng nhưng chi còn ít — thử tăng ngân sách', tone: 'info' },
  cut: { label: 'Cần cắt', hint: 'Chi nhiều mà ROAS dưới ngưỡng — giảm ngân sách/tCPI hoặc tạm dừng', tone: 'danger' },
  watch: { label: 'Theo dõi', hint: 'Chi ít, ROAS dưới ngưỡng — chờ thêm dữ liệu', tone: 'warning' },
};

// Chỉ xét nước có chi phí; ngưỡng chi = trung vị chi phí các nước có chi
export function quadrants<T extends { spend: number; roas: number | null }>(rows: T[], target: number) {
  const spending = rows.filter((r) => r.spend > 0);
  const mid = median(spending.map((r) => r.spend));
  return {
    mid,
    of: (r: T): Quadrant | null => {
      if (!(r.spend > 0)) return null;
      const good = (r.roas ?? 0) >= target;
      const big = r.spend >= mid;
      return good ? (big ? 'star' : 'scale') : big ? 'cut' : 'watch';
    },
  };
}

// ── Nhận định tự động ───────────────────────────────────────────────────────
export interface Insight {
  id: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
  countries: string[];
}

export function insightsOf(
  countries: CountryStat[],
  total: Kpis,
  opts: { target: number; minSpend: number; fmtPct: (v: number) => string; fmtMoney: (v: number) => string },
): Insight[] {
  const { target, minSpend, fmtPct, fmtMoney } = opts;
  const out: Insight[] = [];
  const names = (list: CountryStat[]) => list.map((c) => c.country);
  const top = (list: CountryStat[], n = 5) => list.slice(0, n).map((c) => `${c.country} ${c.roas == null ? '' : fmtPct(c.roas)}`.trim()).join(', ');
  const big = countries.filter((c) => c.spend >= minSpend);

  // 1) Đang lỗ nặng: ROAS < nửa ngưỡng, chi đáng kể
  const burn = big.filter((c) => (c.roas ?? 0) < target * 0.5).sort((a, b) => b.spend - a.spend);
  if (burn.length) {
    const lost = burn.reduce((s, c) => s + c.spend - c.revenue, 0);
    out.push({ id: 'burn', tone: 'danger', title: `${burn.length} nước đang lỗ nặng`, detail: `ROAS dưới ${fmtPct(target * 0.5)}, lỗ ${fmtMoney(lost)} trong kỳ: ${top(burn)}`, countries: names(burn) });
  }

  // 2) Nên tăng: ROAS vượt ngưỡng 20% trở lên, chi dưới trung vị
  const mid = median(countries.filter((c) => c.spend > 0).map((c) => c.spend));
  const scale = big.filter((c) => (c.roas ?? 0) >= target * 1.2 && c.spend <= mid && c.installs >= 10).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
  if (scale.length) out.push({ id: 'scale', tone: 'success', title: `${scale.length} nước có thể tăng ngân sách`, detail: `ROAS cao hơn ngưỡng ≥ 20% nhưng chi còn ít: ${top(scale)}`, countries: names(scale) });

  // 3) ROAS giảm mạnh so kỳ trước
  const drop = big
    .map((c) => ({ c, d: delta(c.roas, c.prevRoas) }))
    .filter((x) => x.d != null && x.d <= -0.25 && x.c.prev.spend >= minSpend)
    .sort((a, b) => a.d! - b.d!);
  if (drop.length) {
    out.push({ id: 'drop', tone: 'warning', title: `ROAS giảm mạnh ở ${drop.length} nước`, detail: drop.slice(0, 5).map((x) => `${x.c.country} ${fmtPct(x.c.prevRoas!)} → ${fmtPct(x.c.roas ?? 0)}`).join(', '), countries: drop.map((x) => x.c.country) });
  }
  const rise = big
    .map((c) => ({ c, d: delta(c.roas, c.prevRoas) }))
    .filter((x) => x.d != null && x.d >= 0.25 && x.c.prev.spend >= minSpend)
    .sort((a, b) => b.d! - a.d!);
  if (rise.length) {
    out.push({ id: 'rise', tone: 'info', title: `ROAS tăng tốt ở ${rise.length} nước`, detail: rise.slice(0, 5).map((x) => `${x.c.country} ${fmtPct(x.c.prevRoas!)} → ${fmtPct(x.c.roas ?? 0)}`).join(', '), countries: rise.map((x) => x.c.country) });
  }

  // 4) CPI tăng vọt
  const cpi = big
    .map((c) => ({ c, d: delta(c.cpi, c.prev.cpi) }))
    .filter((x) => x.d != null && x.d >= 0.3 && x.c.installs >= 20)
    .sort((a, b) => b.d! - a.d!);
  if (cpi.length) out.push({ id: 'cpi', tone: 'warning', title: `CPI tăng ≥ 30% ở ${cpi.length} nước`, detail: cpi.slice(0, 5).map((x) => `${x.c.country} ${fmtMoney(x.c.prev.cpi!)} → ${fmtMoney(x.c.cpi!)}`).join(', '), countries: cpi.map((x) => x.c.country) });

  // 5) Mở rộng: có doanh thu (organic) nhưng chưa chạy camp
  const organic = countries
    .filter((c) => c.spend === 0 && c.revenue > 0 && c.country !== 'ZZ' && c.revenue >= Math.max(1, total.revenue * 0.01))
    .sort((a, b) => b.revenue - a.revenue);
  if (organic.length) {
    out.push({ id: 'expand', tone: 'info', title: `${organic.length} nước có doanh thu nhưng chưa chạy camp`, detail: `Ứng viên mở rộng: ${organic.slice(0, 6).map((c) => `${c.country} ${fmtMoney(c.revenue)} (eCPM ${c.ecpm == null ? '—' : fmtMoney(c.ecpm)})`).join(', ')}`, countries: names(organic) });
  }

  // 6) Chi phí dồn vào một nước
  const lead = [...countries].sort((a, b) => b.spend - a.spend)[0];
  if (lead && total.spend > 0 && lead.spend / total.spend >= 0.6 && countries.filter((c) => c.spend > 0).length > 1) {
    out.push({ id: 'concentration', tone: 'info', title: `${fmtPct(lead.spend / total.spend)} chi phí dồn vào ${lead.country}`, detail: 'Phụ thuộc một thị trường: kết quả toàn app biến động theo nước này.', countries: [lead.country] });
  }

  // 7) Lời/lỗ toàn kỳ
  if (total.spend >= minSpend) {
    out.push(
      total.profit >= 0
        ? { id: 'profit', tone: 'success', title: `Có lời ${fmtMoney(total.profit)} trong kỳ`, detail: `ROAS chung ${fmtPct(total.roas ?? 0)} (ngưỡng ${fmtPct(target)}).`, countries: [] }
        : { id: 'profit', tone: (total.roas ?? 0) < target ? 'danger' : 'warning', title: `Đang lỗ ${fmtMoney(-total.profit)} trong kỳ`, detail: `ROAS chung ${fmtPct(total.roas ?? 0)} (ngưỡng ${fmtPct(target)}). Doanh thu QC chưa gồm IAP và người dùng tiếp tục kiếm tiền sau kỳ.`, countries: [] },
    );
  }
  return out;
}

// % thay đổi so kỳ trước (null khi kỳ trước = 0)
export const delta = (cur: number | null, prev: number | null) => (cur == null || prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev));

export function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Cảnh báo (tính trên SQLite, không gọi API) ──────────────────────────────
export interface AlertInput {
  rows: DayRow[]; // phủ ít nhất 9 ngày gần nhất tới hôm nay
  today: string;
  prefs: AlertPrefs;
  roasTargets: Record<string, number | null>; // appId → ngưỡng ROAS
  tcpi: Record<string, number>; // `${appId}|${country}` → tCPI (đơn vị tiền tệ), gia quyền theo chi phí
  fmtPct: (v: number) => string;
  fmtMoney: (v: number) => string;
}

export function evaluateAlerts({ rows, today, prefs, roasTargets, tcpi, fmtPct, fmtMoney }: AlertInput): Alert[] {
  const out: Alert[] = [];
  const yesterday = addDays(today, -1);
  const last7 = (d: string) => d >= addDays(today, -7) && d <= yesterday; // 7 ngày trọn vẹn
  for (const [key, list] of groupBy(rows, (r) => `${r.appId}|${r.country}`)) {
    const [appId, country] = key.split('|');
    const push = (rule: AlertRule, level: AlertLevel, message: string) => out.push({ rule, level, appId, country, message });
    const byDate = new Map(list.map((r) => [r.date, r]));
    const sum = (pred: (d: string) => boolean, f: (r: DayRow) => number) => list.filter((r) => pred(r.date)).reduce((s, r) => s + f(r), 0);

    // CTR quảng cáo bất thường → nghi invalid traffic
    const imp7 = sum(last7, (r) => r.adImpressions);
    const clk7 = sum(last7, (r) => r.adClicks);
    if (imp7 >= prefs.ctrMinImpressions && clk7 / imp7 > prefs.ctrMax) {
      push('ctr', 'danger', `CTR quảng cáo ${fmtPct(clk7 / imp7)} > ${fmtPct(prefs.ctrMax)} — nghi traffic không hợp lệ`);
    }

    // Show rate = impressions / matched requests
    const matched7 = sum(last7, (r) => r.matched);
    if (matched7 >= prefs.showRateMinMatched && imp7 / matched7 < prefs.showRateMin) {
      push('showRate', 'warning', `Show rate ${fmtPct(imp7 / matched7)} < ${fmtPct(prefs.showRateMin)}`);
    }

    // eCPM hôm qua so trung vị 7 ngày trước đó
    const y = byDate.get(yesterday);
    if (y && y.adImpressions >= prefs.ecpmMinImpressions) {
      const ecpms = datesBetween(addDays(yesterday, -7), addDays(yesterday, -1))
        .map((d) => byDate.get(d))
        .filter((r): r is DayRow => !!r && r.adImpressions > 0)
        .map((r) => (r.revenue * 1000) / r.adImpressions);
      const med = median(ecpms);
      const ecpm = (y.revenue * 1000) / y.adImpressions;
      if (ecpms.length >= 3 && med > 0 && ecpm < med * prefs.ecpmDropRatio) {
        push('ecpmDrop', 'warning', `eCPM hôm qua ${fmtMoney(ecpm)} < ${fmtPct(prefs.ecpmDropRatio)} trung vị 7 ngày (${fmtMoney(med)})`);
      }
    }

    // Chi phí hôm nay so trung vị 7 ngày
    const spendToday = byDate.get(today)?.spend ?? 0;
    const spendMed = median(datesBetween(addDays(today, -7), yesterday).map((d) => byDate.get(d)?.spend ?? 0));
    if (spendToday >= prefs.spendSpikeMin && spendMed > 0 && spendToday > spendMed * prefs.spendSpikeX) {
      push('spendSpike', 'warning', `Chi phí hôm nay ${fmtMoney(spendToday)} > ${prefs.spendSpikeX}× trung vị 7 ngày (${fmtMoney(spendMed)})`);
    }

    // ROAS 7 ngày dưới ngưỡng của app
    const target = roasTargets[appId] ?? prefs.defaultRoasTarget;
    const spend7 = sum(last7, (r) => r.spend);
    if (target != null && spend7 >= prefs.roasMinSpend) {
      const roas = sum(last7, (r) => r.revenue) / spend7;
      if (roas < target) push('roasLow', 'danger', `ROAS 7 ngày ${fmtPct(roas)} < ngưỡng ${fmtPct(target)}`);
    }

    // CPI 3 ngày so tCPI của camp
    const t = tcpi[key];
    const in3 = (d: string) => d >= addDays(today, -3) && d <= yesterday;
    const inst3 = sum(in3, (r) => r.installs);
    if (t && inst3 >= prefs.cpiMinInstalls) {
      const cpi = sum(in3, (r) => r.spend) / inst3;
      if (cpi > t * prefs.cpiOverRatio) push('cpiHigh', 'warning', `CPI 3 ngày ${fmtMoney(cpi)} > tCPI ${fmtMoney(t)} × ${prefs.cpiOverRatio}`);
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}

// ── CSV (Excel mở đúng tiếng Việt nhờ BOM) ──────────────────────────────────
export function toCsv(header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
