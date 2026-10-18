import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';
import electronUpdater from 'electron-updater';
import { broadcast } from './events';
import { hasActiveJobs } from './jobs/queue';
import { UserFacingError } from './ipc/register';

// Tự cập nhật qua GitHub Releases (electron-builder ghi app-update.yml khi có cấu hình publish).
// Kiểm tra khi mở app và mỗi 6 giờ, tải nền; chỉ cài khi người dùng bấm và không có job đang chạy.

const { autoUpdater } = electronUpdater;
let ready: string | null = null;

const configured = () => app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));

export function startUpdater() {
  if (!configured()) return;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version;
    broadcast({ type: 'update', version: info.version });
  });
  autoUpdater.on('error', (err) => log.warn('[updater] lỗi', err?.message ?? err));
  const check = () => void autoUpdater.checkForUpdates().catch((err) => log.warn('[updater] kiểm tra lỗi', err?.message ?? err));
  setTimeout(check, 30_000);
  setInterval(check, 6 * 3600_000);
}

export const updateReady = () => ready;

export function installUpdate() {
  if (!ready) throw new UserFacingError({ message: 'Chưa có bản cập nhật đã tải xong', code: 'NO_UPDATE' });
  if (hasActiveJobs()) {
    throw new UserFacingError({ message: 'Đang có job chạy (upload, tạo camp…) — đợi xong rồi khởi động lại để cập nhật', code: 'JOBS_RUNNING', action: 'retry' });
  }
  autoUpdater.quitAndInstall();
}
