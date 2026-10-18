import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import { broadcast } from './events';
import { NAV_ROUTES } from '@shared/nav';
import { APP_NAME } from '@shared/brand';

// Menu chuẩn để copy/paste và phím tắt OS hoạt động. Phím tắt của app đi qua accelerator
// rồi gửi sang renderer, nên vẫn chạy khi focus đang ở trong ô nhập.
export function buildMenu() {
  const isMac = process.platform === 'darwin';
  const cmd = (name: 'sync' | 'newPlan' | 'toggleJobs' | 'palette') => () => broadcast({ type: 'command', name });

  const template: MenuItemConstructorOptions[] = [
    // Tự đặt nhãn: role appMenu dùng app.name (tên nội bộ cũ để giữ dữ liệu), không phải tên hiển thị
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' as const, label: `Giới thiệu ${APP_NAME}` },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `Ẩn ${APP_NAME}` },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `Thoát ${APP_NAME}` },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Kế hoạch camp mới', accelerator: 'CmdOrCtrl+N', click: cmd('newPlan') },
        { label: 'Đồng bộ màn hiện tại', accelerator: 'CmdOrCtrl+R', click: cmd('sync') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Bảng lệnh', accelerator: 'CmdOrCtrl+K', click: cmd('palette') },
        { label: 'Hàng đợi job', accelerator: 'CmdOrCtrl+J', click: cmd('toggleJobs') },
        { type: 'separator' },
        ...NAV_ROUTES.map(
          (r, i): MenuItemConstructorOptions => ({
            label: r.label,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: () => broadcast({ type: 'navigate', to: r.path }),
          }),
        ),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'reload' as const, accelerator: 'Shift+CmdOrCtrl+R' }, { role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: `Phiên bản ${app.getVersion()}`, enabled: false }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
