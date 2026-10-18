import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { CHANNELS, EVENT_CHANNEL, channelName } from '@shared/ipc-contract';
import type { AppEvent } from '@shared/types';

// Chỉ mở các kênh trong whitelist CHANNELS; renderer không chạm được ipcRenderer.
const api: Record<string, Record<string, unknown>> = {};
for (const [ns, methods] of Object.entries(CHANNELS)) {
  api[ns] = {};
  for (const m of methods) {
    api[ns][m] = (...args: unknown[]) => ipcRenderer.invoke(channelName(ns, m), ...args);
  }
}

api.events = {
  on: (cb: (e: AppEvent) => void) => {
    const h = (_: IpcRendererEvent, e: AppEvent) => cb(e);
    ipcRenderer.on(EVENT_CHANNEL, h);
    return () => ipcRenderer.off(EVENT_CHANNEL, h);
  },
};

// File kéo thả: sandbox không còn File.path, lấy đường dẫn qua webUtils
api.files = { pathFor: (file: File) => webUtils.getPathForFile(file) };

contextBridge.exposeInMainWorld('api', api);
