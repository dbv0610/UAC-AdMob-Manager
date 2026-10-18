import { app, shell, session, type BrowserWindow } from 'electron';

// Domain được phép mở ra trình duyệt hệ thống.
const EXTERNAL_ALLOW = [
  'ads.google.com',
  'admob.google.com',
  'youtube.com',
  'www.youtube.com',
  'studio.youtube.com',
  'console.cloud.google.com',
  'developers.google.com',
  'support.google.com',
  'accounts.google.com',
  'play.google.com',
  'console.firebase.google.com',
  'firebase.google.com',
  'apps.apple.com',
  'console.anthropic.com',
  't.me', // mở @BotFather khi cài thông báo Telegram
];

export function isTrustedUrl(url: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl && url.startsWith(devUrl)) return true;
  return url.startsWith('file://');
}

export function isAllowedExternal(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && EXTERNAL_ALLOW.includes(u.hostname);
  } catch {
    return false;
  }
}

export async function openExternalSafe(url: string) {
  if (!isAllowedExternal(url)) throw new Error(`Không mở link ngoài whitelist: ${url}`);
  await shell.openExternal(url);
}

export function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isTrustedUrl(url)) return;
    e.preventDefault();
    if (isAllowedExternal(url)) void shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

export function hardenSession() {
  // Renderer không cần quyền gì (camera, mic, thông báo web…); thông báo dùng Notification của main.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}
