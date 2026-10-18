// Hiệu quả từng video, tiêu ngân sách tháng, nhật ký thay đổi Google Ads — kiểu + hàm thuần dùng chung main/renderer/test.

// ── Hiệu quả video trong App campaign ───────────────────────────────────────
export type GoogleLabel = 'BEST' | 'GOOD' | 'LOW' | 'LEARNING' | 'PENDING' | 'UNKNOWN';
export interface VideoCampStat {
  campaignId: string;
  campaignName: string;
  country: string | null;
  label: GoogleLabel;
  enabled: boolean;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
}
export type Verdict = 'winner' | 'loser' | 'learning' | 'neutral';
export interface VideoPerf {
  videoId: string; // YouTube ID
  title: string;
  campaigns: VideoCampStat[];
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  cpiMicros: number | null;
  ctr: number | null;
  cvr: number | null;
  relCpi: number | null; // CPI video ÷ CPI trung bình các camp chứa nó (gia quyền) — < 1 là rẻ hơn
  verdict: Verdict;
  labels: GoogleLabel[];
}
export interface VideoPerfResult {
  at: string;
  from: string;
  to: string;
  items: VideoPerf[];
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
export const MIN_IMPRESSIONS = 1000;
export const MIN_CONVERSIONS = 10;

// Gộp theo video; so CPI của video với CPI chung của từng camp chứa nó (để video ở camp đắt không bị oan)
export function rankVideos(rows: (VideoCampStat & { videoId: string; title: string })[]): VideoPerf[] {
  const campTotals = new Map<string, { cost: number; conv: number }>();
  for (const r of rows) {
    const t = campTotals.get(r.campaignId) ?? { cost: 0, conv: 0 };
    t.cost += r.costMicros;
    t.conv += r.conversions;
    campTotals.set(r.campaignId, t);
  }
  const by = new Map<string, VideoPerf>();
  for (const r of rows) {
    const v = by.get(r.videoId) ?? {
      videoId: r.videoId, title: r.title, campaigns: [], impressions: 0, clicks: 0, costMicros: 0, conversions: 0,
      cpiMicros: null, ctr: null, cvr: null, relCpi: null, verdict: 'neutral' as Verdict, labels: [],
    };
    const { videoId: _v, title: _t, ...camp } = r;
    v.campaigns.push(camp);
    v.impressions += r.impressions;
    v.clicks += r.clicks;
    v.costMicros += r.costMicros;
    v.conversions += r.conversions;
    if (!v.title && r.title) v.title = r.title;
    by.set(r.videoId, v);
  }
  return [...by.values()]
    .map((v) => {
      v.cpiMicros = div(v.costMicros, v.conversions);
      v.ctr = div(v.clicks, v.impressions);
      v.cvr = div(v.conversions, v.clicks);
      // CPI kỳ vọng nếu video có CPI bằng trung bình camp: Σ chi phí video ở camp ÷ CPI camp
      let expectedConv = 0;
      for (const c of v.campaigns) {
        const t = campTotals.get(c.campaignId)!;
        const campCpi = div(t.cost, t.conv);
        if (campCpi) expectedConv += c.costMicros / campCpi;
      }
      v.relCpi = v.conversions > 0 && expectedConv > 0 ? expectedConv / v.conversions : null;
      v.labels = [...new Set(v.campaigns.map((c) => c.label))];
      v.verdict = verdictOf(v);
      v.campaigns.sort((a, b) => b.costMicros - a.costMicros);
      return v;
    })
    .sort((a, b) => b.costMicros - a.costMicros);
}

export function verdictOf(v: Pick<VideoPerf, 'impressions' | 'conversions' | 'costMicros' | 'relCpi' | 'labels'>): Verdict {
  if (v.impressions < MIN_IMPRESSIONS) return 'learning';
  const low = v.labels.includes('LOW');
  if (v.conversions >= MIN_CONVERSIONS && v.relCpi != null) {
    if (v.relCpi <= 0.8 && !low) return 'winner';
    if (v.relCpi >= 1.3) return 'loser';
  }
  if (low) return 'loser';
  if (v.labels.includes('BEST') && v.conversions >= MIN_CONVERSIONS) return 'winner';
  return 'neutral';
}

// ── Ngân sách tháng ─────────────────────────────────────────────────────────
export interface Pacing {
  month: string; // YYYY-MM
  budget: number | null; // hạn mức tháng do người dùng đặt (đơn vị tiền)
  spent: number; // từ đầu tháng tới hôm qua
  avg7: number; // chi trung bình/ngày 7 ngày gần nhất
  dailyBudgets: number; // tổng ngân sách/ngày các camp đang chạy
  daysInMonth: number;
  daysLeft: number; // tính cả hôm nay
  projected: number; // spent + avg7 × daysLeft
  projectedByBudget: number; // spent + dailyBudgets × daysLeft (trần nếu camp tiêu hết ngân sách)
  elapsed: number; // tỉ lệ thời gian đã qua của tháng
  usage: number | null; // spent / budget
  status: 'none' | 'under' | 'on' | 'over';
  suggestedDaily: number | null; // tiêu mỗi ngày bao nhiêu để vừa hết hạn mức
}

export function pacingOf(input: { today: string; budget: number | null; spent: number; avg7: number; dailyBudgets: number }): Pacing {
  const { today, budget, spent, avg7, dailyBudgets } = input;
  const [y, m, d] = today.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = daysInMonth - d + 1;
  const projected = spent + avg7 * daysLeft;
  const projectedByBudget = spent + dailyBudgets * daysLeft;
  const elapsed = (d - 1) / daysInMonth;
  let status: Pacing['status'] = 'none';
  if (budget != null && budget > 0) status = projected > budget * 1.05 ? 'over' : projected < budget * 0.85 ? 'under' : 'on';
  return {
    month: today.slice(0, 7),
    budget,
    spent,
    avg7,
    dailyBudgets,
    daysInMonth,
    daysLeft,
    projected,
    projectedByBudget,
    elapsed,
    usage: budget ? spent / budget : null,
    status,
    suggestedDaily: budget != null ? Math.max(0, (budget - spent) / daysLeft) : null,
  };
}

// ── Nhật ký thay đổi Google Ads (change_event) ──────────────────────────────
export interface ChangeDetail {
  field: string; // status, budget, targetCpa, targetRoas, name, …
  before: string | number | null;
  after: string | number | null;
  kind: 'money' | 'pct' | 'text';
}
export interface ChangeEventRow {
  id: string;
  customerId: string;
  at: string; // ISO
  date: string; // YYYY-MM-DD (giờ máy)
  campaignId: string | null;
  campaignName: string | null;
  resourceType: string;
  operation: string; // CREATE | UPDATE | REMOVE
  source: string; // Web, API (app này hoặc tool khác), Rule tự động, Editor…
  user: string | null;
  details: ChangeDetail[];
  fields: string[];
}

export const CLIENT_LABEL: Record<string, string> = {
  GOOGLE_ADS_WEB_CLIENT: 'Web Google Ads',
  GOOGLE_ADS_AUTOMATED_RULE: 'Rule tự động của Google Ads',
  GOOGLE_ADS_SCRIPTS: 'Google Ads Scripts',
  GOOGLE_ADS_BULK_UPLOAD: 'Tải lên hàng loạt',
  GOOGLE_ADS_API: 'API (app này hoặc tool khác)',
  GOOGLE_ADS_EDITOR: 'Google Ads Editor',
  GOOGLE_ADS_MOBILE_APP: 'App Google Ads trên điện thoại',
  GOOGLE_ADS_RECOMMENDATIONS: 'Đề xuất của Google',
  INTERNAL_TOOL: 'Google (nội bộ)',
  OTHER: 'Khác',
};

const FIELD_LABEL: Record<string, string> = { status: 'Trạng thái', budget: 'Ngân sách/ngày', targetCpa: 'tCPI', targetRoas: 'tROAS', name: 'Tên' };
export const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f;

// Mô tả ngắn một thay đổi (renderer định dạng tiền theo tiền tệ)
export function describeChange(e: ChangeEventRow, fmtMoney: (micros: number) => string, fmtPct: (v: number) => string) {
  const v = (d: ChangeDetail, x: ChangeDetail['before']) => (x == null ? '—' : d.kind === 'money' ? fmtMoney(Number(x)) : d.kind === 'pct' ? fmtPct(Number(x)) : String(x));
  if (e.details.length) return e.details.map((d) => `${fieldLabel(d.field)} ${v(d, d.before)} → ${v(d, d.after)}`).join(' · ');
  const what = { CAMPAIGN: 'camp', CAMPAIGN_BUDGET: 'ngân sách', AD_GROUP: 'nhóm quảng cáo', AD_GROUP_AD: 'quảng cáo (video/text)', ASSET: 'asset', CAMPAIGN_CRITERION: 'nhắm mục tiêu', AD_GROUP_ASSET: 'asset của nhóm' }[e.resourceType] ?? e.resourceType.toLowerCase();
  const op = e.operation === 'CREATE' ? 'Tạo' : e.operation === 'REMOVE' ? 'Xóa' : 'Sửa';
  return `${op} ${what}${e.fields.length ? ` (${e.fields.slice(0, 3).join(', ')}${e.fields.length > 3 ? '…' : ''})` : ''}`;
}
