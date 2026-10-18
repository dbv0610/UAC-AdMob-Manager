import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, dialog, net, protocol, screen } from 'electron';
import log from 'electron-log/main';
import { closeDb, openDb } from './db';
import { applyPrefs, registerIpc } from './ipc';
import { recoverInterruptedJobs } from './jobs/queue';
import { buildMenu } from './menu';
import { hardenSession, hardenWindow } from './security';
import { getJson, getPrefs, setJson } from './services/settingsStore';
import { broadcast } from './events';
import { thumbPath } from './services/creatives/library';
import { resumeUploadsOnStart, stopUploader } from './services/youtube/uploads';
import { redAlertCount, shouldAutoSync } from './services/analytics';
import { enqueue } from './jobs/queue';
import { onEvent } from './events';
import { pendingCount } from './services/rules';
import { startScheduler, syncAndRunRules } from './scheduler';
import { createTray, setTrayCounts } from './tray';
import { setupLogRotation } from './diagnostics';
import { startUpdater } from './updater';
import { APP_NAME, STORAGE_NAME } from '@shared/brand';

// Phải chạy trước mọi thứ đọc userData/logs: giữ thư mục dữ liệu + khoá Keychain của tên cũ
// (đổi sang AppOps Studio mà không có dòng này sẽ mất database và token đăng nhập).
app.setName(STORAGE_NAME);

log.initialize();
setupLogRotation();
log.transports.file.maxSize = 5 * 1024 * 1024;
// Che token trước khi ghi log
log.hooks.push((msg) => {
  msg.data = msg.data.map((d) =>
    typeof d === 'string' ? d.replace(/(ya29\.|1\/\/)[\w.-]+/g, '$1***').replace(/("?(refresh_token|access_token|developer_token)"?\s*[:=]\s*"?)[^",\s]+/gi, '$1***') : d,
  );
  return msg;
});

// Cho E2E/test dùng thư mục dữ liệu riêng, không đụng app.db thật
if (process.env.UAC_USER_DATA) {
  fs.mkdirSync(process.env.UAC_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.UAC_USER_DATA);
}

let win: BrowserWindow | null = null;
let quitting = false;

// Icon cửa sổ/dock khi chạy dev; bản đóng gói dùng build/icon.icns|.ico qua electron-builder
const appIcon = () => (app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'resources', 'icon.png'));

// Thumbnail creative: uac-thumb://<uuid> → userData/thumbs/<uuid>.jpg (renderer không đọc được file:// tùy ý)
protocol.registerSchemesAsPrivileged([{ scheme: 'uac-thumb', privileges: { standard: true, secure: true } }]);
function registerThumbProtocol() {
  protocol.handle('uac-thumb', (req) => {
    const id = new URL(req.url).hostname;
    if (!/^[0-9a-f-]{36}$/.test(id) || !fs.existsSync(thumbPath(id))) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(thumbPath(id)).toString());
  });
}

interface WinState { x?: number; y?: number; width: number; height: number; maximized: boolean }

function restoreBounds(): WinState {
  const s = getJson<WinState>('windowState') ?? { width: 1360, height: 860, maximized: false };
  // Màn hình cũ đã rút: bỏ vị trí cũ
  const visible = s.x != null && screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return s.x! >= b.x && s.y! >= b.y && s.x! < b.x + b.width && s.y! < b.y + b.height;
  });
  return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
}

function createWindow() {
  const state = restoreBounds();
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: getPrefs().theme === 'dark' ? '#0f172a' : '#f5f7fc',
    ...(process.platform !== 'darwin' && fs.existsSync(appIcon()) ? { icon: appIcon() } : {}),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarOverlay: { color: '#eef1fa', symbolColor: '#4b5563', height: 40 } }),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  hardenWindow(win);
  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => {
    applyPrefs(win, getPrefs());
    // Khởi động cùng máy: chạy ngầm ở tray, không bật cửa sổ
    if (process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin) {
      if (process.platform === 'darwin') app.dock?.hide();
      return;
    }
    win?.show();
  });

  const save = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    setJson('windowState', { ...b, maximized: win.isMaximized() });
  };
  win.on('close', (e) => {
    save();
    // Đóng cửa sổ = chạy nền ở tray để lịch đồng bộ vẫn chạy (tắt trong Cài đặt → Tự động)
    if (!quitting && getPrefs().closeToTray) {
      e.preventDefault();
      win?.hide();
      if (process.platform === 'darwin') app.dock?.hide();
    }
  });
  win.on('closed', () => (win = null));

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
}

function showWindow() {
  if (process.platform === 'darwin') void app.dock?.show();
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Theo dõi online/offline để khóa các nút ghi lên Google khi mất mạng
function watchOnline() {
  let last = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now !== last) broadcast({ type: 'online', online: (last = now) });
  }, 5000);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => (quitting = true));

  app.whenReady().then(() => {
    openDb();
    recoverInterruptedJobs();
    hardenSession();
    if (process.platform === 'darwin' && !app.isPackaged && fs.existsSync(appIcon())) app.dock?.setIcon(appIcon());
    app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), copyright: '© BlueLeaf Apps', iconPath: appIcon() });
    registerThumbProtocol();
    registerIpc(() => win);
    buildMenu();
    createWindow();
    watchOnline();
    resumeUploadsOnStart();
    startScheduler();
    startUpdater();
    const tray = createTray(() => win, showWindow);
    const refreshCounts = () => setTrayCounts({ suggestions: pendingCount(), alerts: redAlertCount() }, tray.refresh);
    refreshCounts();
    onEvent((e) => (e.type === 'suggestions' || e.type === 'reportSync') && refreshCounts());
    // Báo cáo cũ quá 6 giờ: đồng bộ nền (lần đầu 30 ngày)
    setTimeout(() => {
      const days = net.isOnline() ? shouldAutoSync() : null;
      if (days) enqueue('syncReports', `Đồng bộ báo cáo ${days} ngày + chạy rule`, (ctx) => syncAndRunRules(days, ctx));
    }, 5_000);
    app.on('activate', () => showWindow());
  }).catch((err) => {
    log.error('[startup] lỗi khởi động', err);
    console.error(err);
    dialog.showErrorBox('Không khởi động được', String(err?.stack ?? err));
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => {
    stopUploader();
    closeDb();
  });
}
