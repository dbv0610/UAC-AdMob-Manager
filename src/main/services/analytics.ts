import fs from 'node:fs';
import { BrowserWindow, Notification, dialog } from 'electron';
import { and, between, eq, inArray, isNotNull, min, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import log from 'electron-log/main';
import { db } from '../db';
import { accounts, adsCustomers, apps, campaignMeta, revenueDaily, revenueUnitDaily, revenueUnitSourceDaily, spendDaily } from '../db/schema';
import { broadcast } from '../events';
import { UserFacingError } from '../ipc/register';
import type { JobContext } from '../jobs/queue';
import { listApps } from './appsStore';
import { getJson, getPrefs, setJson } from './settingsStore';
import { syncSpend } from './googleAds/reports';
import { syncChanges } from './googleAds/changes';
import { pacingOf, type Pacing } from '@shared/insights';
import { sendTelegramQuiet, telegramConfig } from './notify/telegram';
import { redAlertText } from './notify/digest';
import { syncRevenue } from './admob/reports';
import {
  DEFAULT_ALERT_PREFS,
  addDays,
  countryStats,
  dailyOf,
  evaluateAlerts,
  FORMAT_LABEL,
  heatmapOf,
  isoDate,
  sourceFlags,
  unitFlags,
  kpisFromTotals,
  kpisOf,
  resolveRange,
  toCsv,
  type AdUnitDetail,
  type CampaignDetail,
  type AnalyticsRange,
  type AnalyticsResult,
  type BreakRow,
  type Breakdown,
  type Dim,
  type Kpis,
  type CountryDetail,
  type DayRow,
  type SyncStatus,
} from '@shared/analytics';
import { getCountry } from '@shared/geo';
import type { AppMapping } from '@shared/types';

// Mọi bảng/biểu đồ đọc từ SQLite: mở dashboard không gọi API, đổi kỳ/lọc tức thì.

const EMPTY_STATUS: SyncStatus = { at: null, from: null, to: null, spend: { ok: false, at: null }, revenue: { ok: false, at: null } };
export const syncStatus = (): SyncStatus => ({ ...(getJson<SyncStatus>('reportSync') ?? EMPTY_STATUS), earliest: dataFromOf(listApps()) });
export const alertPrefs = () => ({ ...DEFAULT_ALERT_PREFS, ...(getJson('alertPrefs') ?? {}) });
export const setAlertPrefs = (p: typeof DEFAULT_ALERT_PREFS) => {
  setJson('alertPrefs', p);
  return p;
};

// Tiền tệ của app = tiền tệ tài khoản Ads gắn với app
function currencyOf(app: AppMapping) {
  if (!app.adsCustomerId) return 'USD';
  return db.select({ c: adsCustomers.currency }).from(adsCustomers).where(eq(adsCustomers.customerId, app.adsCustomerId)).get()?.c ?? 'USD';
}

// App trong phạm vi; khi xem mọi app mà tiền tệ khác nhau thì giữ tiền tệ phổ biến nhất, báo các app bị loại
function scope(appId: string | null) {
  const all = listApps();
  const chosen = appId ? all.filter((a) => a.id === appId) : all;
  if (appId && !chosen.length) throw new UserFacingError({ message: 'App không còn tồn tại', code: 'NOT_FOUND', action: 'openSettings' });
  const withCur = chosen.map((a) => ({ app: a, currency: currencyOf(a) }));
  const counts = new Map<string, number>();
  for (const x of withCur) counts.set(x.currency, (counts.get(x.currency) ?? 0) + 1);
  const currency = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
  return {
    currency,
    apps: withCur.filter((x) => x.currency === currency).map((x) => x.app),
    excluded: withCur.filter((x) => x.currency !== currency).map((x) => `${x.app.name} (${x.currency})`),
  };
}

export function loadDayRows(scoped: AppMapping[], currency: string, from: string, to: string): DayRow[] {
  if (!scoped.length) return [];
  const byStore = new Map(scoped.map((a) => [a.storeAppId, a.id]));
  const byAdmob = new Map(scoped.filter((a) => a.admobAppId).map((a) => [a.admobAppId!, a.id]));
  const out = new Map<string, DayRow>();
  const row = (date: string, appId: string, country: string) => {
    const k = `${date}|${appId}|${country}`;
    let r = out.get(k);
    if (!r) out.set(k, (r = { date, appId, country, spend: 0, installs: 0, revenue: 0, adImpressions: 0, matched: 0, requests: 0, adClicks: 0, adsImpressions: 0, adsClicks: 0 }));
    return r;
  };

  const spend = db
    .select({ date: spendDaily.date, app: spendDaily.appId, country: spendDaily.country, cost: sql<number>`sum(${spendDaily.costMicros})`, installs: sql<number>`sum(${spendDaily.installs})`,
      imps: sql<number>`sum(${spendDaily.impressions})`, clicks: sql<number>`sum(${spendDaily.clicks})` })
    .from(spendDaily)
    .where(and(between(spendDaily.date, from, to), inArray(spendDaily.appId, [...byStore.keys()]), eq(spendDaily.currency, currency)))
    .groupBy(spendDaily.date, spendDaily.appId, spendDaily.country)
    .all();
  for (const s of spend) {
    const r = row(s.date, byStore.get(s.app)!, s.country);
    r.spend += s.cost / 1e6;
    r.installs += s.installs;
    r.adsImpressions += s.imps;
    r.adsClicks += s.clicks;
  }

  if (byAdmob.size) {
    const rev = db
      .select({
        date: revenueDaily.date,
        app: revenueDaily.admobAppId,
        country: revenueDaily.country,
        earnings: sql<number>`sum(${revenueDaily.earningsMicros})`,
        imps: sql<number>`sum(${revenueDaily.impressions})`,
        matched: sql<number>`sum(${revenueDaily.matched})`,
        requests: sql<number>`sum(${revenueDaily.requests})`,
        clicks: sql<number>`sum(${revenueDaily.clicks})`,
      })
      .from(revenueDaily)
      .where(and(between(revenueDaily.date, from, to), inArray(revenueDaily.admobAppId, [...byAdmob.keys()]), eq(revenueDaily.currency, currency)))
      .groupBy(revenueDaily.date, revenueDaily.admobAppId, revenueDaily.country)
      .all();
    for (const v of rev) {
      const r = row(v.date, byAdmob.get(v.app)!, v.country);
      r.revenue += v.earnings / 1e6;
      r.adImpressions += v.imps;
      r.matched += v.matched;
      r.requests += v.requests;
      r.adClicks += v.clicks;
    }
  }
  return [...out.values()];
}

// tCPI theo (app, quốc gia): trung bình target_cpa của các camp, gia quyền theo chi phí 3 ngày
function tcpiMap(scoped: AppMapping[], today: string) {
  const byStore = new Map(scoped.map((a) => [a.storeAppId, a.id]));
  if (!byStore.size) return {};
  const rows = db
    .select({ app: spendDaily.appId, country: spendDaily.country, cost: sql<number>`sum(${spendDaily.costMicros})`, target: campaignMeta.targetCpaMicros })
    .from(spendDaily)
    .innerJoin(campaignMeta, eq(campaignMeta.campaignId, spendDaily.campaignId))
    .where(and(between(spendDaily.date, addDays(today, -3), addDays(today, -1)), inArray(spendDaily.appId, [...byStore.keys()]), isNotNull(campaignMeta.targetCpaMicros)))
    .groupBy(spendDaily.appId, spendDaily.country, spendDaily.campaignId)
    .all();
  const acc = new Map<string, { w: number; sum: number }>();
  for (const r of rows) {
    const k = `${byStore.get(r.app)}|${r.country}`;
    const a = acc.get(k) ?? { w: 0, sum: 0 };
    const w = Math.max(r.cost, 1); // camp chưa tiêu vẫn tính trọng số nhỏ
    a.w += w;
    a.sum += w * (r.target! / 1e6);
    acc.set(k, a);
  }
  return Object.fromEntries([...acc].map(([k, a]) => [k, a.sum / a.w]));
}

const fmt = (currency: string) => ({
  fmtPct: (v: number) => new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 }).format(v),
  fmtMoney: (v: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(v),
});

