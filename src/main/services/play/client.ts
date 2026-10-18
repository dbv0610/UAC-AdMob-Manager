import log from 'electron-log/main';
import { androidpublisher, type androidpublisher_v3 } from '@googleapis/androidpublisher';
import { playdeveloperreporting, type playdeveloperreporting_v1beta1 } from '@googleapis/playdeveloperreporting';
import { UserFacingError } from '../../ipc/register';
import { authClientFor, getAccount, isInvalidGrant, listAccounts, reauthError, SCOPES } from '../auth/accounts';
import { apiDisabledError, withRetry } from '../googleAds/client';
import { getJson, setJson } from '../settingsStore';
import { listApps } from '../appsStore';

// Kết nối Google Play dùng chung: Android Publisher (listing, release, review) + Reporting API (vitals).

export type PublisherApi = androidpublisher_v3.Androidpublisher;
export type ReportingApi = playdeveloperreporting_v1beta1.Playdeveloperreporting;

const REPORTING_SCOPE = SCOPES.play.find((s) => s.endsWith('playdeveloperreporting'))!;

function assertPlay(accountId: string) {
  const acc = getAccount(accountId);
  if (acc.kind !== 'play') {
    throw new UserFacingError({ message: 'Tài khoản đã chọn không phải tài khoản Google Play', code: 'BAD_ACCOUNT', action: 'fix' });
  }
  return acc;
}

export function playClient(accountId: string): PublisherApi {
  assertPlay(accountId);
  return androidpublisher({ version: 'v3', auth: authClientFor(accountId) as never });
}

export function reportingClient(accountId: string): ReportingApi {
  const acc = assertPlay(accountId);
  // Tài khoản đăng nhập trước khi có Vitals chưa cấp scope này: đăng nhập lại để Google hỏi thêm quyền
  if (!acc.scopes.split(' ').includes(REPORTING_SCOPE)) {
    throw new UserFacingError({ message: `${acc.email} cần đăng nhập lại để cấp quyền xem chỉ số Vitals`, action: 'reauth', accountId, code: 'SCOPE_MISSING' });
  }
  return playdeveloperreporting({ version: 'v1beta1', auth: authClientFor(accountId) as never });
}

interface PlayFailure {
  status?: number;
  message?: string;
  response?: { status?: number; data?: { error?: { message?: string; status?: string } } };
}

const PERMISSION_HINT = {
  listing: '“Quản lý sự hiện diện trên cửa hàng”',
  release: '“Phát hành ứng dụng lên kênh thử nghiệm/chính thức”',
  reviews: '“Trả lời bài đánh giá”',
  vitals: '“Xem thông tin ứng dụng”',
} as const;
export type PlayPermission = keyof typeof PERMISSION_HINT;

export function wrapPlayError(accountId: string, packageName: string, err: unknown, need: PlayPermission = 'listing'): Error {
  if (err instanceof UserFacingError) return err;
  if (isInvalidGrant(err)) return reauthError(accountId);
  const disabled = apiDisabledError(err);
  if (disabled) return disabled;
  const e = err as PlayFailure;
  const status = Number(e.response?.status ?? e.status);
  const msg = e.response?.data?.error?.message ?? e.message ?? String(err);
  const code = e.response?.data?.error?.status;
  if (/changesNotSentForReview/i.test(msg)) {
    return new UserFacingError({
      message: 'Play không cho tự gửi duyệt thay đổi này (app có bản bị từ chối hoặc đang bật Xuất bản có quản lý). Bỏ chọn “Gửi duyệt ngay” rồi đẩy lại, sau đó gửi duyệt trong Play Console → Tổng quan về việc xuất bản.',
      code: 'NOT_SENT_FOR_REVIEW',
      action: 'fix',
    });
  }
  if (/edit.*(deleted|expired|superseded|no longer valid)/i.test(msg)) {
    return new UserFacingError({ message: 'Phiên sửa bị Play hủy (có người sửa trên Play Console cùng lúc hoặc quá hạn) — tải lại rồi thử lại', code, action: 'retry' });
  }
  if (status === 404 || /package not found/i.test(msg)) {
    return new UserFacingError({
      message: `Play không tìm thấy ${packageName}: sai package name, app chưa được tạo trên Play Console, hoặc chưa upload APK/AAB đầu tiên`,
      code: 'PACKAGE_NOT_FOUND',
      action: 'fix',
    });
  }
  if (status === 403) {
    return new UserFacingError({
      message: `${getAccount(accountId).email} không có quyền với ${packageName}. Vào Play Console → Người dùng và quyền, cấp quyền ${PERMISSION_HINT[need]} cho email này`,
      code: 'PERMISSION_DENIED',
      action: 'fix',
      accountId,
    });
  }
  return new UserFacingError({ message: `Google Play: ${msg}`, code, action: [429, 500, 503, 504].includes(status) ? 'retry' : 'fix' });
}

// Mở edit, chạy fn, rồi xóa edit nếu chưa commit (edit treo sẽ chặn lần sửa sau trên Console).
export async function withEdit<T>(
  accountId: string,
  packageName: string,
  fn: (api: PublisherApi, editId: string, commit: () => void) => Promise<T>,
  need: PlayPermission = 'listing',
) {
  const api = playClient(accountId);
  let editId: string | null = null;
  let committed = false;
  try {
    editId = (await withRetry(() => api.edits.insert({ packageName }))).data.id!;
    return await fn(api, editId, () => (committed = true));
  } catch (err) {
    throw wrapPlayError(accountId, packageName, err, need);
  } finally {
    if (editId && !committed) await api.edits.delete({ packageName, editId }).catch((e) => log.warn('[play] không xóa được edit', e?.message));
  }
}

// Play API không liệt kê app theo tài khoản: thử lần lượt các tài khoản Play, nhớ tài khoản đọc được package.
export async function resolvePlayAccount(packageName: string): Promise<string> {
  const active = listAccounts().filter((a) => a.kind === 'play' && a.status === 'active');
  if (!active.length) throw new UserFacingError({ message: 'Chưa đăng nhập tài khoản Google Play', code: 'NO_PLAY_ACCOUNT', action: 'openSettings' });
  const cached = getJson<string>(`playAccount:${packageName}`);
  if (cached && active.some((a) => a.id === cached)) return cached;
  let last: unknown;
  for (const a of active) {
    try {
      // tracks.list rẻ nhất mà vẫn cần quyền với app
      await withEdit(a.id, packageName, (api, editId) => api.edits.tracks.list({ packageName, editId }), 'release');
      setJson(`playAccount:${packageName}`, a.id);
      return a.id;
    } catch (err) {
      last = err;
      const code = (err as UserFacingError).info?.code;
      if (code !== 'PERMISSION_DENIED' && code !== 'PACKAGE_NOT_FOUND') throw err;
    }
  }
  throw last;
}

// Mất quyền với app: quên tài khoản đã nhớ để lần sau dò lại
export const forgetPlayAccount = (packageName: string) => setJson(`playAccount:${packageName}`, null);

export const playApps = () => listApps().filter((a) => a.store === 'GOOGLE_PLAY');
