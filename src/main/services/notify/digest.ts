import log from 'electron-log/main';
import { getJson, getSecret, setJson } from '../settingsStore';
import { getAnalytics, monthlyBudgets, pacing } from '../analytics';
import { listSuggestions } from '../rules';
import { aiSummary } from '../ai/summary';
import { escapeHtml as esc, sendTelegram, telegramConfig } from './telegram';
import { isoDate, type Alert } from '@shared/analytics';
import { APP_NAME } from '@shared/brand';

// Tin Telegram: bản tin mỗi sáng (sau lần đồng bộ đầu tiên trong ngày), AI tóm tắt tuần (thứ Hai), cảnh báo đỏ mới.

const money = (v: number, c: string) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: c, maximumFractionDigits: c === 'VND' ? 0 : 2 }).format(v);
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const arrow = (cur: number | null, prev: number | null) => (cur == null || prev == null || prev === 0 ? '' : cur >= prev ? ' ▲' : ' ▼');

export function dailyDigestText() {
  const y = getAnalytics(null, 'yesterday');
  const w = getAnalytics(null, 'last7');
  const c = y.currency;
  const red = w.alerts.filter((a) => a.level === 'danger');
  const pending = listSuggestions('pending').length;
  const lines = [
    `<b>📊 ${APP_NAME} — ${esc(y.range.to)}</b>`,
    '',
    `<b>Hôm qua</b>: chi ${money(y.kpis.spend, c)} · thu ${money(y.kpis.revenue, c)} · ROAS ${pct(y.kpis.roas)}${arrow(y.kpis.roas, y.prev.roas)}`,
    `Lời/lỗ ${money(y.kpis.profit, c)} · ${Math.round(y.kpis.installs)} cài · CPI ${y.kpis.cpi == null ? '—' : money(y.kpis.cpi, c)}`,
    `<b>7 ngày</b>: ROAS ${pct(w.kpis.roas)}${arrow(w.kpis.roas, w.prev.roas)} · lời/lỗ ${money(w.kpis.profit, c)}`,
  ];
  for (const [cid, budget] of Object.entries(monthlyBudgets())) {
    const p = pacing(cid);
    const icon = p.status === 'over' ? '🔴' : p.status === 'under' ? '🟡' : '🟢';
    lines.push(`${icon} Tháng này: đã chi ${money(p.spent, p.currency)}/${money(budget, p.currency)}, dự kiến ${money(p.projected, p.currency)}`);
  }
  if (red.length) {
    lines.push('', `<b>⚠️ ${red.length} cảnh báo đỏ</b>`);
    for (const a of red.slice(0, 6)) lines.push(`• ${esc(a.country)}: ${esc(a.message)}`);
  }
  if (pending) lines.push('', `📝 ${pending} đề xuất rule chờ duyệt — mở app → Rules`);
  return lines.join('\n');
}

// Gọi sau mỗi lần đồng bộ + chạy rule; tự giới hạn 1 bản tin/ngày và 1 tóm tắt AI/tuần
export async function afterDailySync() {
  const c = telegramConfig();
  if (!c.enabled || !c.chatId) return;
  const today = isoDate(new Date());
  try {
    if (c.events.digest && getJson<string>('tgLastDigest') !== today) {
      if (await sendTelegram(dailyDigestText())) setJson('tgLastDigest', today);
    }
    if (c.events.weekly && new Date().getDay() === 1 && getSecret('anthropicApiKey') && getJson<string>('tgLastWeekly') !== today) {
      const s = await aiSummary(null, 'last7', true);
      if (await sendTelegram(`<b>🤖 Tóm tắt AI 7 ngày (${esc(s.from)} → ${esc(s.to)})</b>\n\n${esc(s.text)}`)) setJson('tgLastWeekly', today);
    }
  } catch (err) {
    log.warn('[telegram] bản tin lỗi', (err as Error).message);
  }
}

export function redAlertText(red: Alert[]) {
  return [`<b>🔴 ${red.length} cảnh báo đỏ mới</b>`, ...red.slice(0, 8).map((a) => `• ${esc(a.country)}: ${esc(a.message)}`)].join('\n');
}