function alertsFor(scoped: AppMapping[], currency: string, today: string) {
  const rows = loadDayRows(scoped, currency, addDays(today, -9), today);
  return evaluateAlerts({
    rows,
    today,
    prefs: alertPrefs(),
    roasTargets: Object.fromEntries(scoped.map((a) => [a.id, a.roasTarget])),
    tcpi: tcpiMap(scoped, today),
    ...fmt(currency),
  });
}

// Ngày sớm nhất có dữ liệu của phạm vi (gợi ý đồng bộ thêm khi kỳ chọn dài hơn)
function dataFromOf(scoped: AppMapping[]) {
  const stores = scoped.map((a) => a.storeAppId);
  const admobs = scoped.map((a) => a.admobAppId).filter((x): x is string => !!x);
  const a = stores.length ? db.select({ d: min(spendDaily.date) }).from(spendDaily).where(inArray(spendDaily.appId, stores)).get()?.d : null;
  const b = admobs.length ? db.select({ d: min(revenueDaily.date) }).from(revenueDaily).where(inArray(revenueDaily.admobAppId, admobs)).get()?.d : null;
  return [a, b].filter((x): x is string => !!x).sort()[0] ?? null;
}

export function getAnalytics(appId: string | null, spec: AnalyticsRange): AnalyticsResult {
  const today = isoDate(new Date());
  const { currency, apps: scoped, excluded } = scope(appId);
  const range = resolveRange(spec, today, dataFromOf(scoped));
  const cur = loadDayRows(scoped, currency, range.from, range.to);
  const prev = loadDayRows(scoped, currency, range.prevFrom, range.prevTo);
  const alerts = alertsFor(scoped, currency, today);
  const app = appId ? scoped[0] : null;
  return {
    currency,
    mixedCurrency: excluded,
    range,
    kpis: kpisOf(cur),
    prev: kpisOf(prev),
    daily: dailyOf(cur, range.from, range.to),
    prevDaily: dailyOf(prev, range.prevFrom, range.prevTo),
    countries: countryStats(cur, prev, alerts).sort((a, b) => b.spend - a.spend || b.revenue - a.revenue),
    alerts,
    hasData: cur.length > 0 || prev.length > 0,
    dataFrom: dataFromOf(scoped),
    roasTarget: app?.roasTarget ?? alertPrefs().defaultRoasTarget,
    heat: heatmapOf(cur, range.from, range.to),
  };
}

export function countryDetail(appId: string | null, spec: AnalyticsRange, country: string): CountryDetail {
  const { currency, apps: scoped } = scope(appId);
  const range = resolveRange(spec, undefined, dataFromOf(scoped)); // “từ trước đến nay” = từ ngày đầu có dữ liệu
  const rows = loadDayRows(scoped, currency, range.from, range.to).filter((r) => r.country === country);
  const sources = revenueBy(scoped, currency, range.from, range.to, 'adSource', country).map((s) => ({
    adSource: s.key,
    revenue: s.revenue,
    impressions: s.adImpressions,
    ecpm: s.ecpm,
    matchRate: s.fillRate,
  }));
  return { daily: dailyOf(rows, range.from, range.to), sources };
}

