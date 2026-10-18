import { getJson, setJson } from '../settingsStore';
import { breakdown, getAnalytics, pacing } from '../analytics';
import { listApps } from '../appsStore';
import { listSuggestions } from '../rules';
import { listChanges } from '../googleAds/changes';
import { callClaude } from './translate';
import type { AnalyticsRange } from '@shared/analytics';

// Tóm tắt số liệu bằng Claude: chỉ gửi số đã gộp (không có email, token, ID tài khoản), nhận về vài gạch đầu dòng tiếng Việt.

export interface AiSummary {
  at: string;
  text: string;
  from: string;
  to: string;
}

const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);
const pct = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 100)}%`);

export function summaryInput(appId: string | null, range: AnalyticsRange) {
  const a = getAnalytics(appId, range);
  const k = (x: typeof a.kpis) => ({ spend: r2(x.spend), revenue: r2(x.revenue), profit: r2(x.profit), roas: pct(x.roas), installs: Math.round(x.installs), cpi: r2(x.cpi), ecpm: r2(x.ecpm) });
  const units = breakdown(appId, range, 'adUnit', null).rows;
  const scoped = listApps().filter((x) => !appId || x.id === appId);
  const customers = [...new Set(scoped.map((x) => x.adsCustomerId).filter((x): x is string => !!x))];
  const changes = listChanges({ customerIds: customers, from: a.range.from, to: a.range.to });
  return {
    currency: a.currency,
    period: `${a.range.from}..${a.range.to}`,
    roasTarget: pct(a.roasTarget),
    total: k(a.kpis),
    previous: k(a.prev),
    countries: a.countries.slice(0, 12).map((c) => ({ country: c.country, ...k(c), prevRoas: pct(c.prevRoas), alerts: c.alerts.map((x) => x.message) })),
    adUnits: units.slice(0, 8).map((u) => ({ name: u.label, format: u.format, revenue: r2(u.revenue), ecpm: r2(u.ecpm), prevEcpm: r2(u.prev.ecpm), fill: pct(u.fillRate), show: pct(u.showRate), flags: (u.flags ?? []).map((f) => f.message) })),
    pendingRuleSuggestions: listSuggestions('pending').length,
    monthBudget: customers.map((c) => {
      const p = pacing(c);
      return { budget: r2(p.budget), spent: r2(p.spent), projected: r2(p.projected), status: p.status };
    }),
    accountChanges: changes.slice(0, 15).map((c) => ({ date: c.date, campaign: c.campaignName, type: c.resourceType, op: c.operation, source: c.source, details: c.details })),
  };
}

const SYSTEM = `Bạn là chuyên gia user acquisition cho app mobile (Google App campaigns + kiếm tiền bằng quảng cáo AdMob).
Đọc số liệu JSON và viết tóm tắt TIẾNG VIỆT ngắn gọn cho chủ app:
- Đúng 3 phần, mỗi phần bắt đầu bằng tiêu đề trên một dòng riêng: "Tổng quan", "Vấn đề", "Nên làm".
- Mỗi phần 2–4 gạch đầu dòng bắt đầu bằng "- ", mỗi dòng tối đa 30 từ, có số cụ thể (tiền, %, mã nước).
- ROAS ở đây là doanh thu quảng cáo cùng kỳ ÷ chi phí (blended), chưa gồm IAP; đừng kết luận quá mức khi số nhỏ.
- "Nên làm" phải là hành động cụ thể (tăng/giảm ngân sách hay tCPI bao nhiêu %, thay video, kiểm tra ad unit…).
- Không bịa số không có trong dữ liệu. Không dùng markdown khác ngoài gạch đầu dòng.`;

export async function aiSummary(appId: string | null, range: AnalyticsRange, refresh: boolean): Promise<AiSummary> {
  const key = `aiSummary:${appId ?? 'all'}:${JSON.stringify(range)}`;
  const cached = getJson<AiSummary>(key);
  // Dùng lại bản trong 6 giờ để không tốn lượt gọi
  if (!refresh && cached && Date.now() - Date.parse(cached.at) < 6 * 3600_000) return cached;
  const input = summaryInput(appId, range);
  const text = await callClaude(SYSTEM, `Số liệu:\n${JSON.stringify(input)}`);
  const [from, to] = input.period.split('..');
  const out: AiSummary = { at: new Date().toISOString(), text: text.trim(), from, to };
  setJson(key, out);
  return out;
}

export const aiSummaryCached = (appId: string | null, range: AnalyticsRange) => getJson<AiSummary>(`aiSummary:${appId ?? 'all'}:${JSON.stringify(range)}`);
