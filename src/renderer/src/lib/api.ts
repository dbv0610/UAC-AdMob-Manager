import type { AppError } from '@shared/types';

export const api = window.api;

// Main gói AppError thành JSON trong message; Electron thêm tiền tố "Error invoking remote method …: Error: ".
export function parseError(err: unknown): AppError {
  const msg = err instanceof Error ? err.message : String(err);
  const json = msg.slice(msg.indexOf('{'));
  try {
    return JSON.parse(json) as AppError;
  } catch {
    return { message: msg, action: 'retry' };
  }
}