// ── Phân tích theo chiều ────────────────────────────────────────────────────
type RevKey = 'format' | 'adSource';

// Doanh thu AdMob gộp theo định dạng hoặc nguồn quảng cáo (không có chi phí)
function revenueBy(scoped: AppMapping[], currency: string, from: string, to: string, field: RevKey, country: string | null) {
  const ids = scoped.map((a) => a.admobAppId).filter((x): x is string => !!x);
  if (!ids.length) return [];
  const col = field === 'format' ? revenueDaily.format : revenueDaily.adSource;
  return db
    .select({
      key: col,
      earnings: sql<number>`sum(${revenueDaily.earningsMicros})`,
      imps: sql<number>`sum(${revenueDaily.impressions})`,
      matched: sql<number>`sum(${revenueDaily.matched})`,
      requests: sql<number>`sum(${revenueDaily.requests})`,
      clicks: sql<number>`sum(${revenueDaily.clicks})`,
    })
    .from(revenueDaily)
    .where(and(between(revenueDaily.date, from, to), inArray(revenueDaily.admobAppId, ids), eq(revenueDaily.currency, currency), country ? eq(revenueDaily.country, country) : undefined))
    .groupBy(col)
    .all()
    .map((r) => ({ key: r.key || '—', ...kpisFromTotals({ spend: 0, installs: 0, revenue: r.earnings / 1e6, adImpressions: r.imps, matched: r.matched, requests: r.requests, adClicks: r.clicks }) }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Chi phí theo camp; doanh thu quy về camp theo tỉ lệ chi phí của camp trong (ngày, app, nước)
function campaignRows(scoped: AppMapping[], currency: string, from: string, to: string, country: string | null) {
  const byStore = new Map(scoped.map((a) => [a.storeAppId, a]));
  if (!byStore.size) return new Map<string, { t: Required<Parameters<typeof kpisFromTotals>[0]>; countries: Map<string, number> }>();
  const spend = db
    .select()
    .from(spendDaily)
    .where(and(between(spendDaily.date, from, to), inArray(spendDaily.appId, [...byStore.keys()]), eq(spendDaily.currency, currency), country ? eq(spendDaily.country, country) : undefined))
    .all();
  const day = loadDayRows(scoped, currency, from, to);
  const revenue = new Map(day.map((r) => [`${r.date}|${r.appId}|${r.country}`, r]));
  const totals = new Map<string, number>();
  for (const s of spend) {
    const k = `${s.date}|${byStore.get(s.appId)!.id}|${s.country}`;
    totals.set(k, (totals.get(k) ?? 0) + s.costMicros);
  }
  const out = new Map<string, { t: Required<Parameters<typeof kpisFromTotals>[0]>; countries: Map<string, number> }>();
  for (const s of spend) {
    const k = `${s.date}|${byStore.get(s.appId)!.id}|${s.country}`;
    const c = out.get(s.campaignId) ?? { t: { spend: 0, installs: 0, revenue: 0, adImpressions: 0, matched: 0, requests: 0, adsImpressions: 0, adsClicks: 0, adClicks: 0 }, countries: new Map() };
    const share = (totals.get(k) ?? 0) > 0 ? s.costMicros / totals.get(k)! : 0;
    const r = revenue.get(k);
    c.t.spend += s.costMicros / 1e6;
    c.t.installs += s.installs;
    c.t.adsImpressions += s.impressions;
    c.t.adsClicks += s.clicks;
    if (r) {
      c.t.revenue += r.revenue * share;
      c.t.adImpressions += r.adImpressions * share;
      c.t.matched += r.matched * share;
      c.t.requests += r.requests * share;
      c.t.adClicks += r.adClicks * share;
    }
    c.countries.set(s.country, (c.countries.get(s.country) ?? 0) + s.costMicros);
    out.set(s.campaignId, c);
  }
  return out;
}

// Doanh thu theo ad unit, có thể lọc nước hoặc gộp theo nước của một unit
const unitSums = {
  earnings: sql<number>`sum(${revenueUnitDaily.earningsMicros})`,
  imps: sql<number>`sum(${revenueUnitDaily.impressions})`,
  matched: sql<number>`sum(${revenueUnitDaily.matched})`,
  requests: sql<number>`sum(${revenueUnitDaily.requests})`,
  clicks: sql<number>`sum(${revenueUnitDaily.clicks})`,
};
const unitKpis = (r: { earnings: number; imps: number; matched: number; requests: number; clicks: number }) =>
  kpisFromTotals({ spend: 0, installs: 0, revenue: r.earnings / 1e6, adImpressions: r.imps, matched: r.matched, requests: r.requests, adClicks: r.clicks });
const admobIdsOf = (scoped: AppMapping[]) => scoped.map((a) => a.admobAppId).filter((x): x is string => !!x);

function unitsBy(scoped: AppMapping[], currency: string, from: string, to: string, country: string | null) {
  const ids = admobIdsOf(scoped);
  if (!ids.length) return [];
  return db
    .select({ key: revenueUnitDaily.adUnitId, name: sql<string>`max(${revenueUnitDaily.adUnitName})`, format: sql<string>`max(${revenueUnitDaily.format})`, app: sql<string>`max(${revenueUnitDaily.admobAppId})`, ...unitSums })
    .from(revenueUnitDaily)
    .where(and(between(revenueUnitDaily.date, from, to), inArray(revenueUnitDaily.admobAppId, ids), eq(revenueUnitDaily.currency, currency), country ? eq(revenueUnitDaily.country, country) : undefined))
    .groupBy(revenueUnitDaily.adUnitId)
    .all();
}

export function adUnitDetail(appId: string | null, spec: AnalyticsRange, unitId: string): AdUnitDetail {
  const { currency, apps: scoped } = scope(appId);
  const range = resolveRange(spec, undefined, dataFromOf(scoped)); // “từ trước đến nay” = từ ngày đầu có dữ liệu
  const ids = admobIdsOf(scoped);
  if (!ids.length) return { daily: dailyOf([], range.from, range.to), countries: [], sources: [], sourceDaily: [] };
  const where = (from: string, to: string) =>
    and(between(revenueUnitDaily.date, from, to), inArray(revenueUnitDaily.admobAppId, ids), eq(revenueUnitDaily.currency, currency), eq(revenueUnitDaily.adUnitId, unitId));
  const days = db.select({ date: revenueUnitDaily.date, ...unitSums }).from(revenueUnitDaily).where(where(range.from, range.to)).groupBy(revenueUnitDaily.date).all();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const daily = dailyOf([], range.from, range.to).map((p) => {
    const d = byDate.get(p.date);
    return d ? { ...p, revenue: d.earnings / 1e6, adImpressions: d.imps, matched: d.matched, requests: d.requests, adClicks: d.clicks } : p;
  });
  const byCountry = (from: string, to: string) =>
    db.select({ key: revenueUnitDaily.country, ...unitSums }).from(revenueUnitDaily).where(where(from, to)).groupBy(revenueUnitDaily.country).all();
  const prev = new Map(byCountry(range.prevFrom, range.prevTo).map((r) => [r.key, unitKpis(r)]));
  const countries = byCountry(range.from, range.to)
    .map((r) => ({ key: r.key, label: getCountry(r.key)?.name ?? r.key, ...unitKpis(r), prev: prev.get(r.key) ?? EMPTY_KPIS }))
    .sort((a, b) => b.revenue - a.revenue);

  // Theo nguồn mediation trong unit
  const srcWhere = (from: string, to: string) =>
    and(between(revenueUnitSourceDaily.date, from, to), inArray(revenueUnitSourceDaily.admobAppId, ids), eq(revenueUnitSourceDaily.currency, currency), eq(revenueUnitSourceDaily.adUnitId, unitId));
  const srcSums = {
    earnings: sql<number>`sum(${revenueUnitSourceDaily.earningsMicros})`,
    imps: sql<number>`sum(${revenueUnitSourceDaily.impressions})`,
    matched: sql<number>`sum(${revenueUnitSourceDaily.matched})`,
    requests: sql<number>`sum(${revenueUnitSourceDaily.requests})`,
    clicks: sql<number>`sum(${revenueUnitSourceDaily.clicks})`,
  };
  const bySource = (from: string, to: string) =>
    db.select({ key: revenueUnitSourceDaily.adSource, ...srcSums }).from(revenueUnitSourceDaily).where(srcWhere(from, to)).groupBy(revenueUnitSourceDaily.adSource).all();
  const prevSrc = new Map(bySource(range.prevFrom, range.prevTo).map((r) => [r.key, unitKpis(r)]));
  const unitTotal = kpisOf(daily);
  const f = fmt(currency);
  const sources = bySource(range.from, range.to)
    .map((r) => {
      const k = unitKpis(r);
      const p = prevSrc.get(r.key) ?? EMPTY_KPIS;
      return { key: r.key, label: r.key, ...k, prev: p, flags: sourceFlags(k, p, unitTotal, f.fmtPct, f.fmtMoney) };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const top = sources.slice(0, 5).map((x) => x.key);
  const srcDays = top.length
    ? db
        .select({ date: revenueUnitSourceDaily.date, source: revenueUnitSourceDaily.adSource, ...srcSums })
        .from(revenueUnitSourceDaily)
        .where(and(srcWhere(range.from, range.to), inArray(revenueUnitSourceDaily.adSource, top)))
        .groupBy(revenueUnitSourceDaily.date, revenueUnitSourceDaily.adSource)
        .all()
    : [];
  const sourceDaily = top.map((source) => {
    const m = new Map(srcDays.filter((x) => x.source === source).map((x) => [x.date, x]));
    return {
      source,
      points: dailyOf([], range.from, range.to).map((p) => {
        const d = m.get(p.date);
        return d ? { ...p, revenue: d.earnings / 1e6, adImpressions: d.imps, matched: d.matched, requests: d.requests, adClicks: d.clicks } : p;
      }),
    };
  });
  return { daily, countries, sources, sourceDaily };
}

const EMPTY_KPIS = kpisFromTotals({ spend: 0, installs: 0, revenue: 0, adImpressions: 0 });

// Chi tiết một camp: theo ngày và theo nước (doanh thu chia theo tỉ lệ chi phí như bảng Camp)
export function campaignDetail(appId: string | null, spec: AnalyticsRange, campaignId: string): CampaignDetail {
  const { currency, apps: scoped } = scope(appId);
  const range = resolveRange(spec, undefined, dataFromOf(scoped)); // “từ trước đến nay” = từ ngày đầu có dữ liệu
  const byStore = new Map(scoped.map((a) => [a.storeAppId, a.id]));
  const empty = { daily: dailyOf([], range.from, range.to), countries: [] };
  if (!byStore.size) return empty;
  const load = (from: string, to: string) => {
    const all = db
      .select()
      .from(spendDaily)
      .where(and(between(spendDaily.date, from, to), inArray(spendDaily.appId, [...byStore.keys()]), eq(spendDaily.currency, currency)))
      .all();
    const mine = all.filter((x) => x.campaignId === campaignId);
    const totals = new Map<string, number>();
    for (const x of all) {
      const k = `${x.date}|${byStore.get(x.appId)}|${x.country}`;
      totals.set(k, (totals.get(k) ?? 0) + x.costMicros);
    }
    const rev = new Map(loadDayRows(scoped, currency, from, to).map((r) => [`${r.date}|${r.appId}|${r.country}`, r]));
    return mine.map((x) => {
      const k = `${x.date}|${byStore.get(x.appId)}|${x.country}`;
      const share = (totals.get(k) ?? 0) > 0 ? x.costMicros / totals.get(k)! : 0;
      const r = rev.get(k);
      return {
        date: x.date,
        appId: byStore.get(x.appId)!,
        country: x.country,
        spend: x.costMicros / 1e6,
        installs: x.installs,
        revenue: (r?.revenue ?? 0) * share,
        adImpressions: (r?.adImpressions ?? 0) * share,
        matched: (r?.matched ?? 0) * share,
        requests: (r?.requests ?? 0) * share,
        adClicks: (r?.adClicks ?? 0) * share,
        adsImpressions: x.impressions,
        adsClicks: x.clicks,
      };
    });
  };
  const cur = load(range.from, range.to);
  if (!cur.length) return empty;
  const prev = load(range.prevFrom, range.prevTo);
  const group = (rows: typeof cur) => {
    const m = new Map<string, typeof cur>();
    for (const r of rows) m.set(r.country, [...(m.get(r.country) ?? []), r]);
    return m;
  };
  const prevBy = group(prev);
  const countries = [...group(cur)]
    .map(([c, list]) => ({ key: c, label: getCountry(c)?.name ?? c, ...kpisOf(list), prev: kpisOf(prevBy.get(c) ?? []) }))
    .sort((a, b) => b.spend - a.spend);
  return { daily: dailyOf(cur, range.from, range.to), countries };
}

export function breakdown(appId: string | null, spec: AnalyticsRange, dim: Dim, country: string | null): Breakdown {
  const { currency, apps: scoped } = scope(appId);
  const range = resolveRange(spec, undefined, dataFromOf(scoped)); // “từ trước đến nay” = từ ngày đầu có dữ liệu
  const pair = (cur: ({ key: string } & Kpis)[], prev: ({ key: string } & Kpis)[], label: (k: string) => string): BreakRow[] => {
    const prevBy = new Map(prev.map((p) => [p.key, p]));
    return cur.map((c) => ({ ...c, label: label(c.key), prev: prevBy.get(c.key) ?? EMPTY_KPIS }));
  };

  if (dim === 'format' || dim === 'source') {
    const field: RevKey = dim === 'format' ? 'format' : 'adSource';
    const cur = revenueBy(scoped, currency, range.from, range.to, field, country);
    const prev = revenueBy(scoped, currency, range.prevFrom, range.prevTo, field, country);
    return {
      dim,
      currency,
      rows: pair(cur, prev, (k) => (dim === 'format' ? (FORMAT_LABEL[k] ?? k) : k)),
      note: 'Chỉ có số AdMob (định dạng/nguồn không gắn với chi phí Google Ads).',
    };
  }

  if (dim === 'adUnit') {
    const cur = unitsBy(scoped, currency, range.from, range.to, country);
    const prev = new Map(unitsBy(scoped, currency, range.prevFrom, range.prevTo, country).map((r) => [r.key, unitKpis(r)]));
    const appName = new Map(scoped.map((a) => [a.admobAppId, a.name]));
    const f = fmt(currency);
    return {
      dim,
      currency,
      rows: cur
        .map((r) => {
          const k = unitKpis(r);
          const p = prev.get(r.key) ?? EMPTY_KPIS;
          return { key: r.key, label: r.name, ...k, prev: p, format: r.format, appName: scoped.length > 1 ? (appName.get(r.app) ?? null) : null, flags: unitFlags(k, p, f.fmtPct, f.fmtMoney) };
        })
        .sort((a, b) => b.revenue - a.revenue),
      note: cur.length
        ? 'Số AdMob theo ad unit, gộp mọi nguồn mediation. Cờ: fill < 50%, show rate < 40%, CTR > 8%, eCPM giảm > 30% hoặc hiển thị giảm > 50% so kỳ trước.'
        : 'Chưa có số theo ad unit — bấm Đồng bộ (bản trước chưa kéo báo cáo ad unit).',
    };
  }

  if (dim === 'app' || dim === 'country') {
    const filter = (rows: ReturnType<typeof loadDayRows>) => (country ? rows.filter((r) => r.country === country) : rows);
    const cur = filter(loadDayRows(scoped, currency, range.from, range.to));
    const prev = filter(loadDayRows(scoped, currency, range.prevFrom, range.prevTo));
    const field = dim === 'app' ? ('appId' as const) : ('country' as const);
    const group = (rows: typeof cur) => {
      const m = new Map<string, typeof cur>();
      for (const r of rows) m.set(r[field], [...(m.get(r[field]) ?? []), r]);
      return [...m].map(([key, list]) => ({ key, ...kpisOf(list) }));
    };
    const names = new Map(scoped.map((a) => [a.id, a.name]));
    return {
      dim,
      currency,
      rows: pair(group(cur), group(prev), (k) => (dim === 'app' ? (names.get(k) ?? k) : (getCountry(k)?.name ?? k))).sort((a, b) => b.spend - a.spend || b.revenue - a.revenue),
    };
  }

  // Camp
  const cur = campaignRows(scoped, currency, range.from, range.to, country);
  const prev = campaignRows(scoped, currency, range.prevFrom, range.prevTo, country);
  const meta = new Map(db.select().from(campaignMeta).all().map((m) => [m.campaignId, m]));
  const rows: BreakRow[] = [...cur].map(([id, c]) => {
    const m = meta.get(id);
    const mainCountry = [...c.countries].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const p = prev.get(id);
    return {
      key: id,
      label: m?.name ?? `Camp ${id}`,
      ...kpisFromTotals(c.t),
      prev: p ? kpisFromTotals(p.t) : EMPTY_KPIS,
      country: mainCountry,
      status: m?.status ?? null,
      budget: m?.budgetMicros != null ? m.budgetMicros / 1e6 : null,
      targetCpa: m?.targetCpaMicros != null ? m.targetCpaMicros / 1e6 : null,
      targetRoas: m?.targetRoas ?? null,
    };
  });
  return {
    dim,
    currency,
    rows: rows.sort((a, b) => b.spend - a.spend),
    note: 'Doanh thu QC của camp = doanh thu của (ngày, app, nước) chia theo tỉ lệ chi phí của camp — ước lượng, AdMob không biết người dùng đến từ camp nào.',
  };
}

// ── Đồng bộ ─────────────────────────────────────────────────────────────────
// Ads và AdMob đều có độ trễ: mỗi lần đồng bộ lấy lại cả kỳ (mặc định 3 ngày gần nhất).
export async function syncReports(days: number, ctx: JobContext) {
  const today = isoDate(new Date());
  const from = addDays(today, -(days - 1));
  const all = listApps();
  if (!all.length) throw new UserFacingError({ message: 'Chưa map app nào — vào Cài đặt → App để nối package ↔ AdMob ↔ Ads', action: 'openSettings', code: 'NO_APPS' });

  const prev = syncStatus();
  const now = () => new Date().toISOString();
  const status: SyncStatus = { at: now(), from, to: today, spend: prev.spend, revenue: prev.revenue };
  const customers = [...new Set(all.map((a) => a.adsCustomerId).filter((c): c is string => !!c))];
  const fallback = getPrefs().currentAdsCustomerId;
  if (!customers.length && fallback) customers.push(fallback);
  const total = customers.length + 1;
  let step = 0;

  const spendErrors: string[] = [];
  for (const cid of customers) {
    ctx.progress(step++, total);
    try {
      await syncSpend(cid, from, today);
      // Nhật ký thay đổi: không bắt buộc, lỗi thì bỏ qua
      await syncChanges(cid).catch((err) => log.warn(`[reports] change_event ${cid} lỗi`, err));
    } catch (err) {
      log.warn(`[reports] chi phí ${cid} lỗi`, err);
      spendErrors.push(`${cid}: ${(err as Error).message}`);
    }
  }
  status.spend = !customers.length
    ? { ok: false, at: prev.spend.at, error: 'App chưa gắn tài khoản Google Ads' }
    : spendErrors.length
      ? { ok: false, at: prev.spend.at, error: spendErrors.join(' · ') }
      : { ok: true, at: now() };

  ctx.progress(step++, total);
  const admobApps = all.filter((a) => a.admobAppId);
  if (!admobApps.length) status.revenue = { ok: false, at: prev.revenue.at, error: 'App chưa có AdMob app ID' };
  else {
    try {
      // Kéo doanh thu theo đúng tiền tệ tài khoản Ads của từng app
      const byCur = new Map<string, string[]>();
      for (const a of admobApps) byCur.set(currencyOf(a), [...(byCur.get(currencyOf(a)) ?? []), a.admobAppId!]);
      for (const [cur, ids] of byCur) await syncRevenue(ids, from, today, cur);
      status.revenue = { ok: true, at: now() };
    } catch (err) {
      log.warn('[reports] doanh thu AdMob lỗi', err);
      status.revenue = { ok: false, at: prev.revenue.at, error: (err as Error).message };
    }
  }
  ctx.progress(total, total);
  setJson('reportSync', status);
  broadcast({ type: 'reportSync', status });

  if (!status.spend.ok && !status.revenue.ok) {
    throw new UserFacingError({ message: `Đồng bộ lỗi — Google Ads: ${status.spend.error}; AdMob: ${status.revenue.error}`, action: 'retry', code: 'SYNC_FAILED' });
  }
  if (!status.spend.ok || !status.revenue.ok) {
    ctx.fail({ message: `Đồng bộ một phần — ${!status.spend.ok ? `Google Ads lỗi: ${status.spend.error}` : `AdMob lỗi: ${status.revenue.error}`}`, action: 'retry', code: 'PARTIAL' });
  }
  notifyAlerts();
}

// Thông báo OS (và Telegram nếu bật) khi có cảnh báo đỏ mới; nhấp → mở Analytics
function notifyAlerts() {
  const today = isoDate(new Date());
  const { currency, apps: scoped } = scope(null);
  const red = alertsFor(scoped, currency, today).filter((a) => a.level === 'danger');
  const key = red.map((a) => `${a.rule}|${a.appId}|${a.country}`).sort().join(',');
  if (!red.length || key === getJson<string>('lastAlertKey')) return;
  setJson('lastAlertKey', key);
  if (telegramConfig().events.red) sendTelegramQuiet(redAlertText(red));
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `${red.length} cảnh báo đỏ`, body: red.slice(0, 3).map((a) => `${a.country}: ${a.message}`).join('\n') });
  n.on('click', () => {
    BrowserWindow.getAllWindows()[0]?.show();
    broadcast({ type: 'navigate', to: '/analytics' });
  });
  n.show();
}

export function redAlertCount() {
  const { currency, apps: scoped } = scope(null);
  return scoped.length ? alertsFor(scoped, currency, isoDate(new Date())).filter((a) => a.level === 'danger').length : 0;
}

// Dữ liệu cũ quá 6 giờ → đồng bộ nền khi mở app (lần đầu kéo 30 ngày)
export function shouldAutoSync() {
  const s = syncStatus();
  if (!db.select({ id: apps.id }).from(apps).get()) return null;
  // Chưa đăng nhập Ads/AdMob thì đừng chạy để rồi báo lỗi
  if (!db.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.kind, ['ads', 'admob']), eq(accounts.status, 'active'))).get()) return null;
  if (!s.at) return 30;
  return Date.now() - Date.parse(s.at) > 6 * 3600_000 ? 3 : null;
}

