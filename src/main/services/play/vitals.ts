import log from 'electron-log/main';
import type { playdeveloperreporting_v1beta1 } from '@googleapis/playdeveloperreporting';
import { toAppError } from '../../ipc/register';
import type { JobContext } from '../../jobs/queue';
import { getJson, setJson } from '../settingsStore';
import { escapeHtml, sendTelegramQuiet, telegramConfig } from '../notify/telegram';
import { listAccounts } from '../auth/accounts';
import { playApps, reportingClient, resolvePlayAccount, wrapPlayError } from './client';
import { listTracks, updateRelease } from './releases';
import { DEFAULT_VITALS_ALERTS, trackLabel, vitalsBreaches, type VitalsAlertPrefs, type VitalsBreach, type VitalsData, type VitalsDay, type VitalsVersion } from '@shared/playOps';

// Crash / ANR qua Play Developer Reporting API. Dữ liệu Play có độ trễ 1–2 ngày:
// đọc mốc mới nhất (freshness) rồi lấy 30 ngày theo ngày + 7 ngày theo version code.
// Cache trong settings, không cần bảng riêng.

type DateTime = playdeveloperreporting_v1beta1.Schema$GoogleTypeDateTime;
type Row = playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1MetricsRow;
type MetricSet = playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1CrashRateMetricSet;
type QueryBody = playdeveloperreporting_v1beta1.Schema$GooglePlayDeveloperReportingV1beta1QueryCrashRateMetricSetRequest;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: DateTime) => `${d.year}-${pad(d.month ?? 1)}-${pad(d.day ?? 1)}`;
const DAYS = 30;
const VERSION_DAYS = 7;

function minusDays(end: DateTime, n: number): DateTime {
  const t = new Date(Date.UTC(end.year!, end.month! - 1, end.day!) - n * 86400_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), timeZone: end.timeZone };
}

const metric = (r: Row, name: string) => {
  const v = r.metrics?.find((m) => m.metric === name)?.decimalValue?.value;
  return v == null ? null : Number(v);
};
const versionOf = (r: Row) => {
  const d = r.dimensions?.find((x) => x.dimension === 'versionCode');
  return d?.int64Value ?? d?.stringValue ?? null;
};

interface MetricApi {
  get: () => Promise<{ data: MetricSet }>;
  query: (body: QueryBody) => Promise<{ data: { rows?: Row[]; nextPageToken?: string | null } }>;
}

async function latestEnd(api: MetricApi) {
  return (await api.get()).data.freshnessInfo?.freshnesses?.find((f) => f.aggregationPeriod === 'DAILY')?.latestEndTime ?? null;
}

