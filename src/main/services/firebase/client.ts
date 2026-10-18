import { UserFacingError } from '../../ipc/register';
import { authClientFor, getAccount, isInvalidGrant, reauthError } from '../auth/accounts';
import { apiDisabledError, withRetry } from '../googleAds/client';

// Firebase Remote Config + Management qua REST (không có gói @googleapis riêng): OAuth2Client.request tự gắn access token.

export const RC_BASE = 'https://firebaseremoteconfig.googleapis.com/v1';
export const FB_BASE = 'https://firebase.googleapis.com/v1beta1';

interface RcFailure {
  status?: number;
  message?: string;
  response?: { status?: number; data?: { error?: { message?: string; status?: string } } };
}

export function wrapRcError(accountId: string, projectId: string | null, err: unknown): Error {
  if (err instanceof UserFacingError) return err;
  if (isInvalidGrant(err)) return reauthError(accountId);
  const disabled = apiDisabledError(err);
  if (disabled) return disabled;
  const e = err as RcFailure;
  const status = Number(e.response?.status ?? e.status);
  const msg = e.response?.data?.error?.message ?? e.message ?? String(err);
  const code = e.response?.data?.error?.status;
  // ETag không khớp: có người vừa publish trên Console / máy khác
  if (status === 409 || status === 412 || /etag|version mismatch|ABORTED/i.test(`${code} ${msg}`)) {
    return new UserFacingError({ message: `Template${projectId ? ` của ${projectId}` : ''} vừa được sửa ở nơi khác — tải lại để xem bản mới nhất rồi làm lại`, code: 'RC_CONFLICT', action: 'retry' });
  }
  if (status === 403) {
    return new UserFacingError({
      message: `${getAccount(accountId).email} không có quyền với Remote Config${projectId ? ` của ${projectId}` : ''}. Firebase Console → Project settings → Users and permissions: cần vai trò Editor / Owner hoặc Remote Config Admin`,
      code: 'PERMISSION_DENIED',
      action: 'fix',
      accountId,
    });
  }
  if (status === 404) return new UserFacingError({ message: `Không tìm thấy project Firebase ${projectId ?? ''}`, code: 'NOT_FOUND', action: 'fix' });
  if (status === 400) return new UserFacingError({ message: `Firebase từ chối template: ${msg}`, code: code ?? 'INVALID_ARGUMENT', action: 'fix' });
  return new UserFacingError({ message: `Firebase: ${msg}`, code, action: [429, 500, 503, 504].includes(status) ? 'retry' : 'fix' });
}

export interface FbResponse<T> {
  data: T;
  etag: string | null;
}

// Gọi REST; trả kèm ETag (Remote Config dùng ETag để chống ghi đè)
export async function fbRequest<T>(accountId: string, opts: { url: string; method?: 'GET' | 'PUT' | 'POST'; data?: unknown; headers?: Record<string, string> }): Promise<FbResponse<T>> {
  if (getAccount(accountId).kind !== 'firebase') {
    throw new UserFacingError({ message: 'Tài khoản đã chọn không phải tài khoản Firebase', code: 'BAD_ACCOUNT', action: 'fix' });
  }
  const client = authClientFor(accountId);
  const res = await withRetry(() =>
    client.request<T>({
      url: opts.url,
      method: opts.method ?? 'GET',
      data: opts.data,
      headers: { 'Content-Type': 'application/json; UTF-8', ...opts.headers },
    }),
  );
  const h = res.headers as unknown as { get?: (k: string) => string | null; etag?: string };
  const etag = typeof h?.get === 'function' ? h.get('etag') : (h?.etag ?? null);
  return { data: res.data, etag };
}
