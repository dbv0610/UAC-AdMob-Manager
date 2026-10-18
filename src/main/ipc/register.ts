import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log/main';
import { ZodError } from 'zod';
import { channelName, type DesktopApi, type InvokeNamespaces } from '@shared/ipc-contract';
import type { AppError } from '@shared/types';
import { isTrustedUrl } from '../security';

export class UserFacingError extends Error {
  constructor(public readonly info: AppError) {
    super(info.message);
  }
}

export function assertTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (!url || !isTrustedUrl(url)) throw new Error(`IPC từ nguồn không tin cậy: ${url}`);
}

// Lỗi đi qua IPC chỉ giữ được message, nên đóng gói AppError thành JSON trong message.
export function toAppError(err: unknown): AppError {
  if (err instanceof UserFacingError) return err.info;
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return { message: issue.message, field: issue.path.join('.'), action: 'fix', code: 'VALIDATION' };
  }
  return { message: err instanceof Error ? err.message : String(err), action: 'retry' };
}

type Fn = (...args: never[]) => unknown;

export function handle<N extends InvokeNamespaces, M extends keyof DesktopApi[N] & string>(
  ns: N,
  method: M,
  fn: DesktopApi[N][M] extends Fn ? (...args: Parameters<DesktopApi[N][M]>) => ReturnType<DesktopApi[N][M]> | Awaited<ReturnType<DesktopApi[N][M]>> : never,
) {
  const channel = channelName(ns, method);
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    try {
      return await (fn as unknown as (...a: unknown[]) => unknown)(...args);
    } catch (err) {
      const info = toAppError(err);
      log.warn(`[ipc] ${channel} lỗi`, info);
      throw new Error(JSON.stringify(info));
    }
  });
}