// ── Xuất CSV / XLSX ─────────────────────────────────────────────────────────
const exported = new Set<string>();
export const wasExported = (p: string) => exported.has(p);

const DIM_LABEL: Record<Dim, string> = { country: 'Quốc gia', campaign: 'Camp', app: 'App', format: 'Định dạng QC', source: 'Nguồn QC', adUnit: 'Ad unit' };

export async function exportAnalytics(win: BrowserWindow | null, appId: string | null, spec: AnalyticsRange, format: 'csv' | 'xlsx', dim: Dim = 'country') {
  const a = getAnalytics(appId, spec);
  const appName = appId ? (listApps().find((x) => x.id === appId)?.name ?? 'app') : 'tat-ca-app';
  const suffix = format === 'csv' && dim !== 'country' ? `_${dim}` : '';
  const opts = {
    title: 'Xuất báo cáo ROAS',
    defaultPath: `roas_${appName.replace(/[^\w-]+/g, '-')}_${a.range.from}_${a.range.to}${suffix}.${format}`,
    filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Excel', extensions: ['xlsx'] }],
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  const c = a.currency;

  const header = ['Mã', 'Quốc gia', `Chi phí (${c})`, 'Cài đặt', `CPI (${c})`, `Doanh thu QC (${c})`, `Lợi nhuận (${c})`, 'ROAS', 'ROAS kỳ trước', `eCPM (${c})`, 'Show rate', 'CTR QC', 'CTR Ads', 'Tỉ lệ cài', 'Cảnh báo'];
  const pct = (v: number | null) => (v == null ? null : round(v, 4));
  const rows = a.countries.map((x) => [
    x.country,
    getCountry(x.country)?.name ?? x.country,
    round(x.spend),
    round(x.installs, 0),
    x.cpi == null ? null : round(x.cpi, 4),
    round(x.revenue),
    round(x.profit),
    pct(x.roas),
    pct(x.prevRoas),
    x.ecpm == null ? null : round(x.ecpm, 4),
    pct(x.showRate),
    pct(x.ctr),
    pct(x.adsCtr),
    pct(x.cvr),
    x.alerts.map((al) => al.message).join(' | '),
  ]);
  const bHeader = (d: Dim) => [DIM_LABEL[d], ...(d === 'campaign' ? ['ID', 'Trạng thái', 'Nước chính', `Ngân sách/ngày (${c})`] : d === 'adUnit' ? ['ID', 'Định dạng', 'Request', 'CTR QC', 'Cờ'] : []), `Chi phí (${c})`, 'Cài đặt', `CPI (${c})`, `Doanh thu QC (${c})`, `Lợi nhuận (${c})`, 'ROAS', 'ROAS kỳ trước', `eCPM (${c})`, 'Hiển thị QC', 'Fill rate', 'Show rate'];
  const bRows = (b: Breakdown) =>
    b.rows.map((r) => [
      r.label,
      ...(b.dim === 'campaign'
        ? [r.key, r.status ?? '', r.country ?? '', r.budget == null ? null : round(r.budget)]
        : b.dim === 'adUnit'
          ? [r.key, r.format ?? '', r.adRequests, pct(r.adCtr), (r.flags ?? []).map((x) => x.message).join(' | ')]
          : []),
      round(r.spend),
      round(r.installs, 0),
      r.cpi == null ? null : round(r.cpi, 4),
      round(r.revenue),
      round(r.profit),
      pct(r.roas),
      pct(r.prev.roas),
      r.ecpm == null ? null : round(r.ecpm, 4),
      round(r.adImpressions, 0),
      pct(r.fillRate),
      pct(r.showRate),
    ]);

  if (format === 'csv') {
    if (dim === 'country') fs.writeFileSync(res.filePath, toCsv(header, rows), 'utf8');
    else fs.writeFileSync(res.filePath, toCsv(bHeader(dim), bRows(breakdown(appId, spec, dim, null))), 'utf8');
  } else {
    const wb = new ExcelJS.Workbook();
    const pctCols = (ws: ExcelJS.Worksheet, head: string[]) =>
      head.forEach((h, i) => {
        if (/ROAS|rate|CTR|Tỉ lệ/.test(h)) ws.getColumn(i + 1).numFmt = '0.0%';
      });
    const ws = wb.addWorksheet('Quốc gia');
    ws.addRow(header).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((col, i) => (col.width = i === 1 ? 22 : i === header.length - 1 ? 60 : 14));
    pctCols(ws, header);
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const wd = wb.addWorksheet('Theo ngày');
    const dHead = ['Ngày', `Chi phí (${c})`, 'Cài đặt', `Doanh thu QC (${c})`, `Lợi nhuận (${c})`, 'ROAS', 'Hiển thị QC', 'Click Ads'];
    wd.addRow(dHead).font = { bold: true };
    for (const d of a.daily) wd.addRow([d.date, round(d.spend), round(d.installs, 0), round(d.revenue), round(d.revenue - d.spend), d.spend ? round(d.revenue / d.spend, 4) : null, d.adImpressions, d.adsClicks]);
    pctCols(wd, dHead);
    wd.columns.forEach((col) => (col.width = 14));

    for (const d of ['campaign', 'app', 'adUnit', 'format', 'source'] as const) {
      if (d === 'app' && appId) continue;
      const b = breakdown(appId, spec, d, null);
      if (!b.rows.length) continue;
      const head = bHeader(d);
      const sheet = wb.addWorksheet(DIM_LABEL[d]);
      sheet.addRow(head).font = { bold: true };
      bRows(b).forEach((r) => sheet.addRow(r));
      sheet.columns.forEach((col, i) => (col.width = i === 0 ? 40 : 14));
      pctCols(sheet, head);
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    // Ad unit × nguồn mediation
    const unitIds = admobIdsOf(scope(appId).apps);
    if (unitIds.length) {
      const names = new Map(
        db.select({ id: revenueUnitDaily.adUnitId, name: sql<string>`max(${revenueUnitDaily.adUnitName})` }).from(revenueUnitDaily).where(inArray(revenueUnitDaily.admobAppId, unitIds)).groupBy(revenueUnitDaily.adUnitId).all().map((x) => [x.id, x.name]),
      );
      const us = db
        .select({
          unit: revenueUnitSourceDaily.adUnitId,
          source: revenueUnitSourceDaily.adSource,
          earnings: sql<number>`sum(${revenueUnitSourceDaily.earningsMicros})`,
          imps: sql<number>`sum(${revenueUnitSourceDaily.impressions})`,
          matched: sql<number>`sum(${revenueUnitSourceDaily.matched})`,
          requests: sql<number>`sum(${revenueUnitSourceDaily.requests})`,
          clicks: sql<number>`sum(${revenueUnitSourceDaily.clicks})`,
        })
        .from(revenueUnitSourceDaily)
        .where(and(between(revenueUnitSourceDaily.date, a.range.from, a.range.to), inArray(revenueUnitSourceDaily.admobAppId, unitIds), eq(revenueUnitSourceDaily.currency, c)))
        .groupBy(revenueUnitSourceDaily.adUnitId, revenueUnitSourceDaily.adSource)
        .all();
      if (us.length) {
        const head = ['Ad unit', 'ID', 'Nguồn', `Doanh thu (${c})`, `eCPM (${c})`, 'Hiển thị', 'Request', 'Fill rate', 'Show rate', 'CTR QC'];
        const sheet = wb.addWorksheet('Ad unit × nguồn');
        sheet.addRow(head).font = { bold: true };
        us.sort((x, y) => (names.get(x.unit) ?? x.unit).localeCompare(names.get(y.unit) ?? y.unit) || y.earnings - x.earnings).forEach((r) => {
          const k = unitKpis(r);
          sheet.addRow([names.get(r.unit) ?? r.unit, r.unit, r.source, round(k.revenue), k.ecpm == null ? null : round(k.ecpm, 4), k.adImpressions, k.adRequests, pct(k.fillRate), pct(k.showRate), pct(k.adCtr)]);
        });
        sheet.columns.forEach((col, i) => (col.width = i === 0 || i === 2 ? 28 : 14));
        pctCols(sheet, head);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
      }
    }

    const wi = wb.addWorksheet('Ghi chú');
    wi.addRow(['ROAS cùng kỳ (blended) = doanh thu quảng cáo AdMob của mọi người dùng trong kỳ ÷ chi phí Google Ads trong kỳ.']);
    wi.addRow(['Không gồm doanh thu mua trong app (IAP); trộn người dùng organic và người dùng cũ.']);
    wi.addRow(['Doanh thu theo camp là ước lượng: chia doanh thu của (ngày, app, nước) theo tỉ lệ chi phí từng camp.']);
    wi.addRow([`Kỳ: ${a.range.from} → ${a.range.to} · Kỳ trước: ${a.range.prevFrom} → ${a.range.prevTo} · Đồng bộ lúc: ${syncStatus().at ?? 'chưa'}`]);
    await wb.xlsx.writeFile(res.filePath);
  }
  exported.add(res.filePath);
  return res.filePath;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ── Ngân sách tháng ─────────────────────────────────────────────────────────
type MonthlyBudgets = Record<string, number>;
export const monthlyBudgets = () => getJson<MonthlyBudgets>('monthlyBudgets') ?? {};
export function setMonthlyBudget(customerId: string, amount: number | null) {
  const all = monthlyBudgets();
  if (amount == null || amount <= 0) delete all[customerId];
  else all[customerId] = amount;
  setJson('monthlyBudgets', all);
}

export function pacing(customerId: string, today = isoDate(new Date())): Pacing & { currency: string } {
  const currency = db.select({ c: adsCustomers.currency }).from(adsCustomers).where(eq(adsCustomers.customerId, customerId)).get()?.c ?? 'USD';
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 8)}01`;
  const sum = (from: string, to: string) =>
    from > to
      ? 0
      : (db.select({ c: sql<number>`coalesce(sum(${spendDaily.costMicros}), 0)` }).from(spendDaily).where(and(eq(spendDaily.customerId, customerId), between(spendDaily.date, from, to))).get()?.c ?? 0) / 1e6;
  // Ngân sách dùng chung chỉ tính một lần
  const budgets = new Map(
    db
      .select({ r: campaignMeta.budgetResource, id: campaignMeta.campaignId, b: campaignMeta.budgetMicros })
      .from(campaignMeta)
      .where(and(eq(campaignMeta.customerId, customerId), eq(campaignMeta.status, 'ENABLED')))
      .all()
      .map((x) => [x.r ?? x.id, x.b ?? 0]),
  );
  const dailyBudgets = [...budgets.values()].reduce((a, x) => a + x, 0) / 1e6;
  return {
    ...pacingOf({ today, budget: monthlyBudgets()[customerId] ?? null, spent: sum(monthStart, yesterday), avg7: sum(addDays(today, -7), yesterday) / 7, dailyBudgets }),
    currency,
  };
}
