import type { DesktopApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export {};
