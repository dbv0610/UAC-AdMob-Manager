import { app, net, powerMonitor } from 'electron';
import log from 'electron-log/main';
import { enqueue, hasActiveJobs } from './jobs/queue';
import { getJson, getPrefs, setJson } from './services/settingsStore';
import { syncReports, shouldAutoSync } from './services/analytics';
import { runRules } from './services/rules';
import { afterDailySync } from './services/notify/digest';
import { syncAllVitals } from './services/play/vitals';
import { isoDate } from '@shared/analytics';
import type { JobContext } from './jobs/queue';

// Lịch hằng ngày: đồng bộ lại 3 ngày gần nhất (Ads/AdMob có độ trễ) rồi chạy rules.
// Máy ngủ qua giờ hẹn → chạy bù khi thức dậy / mở app.

let timer: NodeJS.Timeout | null = null;

export async function syncAndRunRules(days: number, ctx: JobContext) {
  try {
    await syncReports(days, ctx);
  } finally {
    // Đồng bộ lỗi một phần vẫn chạy rule trên dữ liệu đang có
    await runRules().catch((err) => log.warn('[rules] chạy sau đồng bộ lỗi', err));
    await afterDailySync();
    // Vitals Google Play (crash/ANR) + cảnh báo Telegram khi vượt ngưỡng xấu
    await syncAllVitals().catch((err) => log.warn('[vitals] đồng bộ hằng ngày lỗi', err));
  }
}

export function runDailyNow(reason: string) {
  if (!net.isOnline()) return null;
  setJson('lastDailyRun', isoDate(new Date()));
  log.info(`[scheduler] chạy đồng bộ hằng ngày (${reason})`);
  return enqueue('syncReports', 'Đồng bộ báo cáo + chạy rule', (ctx) => syncAndRunRules(3, ctx));
}

function nextRunMs(hour: number, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// Hôm nay đã qua giờ hẹn mà chưa chạy → chạy bù
function catchUp(reason: string) {
  const p = getPrefs();
  if (!p.autoSync || !shouldAutoSync()) return;
  const today = isoDate(new Date());
  if (getJson<string>('lastDailyRun') === today || new Date().getHours() < p.syncHour || hasActiveJobs()) return;
  runDailyNow(reason);
}

export function reschedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = getPrefs();
  if (!p.autoSync) return;
  timer = setTimeout(() => {
    if (shouldAutoSync()) runDailyNow('đúng giờ hẹn');
    reschedule();
  }, nextRunMs(p.syncHour));
}

export function startScheduler() {
  reschedule();
  setTimeout(() => catchUp('mở app'), 8_000);
  powerMonitor.on('resume', () => {
    reschedule(); // setTimeout lệch khi máy ngủ
    setTimeout(() => catchUp('máy thức dậy'), 15_000);
  });
  app.on('before-quit', () => timer && clearTimeout(timer));
}
