import { net } from 'electron';
import { eq } from 'drizzle-orm';
import { GoogleAdsApi, type Customer } from 'google-ads-api';
import { db } from '../../db';
import { adsCustomers } from '../../db/schema';
import { getDeveloperToken, getOAuthClient, secretsStatus } from '../auth/clientConfig';
import { isInvalidGrant, loadRefreshToken, reauthError } from '../auth/accounts';
import { UserFacingError } from '../../ipc/register';

let cached: { key: string; api: GoogleAdsApi } | null = null;

export function adsApi() {
  const { clientId, clientSecret } = getOAuthClient();
  const developerToken = getDeveloperToken();
  const key = `${clientId}|${developerToken}`;
  if (cached?.key !== key) {
    cached = { key, api: new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken }) };
  }
  return cached.api;
}

export function customerFor(accountId: string, customerId: string, loginCustomerId?: string | null): Customer {
  return adsApi().Customer({
    customer_id: customerId,
    login_customer_id: loginCustomerId ?? undefined,
    refresh_token: loadRefreshToken(accountId),
  });
}

interface AdsFailure {
  errors?: { message?: string; error_code?: Record<string, unknown>; location?: { field_path_elements?: { field_name?: string; index?: number }[] } }[];
  request_id?: string;
}

// error_code là oneof: thư viện có thể trả kèm các nhánh rỗng (undefined / 0 / UNSPECIFIED) trước nhánh thật,
// nên không lấy phần tử đầu mà lấy nhánh đầu tiên có giá trị.
export function adsErrorCode(ec?: Record<string, unknown>) {
  const hit = Object.entries(ec ?? {}).find(([, v]) => v != null && v !== 0 && v !== '' && !/^(UNSPECIFIED|UNKNOWN)$/.test(String(v)));
  return hit ? `${hit[0]}.${String(hit[1])}` : undefined;
}

// Chuẩn hóa lỗi Google Ads thành AppError có hành động gợi ý.
// "Google Ads API has not been used in project N before or it is disabled" → hướng dẫn bật API
export function apiDisabledError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err);
  const m = msg.match(/(Google Ads API|AdMob API|YouTube Data API v3|Google Play Android Developer API|Google Play Developer Reporting API|Firebase Remote Config API|Firebase Management API)[^.]*has not been used in project (\d+)/i);
  if (!m && !/SERVICE_DISABLED/.test(msg)) return null;
  const api = m?.[1] ?? 'API';
  return new UserFacingError({
    message: `${api} chưa được bật trong project Google Cloud${m ? ` ${m[2]}` : ''}. Vào Google Cloud → APIs & Services → Library, tìm "${api}", bấm Enable, đợi 2–5 phút rồi thử lại.`,
    code: 'API_DISABLED',
    action: 'openSettings',
  });
}

// Mức truy cập theo Cloud project chứa OAuth client: project mới bật API ở mức Test, chỉ gọi được tài khoản test
export function testAccessMessage() {
  const n = secretsStatus().projectNumber;
  return `Google Cloud project${n ? ` ${n}` : ''} (chứa OAuth client) đang ở mức Test của Google Ads API — chỉ dùng được tài khoản test. Vào Cloud Console → Google Ads API → Overview → Upgrade access level → xin Explorer (thường duyệt tự động).`;
}

export function wrapAdsError(accountId: string, err: unknown): Error {
  if (isInvalidGrant(err)) return reauthError(accountId);
  const disabled = apiDisabledError(err);
  if (disabled) return disabled;
  const f = err as AdsFailure;
  const first = f?.errors?.[0];
  if (first) {
    const field = first.location?.field_path_elements
      ?.map((p) => (p.index != null ? `${p.field_name}[${p.index}]` : p.field_name))
      .join('.');
    const codeStr = adsErrorCode(first.error_code);
    const transient = /RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED|quota/i.test(codeStr ?? '');
    const devToken = /DEVELOPER_TOKEN|CLOUD_PROJECT_NOT_APPROVED/i.test(codeStr ?? '');
    const testLevel = /CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION/.test(codeStr ?? '') || /only approved for use with test accounts/i.test(first.message ?? '');
    return new UserFacingError({
      message: testLevel ? testAccessMessage() : first.message ?? 'Google Ads báo lỗi',
      code: codeStr,
      field,
      requestId: f.request_id,
      action: devToken ? 'openSettings' : transient ? 'retry' : 'fix',
    });
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Customer đã đọc ở bước danh mục: biết account đăng nhập và MCC dùng làm login-customer-id.
export function customerById(customerId: string) {
  const row = db.select().from(adsCustomers).where(eq(adsCustomers.customerId, customerId)).get();
  if (!row) {
    throw new UserFacingError({
      message: `Chưa có customer ${customerId} trong danh mục — hãy đồng bộ lại tài khoản Google Ads`,
      code: 'CUSTOMER_UNKNOWN',
      action: 'openSettings',
    });
  }
  return { row, customer: customerFor(row.accountId, row.customerId, row.loginCustomerId) };
}

export function assertOnline() {
  if (!net.isOnline()) {
    throw new UserFacingError({ message: 'Đang mất mạng — thao tác ghi lên Google bị khóa', code: 'OFFLINE', action: 'retry' });
  }
}

export interface FailureItem {
  message: string;
  code?: string;
  path: { field_name?: string; index?: number }[];
}

// Lấy đủ mọi lỗi trong GoogleAdsFailure (wrapAdsError chỉ lấy lỗi đầu cho toast).
export function failureOf(err: unknown): { items: FailureItem[]; requestId?: string } | null {
  const f = err as AdsFailure;
  if (!Array.isArray(f?.errors) || f.errors.length === 0) return null;
  return {
    requestId: f.request_id,
    items: f.errors.map((e) => {
      return {
        message: e.message ?? 'Google Ads báo lỗi',
        code: adsErrorCode(e.error_code),
        path: e.location?.field_path_elements ?? [],
      };
    }),
  };
}

// Lỗi tạm thời đáng retry: quota, lỗi nội bộ, quá hạn (gRPC 4/8/13/14 hoặc mã trong failure)
export function isTransient(err: unknown): boolean {
  const f = failureOf(err);
  if (f) return f.items.some((i) => /quota_error|internal_error|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|TRANSIENT/i.test(i.code ?? ''));
  const e = err as { code?: number | string; status?: number; message?: string };
  if ([4, 8, 13, 14].includes(Number(e?.code)) || [429, 500, 503, 504].includes(Number(e?.status))) return true;
  return /ECONNRESET|ETIMEDOUT|socket hang up|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED/i.test(e?.message ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Backoff 2s → 4s → 8s → 16s, tối đa 4 lần retry; lỗi dữ liệu thì ném ngay.
export async function withRetry<T>(fn: () => Promise<T>, onRetry?: (attempt: number, waitMs: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4 || !isTransient(err)) throw err;
      const wait = 2000 * 2 ** attempt;
      onRetry?.(attempt + 1, wait);
      await sleep(wait);
    }
  }
}
