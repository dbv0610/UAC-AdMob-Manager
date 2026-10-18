import { BrowserWindow } from 'electron';
import { EVENT_CHANNEL } from '@shared/ipc-contract';
import type { AppEvent } from '@shared/types';

// Bộ nghe trong main (tray cập nhật số đếm) — không qua IPC
const local = new Set<(e: AppEvent) => void>();
export const onEvent = (fn: (e: AppEvent) => void) => {
  local.add(fn);
  return () => local.delete(fn);
};

export function broadcast(e: AppEvent) {
  for (const fn of local) fn(e);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, e);
  }
}
