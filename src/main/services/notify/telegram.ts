import log from 'electron-log/main';
import { deleteSecret, getJson, getSecret, setJson, setSecret } from '../settingsStore';
import { UserFacingError } from '../../ipc/register';
import type { TelegramConfig, TelegramStatus } from '@shared/types';

// Gửi thông báo qua bot Telegram của chính người dùng. Token mã hóa bằng safeStorage, chỉ dùng trong main,
// không bao giờ ghi vào log (URL gọi API chứa token nên lỗi mạng được viết lại trước khi ném ra).

const SECRET = 'telegramBotToken';
const DEFAULT: TelegramConfig = { chatId: null, chatName: null, botName: null, enabled: false, events: { red: true, digest: true, weekly: true } };
export const telegramConfig = (): TelegramConfig => ({ ...DEFAULT, ...(getJson<Partial<TelegramConfig>>('telegram') ?? {}), events: { ...DEFAULT.events, ...(getJson<Partial<TelegramConfig>>('telegram')?.events ?? {}) } });
const saveConfig = (c: TelegramConfig) => setJson('telegram', c);

export const TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{30,}$/;

async function call<T>(method: string, body: Record<string, unknown> = {}, token = getSecret(SECRET)): Promise<T> {
  if (!token) throw new UserFacingError({ message: 'Chưa nhập token bot Telegram — vào Cài đặt → Thông báo', action: 'openSettings', code: 'NO_TG_TOKEN' });
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new UserFacingError({ message: 'Không kết nối được Telegram — kiểm tra mạng', action: 'retry', code: 'TG_NETWORK' });
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!j.ok) {
    if (res.status === 401 || res.status === 404) throw new UserFacingError({ message: 'Token bot Telegram không đúng — tạo lại ở @BotFather', action: 'openSettings', code: 'TG_401' });
    if (res.status === 403) throw new UserFacingError({ message: 'Bot chưa được phép nhắn cho bạn — mở chat với bot và bấm Start', action: 'openSettings', code: 'TG_403' });
    throw new UserFacingError({ message: `Telegram: ${j.description ?? `HTTP ${res.status}`}`, action: 'retry', code: `TG_${res.status}` });
  }
  return j.result as T;
}

export function telegramStatus(): TelegramStatus {
  return { ...telegramConfig(), hasToken: !!getSecret(SECRET) };
}

export async function setTelegramToken(token: string | null) {
  if (!token) {
    deleteSecret(SECRET);
    saveConfig({ ...DEFAULT });
    return telegramStatus();
  }
  if (!TOKEN_RE.test(token.trim())) throw new UserFacingError({ message: 'Token không đúng dạng 123456789:ABC… (lấy từ @BotFather)', code: 'TG_FORMAT' });
  const me = await call<{ username?: string }>('getMe', {}, token.trim());
  setSecret(SECRET, token.trim());
  saveConfig({ ...telegramConfig(), botName: me.username ?? null, chatId: null, chatName: null });
  return telegramStatus();
}

// Người dùng nhắn bất kỳ cho bot → lấy chat id từ tin nhắn gần nhất
export async function detectTelegramChat() {
  const updates = await call<{ message?: { chat: { id: number; first_name?: string; username?: string; title?: string } } }[]>('getUpdates', { limit: 20 });
  const chat = [...updates].reverse().find((u) => u.message)?.message?.chat;
  if (!chat) throw new UserFacingError({ message: 'Chưa thấy tin nhắn nào — mở chat với bot, bấm Start hoặc gửi một tin rồi thử lại', code: 'TG_NO_CHAT' });
  saveConfig({ ...telegramConfig(), chatId: String(chat.id), chatName: chat.title ?? chat.username ?? chat.first_name ?? String(chat.id), enabled: true });
  return telegramStatus();
}

export function setTelegramConfig(patch: Pick<TelegramConfig, 'enabled' | 'events'>) {
  saveConfig({ ...telegramConfig(), enabled: patch.enabled, events: patch.events });
  return telegramStatus();
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendTelegram(html: string, opts: { force?: boolean } = {}) {
  const c = telegramConfig();
  if (!c.chatId || (!c.enabled && !opts.force)) return false;
  // Telegram giới hạn 4096 ký tự / tin
  await call('sendMessage', { chat_id: c.chatId, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
  return true;
}

// Gửi nền: lỗi chỉ ghi log (đã bỏ token), không làm hỏng việc đang chạy
export function sendTelegramQuiet(html: string) {
  void sendTelegram(html).catch((err) => log.warn('[telegram] gửi lỗi', (err as Error).message));
}
