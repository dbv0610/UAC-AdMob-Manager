import { fromAdmobDate } from '@shared/analytics';

// Phản hồi report của AdMob là mảng stream: [{header}, {row}…, {footer}]. Tách ra để test không cần mạng.
interface Val {
  value?: string | null;
  displayLabel?: string | null;
}
interface Metric {
  microsValue?: string | null;
  integerValue?: string | null;
  doubleValue?: number | null;
}
export interface ReportChunk {
  header?: { localizationSettings?: { currencyCode?: string } };
  row?: { dimensionValues?: Record<string, Val>; metricValues?: Record<string, Metric> };
  footer?: { matchingRowCount?: string; warnings?: { type?: string; description?: string }[] };
}

export interface RevenueRow {
  date: string;
  admobAppId: string;
  country: string;
  format: string;
  adSource: string;
  earningsMicros: number;
  impressions: number;
  requests: number;
  matched: number;
  clicks: number;
  currency: string;
}

// microsValue có thể vượt MAX_SAFE_INTEGER khi doanh thu rất lớn: đổi qua BigInt rồi mới về Number
const micros = (m?: Metric) => (m?.microsValue ? Number(BigInt(m.microsValue)) : 0);
const int = (m?: Metric) => Number(m?.integerValue ?? 0);

export function parseMediation(data: ReportChunk[] | ReportChunk, fallbackCurrency: string) {
  const chunks = Array.isArray(data) ? data : [data];
  const currency = chunks.find((c) => c.header)?.header?.localizationSettings?.currencyCode ?? fallbackCurrency;
  const rows: RevenueRow[] = [];
  const sources = new Map<string, string>(); // id → tên nguồn quảng cáo
  for (const c of chunks) {
    const dv = c.row?.dimensionValues;
    const mv = c.row?.metricValues;
    if (!dv || !mv) continue;
    const src = dv.AD_SOURCE?.displayLabel || dv.AD_SOURCE?.value || '—';
    if (dv.AD_SOURCE?.value) sources.set(dv.AD_SOURCE.value, src);
    rows.push({
      date: fromAdmobDate(dv.DATE!.value!),
      admobAppId: dv.APP?.value ?? '',
      country: dv.COUNTRY?.value || 'ZZ',
      format: dv.FORMAT?.value ?? '',
      adSource: src,
      earningsMicros: micros(mv.ESTIMATED_EARNINGS),
      impressions: int(mv.IMPRESSIONS),
      requests: int(mv.AD_REQUESTS),
      matched: int(mv.MATCHED_REQUESTS),
      clicks: int(mv.CLICKS),
      currency,
    });
  }
  const warnings = chunks.flatMap((c) => c.footer?.warnings ?? []).map((w) => w.description ?? w.type ?? '');
  return { rows, currency, warnings };
}

export interface UnitRow {
  date: string;
  admobAppId: string;
  adUnitId: string;
  adUnitName: string;
  country: string;
  format: string;
  earningsMicros: number;
  impressions: number;
  requests: number;
  matched: number;
  clicks: number;
  currency: string;
}

// Báo cáo theo AD_UNIT (không tách nguồn): gộp lại theo khóa vì AdMob có thể trả nhiều dòng cùng khóa
export function parseUnits(data: ReportChunk[] | ReportChunk, fallbackCurrency: string) {
  const chunks = Array.isArray(data) ? data : [data];
  const currency = chunks.find((c) => c.header)?.header?.localizationSettings?.currencyCode ?? fallbackCurrency;
  const by = new Map<string, UnitRow>();
  for (const c of chunks) {
    const dv = c.row?.dimensionValues;
    const mv = c.row?.metricValues;
    if (!dv || !mv || !dv.AD_UNIT?.value) continue;
    const date = fromAdmobDate(dv.DATE!.value!);
    const country = dv.COUNTRY?.value || 'ZZ';
    const k = `${date}|${dv.AD_UNIT.value}|${country}`;
    const r = by.get(k) ?? {
      date,
      admobAppId: dv.APP?.value ?? '',
      adUnitId: dv.AD_UNIT.value,
      adUnitName: dv.AD_UNIT.displayLabel || dv.AD_UNIT.value,
      country,
      format: dv.FORMAT?.value ?? '',
      earningsMicros: 0,
      impressions: 0,
      requests: 0,
      matched: 0,
      clicks: 0,
      currency,
    };
    r.earningsMicros += micros(mv.ESTIMATED_EARNINGS);
    r.impressions += int(mv.IMPRESSIONS);
    r.requests += int(mv.AD_REQUESTS);
    r.matched += int(mv.MATCHED_REQUESTS);
    r.clicks += int(mv.CLICKS);
    by.set(k, r);
  }
  return [...by.values()];
}

export interface UnitSourceRow {
  date: string;
  admobAppId: string;
  adUnitId: string;
  adSource: string;
  earningsMicros: number;
  impressions: number;
  requests: number;
  matched: number;
  clicks: number;
  currency: string;
}

// Báo cáo AD_UNIT × AD_SOURCE: gộp dòng trùng khóa (cùng tên nguồn có thể đến từ nhiều instance)
export function parseUnitSources(data: ReportChunk[] | ReportChunk, fallbackCurrency: string) {
  const chunks = Array.isArray(data) ? data : [data];
  const currency = chunks.find((c) => c.header)?.header?.localizationSettings?.currencyCode ?? fallbackCurrency;
  const by = new Map<string, UnitSourceRow>();
  for (const c of chunks) {
    const dv = c.row?.dimensionValues;
    const mv = c.row?.metricValues;
    if (!dv || !mv || !dv.AD_UNIT?.value) continue;
    const date = fromAdmobDate(dv.DATE!.value!);
    const adSource = dv.AD_SOURCE?.displayLabel || dv.AD_SOURCE?.value || '—';
    const k = `${date}|${dv.AD_UNIT.value}|${adSource}`;
    const r = by.get(k) ?? { date, admobAppId: dv.APP?.value ?? '', adUnitId: dv.AD_UNIT.value, adSource, earningsMicros: 0, impressions: 0, requests: 0, matched: 0, clicks: 0, currency };
    r.earningsMicros += micros(mv.ESTIMATED_EARNINGS);
    r.impressions += int(mv.IMPRESSIONS);
    r.requests += int(mv.AD_REQUESTS);
    r.matched += int(mv.MATCHED_REQUESTS);
    r.clicks += int(mv.CLICKS);
    by.set(k, r);
  }
  return [...by.values()];
}

// 'ca-app-pub-1234567890123456~1234567890' → 'pub-1234567890123456'
export const publisherOf = (admobAppId: string) => admobAppId.match(/ca-app-(pub-\d+)~/)?.[1] ?? null;