async function queryRows(api: MetricApi, end: DateTime, days: number, metrics: string[], dimensions?: string[]) {
  const rows: Row[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api.query({ timelineSpec: { aggregationPeriod: 'DAILY', startTime: minusDays(end, days), endTime: end }, metrics, dimensions, pageSize: 1000, pageToken });
    rows.push(...(res.data.rows ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return rows;
}

// Gộp các ngày của mỗi version code, trọng số theo người dùng
function byVersion(crash: Row[], anr: Row[]): VitalsVersion[] {
  const acc = new Map<string, { c: number; cw: number; a: number; aw: number; users: number; last: string }>();
  const get = (v: string) => acc.get(v) ?? acc.set(v, { c: 0, cw: 0, a: 0, aw: 0, users: 0, last: '' }).get(v)!;
  for (const r of crash) {
    const v = versionOf(r);
    const rate = metric(r, 'userPerceivedCrashRate');
    if (!v || rate == null) continue;
    const u = metric(r, 'distinctUsers') ?? 0;
    const x = get(v);
    x.c += rate * u;
    x.cw += u;
    x.users = Math.max(x.users, u);
    x.last = [x.last, ymd(r.startTime!)].sort().at(-1)!;
  }
  for (const r of anr) {
    const v = versionOf(r);
    const rate = metric(r, 'userPerceivedAnrRate');
    if (!v || rate == null) continue;
    const u = metric(r, 'distinctUsers') ?? 0;
    const x = get(v);
    x.a += rate * u;
    x.aw += u;
  }
  return [...acc.entries()]
    .map(([versionCode, x]) => ({ versionCode, userCrashRate: x.cw ? x.c / x.cw : null, userAnrRate: x.aw ? x.a / x.aw : null, users: x.users, lastDate: x.last }))
    .sort((a, b) => Number(b.versionCode) - Number(a.versionCode));
}

export async function syncVitals(accountId: string, packageName: string): Promise<VitalsData> {
  const api = reportingClient(accountId);
  const app = `apps/${packageName}`;
  const crashApi: MetricApi = {
    get: () => api.vitals.crashrate.get({ name: `${app}/crashRateMetricSet` }),
    query: (requestBody) => api.vitals.crashrate.query({ name: `${app}/crashRateMetricSet`, requestBody }),
  };
  const anrApi: MetricApi = {
    get: () => api.vitals.anrrate.get({ name: `${app}/anrRateMetricSet` }),
    query: (requestBody) => api.vitals.anrrate.query({ name: `${app}/anrRateMetricSet`, requestBody }),
  };
  try {
    const [crashEnd, anrEnd] = await Promise.all([latestEnd(crashApi), latestEnd(anrApi)]);
    const CRASH = ['crashRate', 'userPerceivedCrashRate', 'distinctUsers'];
    const ANR = ['anrRate', 'userPerceivedAnrRate', 'distinctUsers'];
    // App mới / đang thử nghiệm kín: Play chưa có mốc dữ liệu → trả rỗng, không phải lỗi
    const [crash, anr, crashV, anrV] = await Promise.all([
      crashEnd ? queryRows(crashApi, crashEnd, DAYS, CRASH) : [],
      anrEnd ? queryRows(anrApi, anrEnd, DAYS, ANR) : [],
      crashEnd ? queryRows(crashApi, crashEnd, VERSION_DAYS, ['userPerceivedCrashRate', 'distinctUsers'], ['versionCode']) : [],
      anrEnd ? queryRows(anrApi, anrEnd, VERSION_DAYS, ['userPerceivedAnrRate', 'distinctUsers'], ['versionCode']) : [],
    ]);
    const byDate = new Map<string, VitalsDay>();
    const day = (d: string) => byDate.get(d) ?? byDate.set(d, { date: d, crashRate: null, userCrashRate: null, anrRate: null, userAnrRate: null, users: null }).get(d)!;
    for (const r of crash) {
      const d = day(ymd(r.startTime!));
      d.crashRate = metric(r, 'crashRate');
      d.userCrashRate = metric(r, 'userPerceivedCrashRate');
      d.users = metric(r, 'distinctUsers');
    }
    for (const r of anr) {
      const d = day(ymd(r.startTime!));
      d.anrRate = metric(r, 'anrRate');
      d.userAnrRate = metric(r, 'userPerceivedAnrRate');
      d.users ??= metric(r, 'distinctUsers');
    }
    const data: VitalsData = {
      packageName,
      at: new Date().toISOString(),
      days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      versions: byVersion(crashV, anrV),
    };
    setJson(`playVitals:${packageName}`, data);
    return data;
  } catch (err) {
    throw wrapPlayError(accountId, packageName, err, 'vitals');
  }
}

export const vitalsCached = (packageName: string) => getJson<VitalsData>(`playVitals:${packageName}`);
export const vitalsAlertPrefs = () => ({ ...DEFAULT_VITALS_ALERTS, ...getJson<Partial<VitalsAlertPrefs>>('playVitalsAlerts') });
export const setVitalsAlertPrefs = (p: VitalsAlertPrefs) => (setJson('playVitalsAlerts', p), p);

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const METRIC = { crash: 'Crash', anr: 'ANR' } as const;
const breachLine = (b: VitalsBreach) =>
  `• ${METRIC[b.metric]} ${b.scope === 'version' ? `bản ${b.label}` : b.scope === 'day' ? `ngày ${b.label}` : 'trung bình 28 ngày'}: <b>${pct(b.value)}</b> (ngưỡng ${pct(b.limit)})`;

// Bản đang rollout dở có version code vượt ngưỡng → tạm dừng (chỉ khi người dùng bật autoHalt)
async function autoHalt(accountId: string, packageName: string, breaches: VitalsBreach[]) {
  const bad = new Set(breaches.filter((b) => b.scope === 'version').map((b) => b.label));
  if (!bad.size) return [];
  const halted: string[] = [];
  for (const t of await listTracks(accountId, packageName)) {
    for (const r of t.releases) {
      if (r.status !== 'inProgress' || !r.versionCodes.some((v) => bad.has(v))) continue;
      await updateRelease({ accountId, packageName, track: t.track, key: r.key, action: { kind: 'halt' } }, 'auto:vitals');
      halted.push(`${trackLabel(t.track)} · ${r.name || r.versionCodes.join(',')}`);
    }
  }
  return halted;
}

// Cảnh báo theo ngưỡng tự đặt; mỗi app báo tối đa 1 lần cho mỗi bộ vi phạm của một mốc dữ liệu.
export async function alertVitals(appName: string, accountId: string, data: VitalsData) {
  const prefs = vitalsAlertPrefs();
  const breaches = vitalsBreaches(data, prefs);
  const key = `playVitalsAlerted:${data.packageName}`;
  const mark = `${data.days.at(-1)?.date ?? ''}|${breaches.map((b) => `${b.scope}:${b.label}:${b.metric}`).join(',')}`;
  if (!breaches.length || getJson<string>(key) === mark) return { breaches, halted: [] as string[] };
  setJson(key, mark);
  let halted: string[] = [];
  if (prefs.autoHalt) {
    halted = await autoHalt(accountId, data.packageName, breaches).catch((err) => {
      log.warn('[vitals] tự tạm dừng rollout lỗi', err);
      return [`(không tạm dừng được: ${toAppError(err).message})`];
    });
  }
  if (telegramConfig().events.red) {
    sendTelegramQuiet(
      [
        `<b>🔴 Vitals vượt ngưỡng: ${escapeHtml(appName)}</b>`,
        `<i>${escapeHtml(data.packageName)}</i>`,
        ...breaches.map(breachLine),
        ...(halted.length ? [`⏸ Đã tự tạm dừng rollout: ${escapeHtml(halted.join('; '))}`] : []),
      ].join('\n'),
    );
  }
  return { breaches, halted };
}

// Chạy sau đồng bộ hằng ngày: mọi app Google Play đã map. Lỗi từng app chỉ ghi cảnh báo.
export async function syncAllVitals(ctx?: JobContext) {
  if (!listAccounts().some((a) => a.kind === 'play' && a.status === 'active')) return { synced: 0, warnings: [] as string[] };
  const apps = playApps();
  const warnings: string[] = [];
  let synced = 0;
  for (const [i, a] of apps.entries()) {
    ctx?.progress(i, apps.length);
    try {
      const acc = await resolvePlayAccount(a.storeAppId);
      await alertVitals(a.name, acc, await syncVitals(acc, a.storeAppId));
      synced++;
    } catch (err) {
      const msg = `${a.name}: ${toAppError(err).message}`;
      log.warn('[vitals]', msg);
      warnings.push(msg);
    }
  }
  ctx?.progress(apps.length, apps.length);
  return { synced, warnings };
}
