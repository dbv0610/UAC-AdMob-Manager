import path from 'node:path';
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron';
import { broadcast } from './events';
import { getPrefs, setPrefs } from './services/settingsStore';
import { runDailyNow, reschedule } from './scheduler';
import { APP_NAME } from '@shared/brand';

// Icon ở thanh menu (macOS) / khay hệ thống (Windows): app chạy nền để đồng bộ theo lịch.

let tray: Tray | null = null;
let counts = { suggestions: 0, alerts: 0 };

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'));

export function createTray(getWin: () => BrowserWindow | null, showWin: () => void) {
  const img = nativeImage.createFromPath(path.join(resourcesDir(), 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => (process.platform === 'darwin' ? tray?.popUpContextMenu() : showWin()));
  const open = (to?: string) => {
    showWin();
    if (to) broadcast({ type: 'navigate', to });
  };
  const build = () => {
    const p = getPrefs();
    const login = app.getLoginItemSettings().openAtLogin;
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Mở ${APP_NAME}`, click: () => open() },
        { label: 'Đồng bộ báo cáo + chạy rule ngay', click: () => runDailyNow('bấm từ tray') },
        { type: 'separator' },
        { label: counts.suggestions ? `${counts.suggestions} đề xuất chờ duyệt…` : 'Không có đề xuất chờ duyệt', enabled: counts.suggestions > 0, click: () => open('/rules') },
        { label: counts.alerts ? `${counts.alerts} cảnh báo đỏ…` : 'Không có cảnh báo đỏ', enabled: counts.alerts > 0, click: () => open('/analytics') },
        { type: 'separator' },
        {
          label: `Tự đồng bộ lúc ${p.syncHour}:00 mỗi ngày`,
          type: 'checkbox',
          checked: p.autoSync,
          click: (item) => {
            setPrefs({ autoSync: item.checked });
            reschedule();
            build();
          },
        },
        {
          label: 'Khởi động cùng máy',
          type: 'checkbox',
          checked: login,
          enabled: app.isPackaged, // bản dev sẽ đăng ký nhầm binary Electron gốc
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); // mở cùng máy thì chỉ chạy ở tray
            build();
          },
        },
        { type: 'separator' },
        { label: 'Thoát', role: 'quit' },
      ]),
    );
    // Số đếm hiện cạnh icon (macOS) và trên dock
    const total = counts.suggestions + counts.alerts;
    if (process.platform === 'darwin') tray?.setTitle(total ? String(total) : '');
    app.setBadgeCount(total);
  };
  build();
  void getWin;
  return { refresh: build };
}

export function setTrayCounts(next: Partial<typeof counts>, refresh?: () => void) {
  counts = { ...counts, ...next };
  refresh?.();
}
