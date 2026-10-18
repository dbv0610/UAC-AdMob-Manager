// Hàm thuần của luồng upload (tách ra để test không cần Electron).
import type { AppError } from '@shared/types';
import type { CreativeStatus } from '@shared/creative';

const err = (e: AppError) => JSON.stringify(e);

export interface StatusPatch {
  status: CreativeStatus;
  privacy?: string | null;
  error?: string | null;
}

// Thời điểm 0h giờ Thái Bình Dương kế tiếp (+1 phút cho chắc)
export function msToNextPtDay(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const elapsed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000;
  return 86_400_000 - elapsed + 60_000;
}

export interface VideoLike {
  status?: { uploadStatus?: string | null; privacyStatus?: string | null; failureReason?: string | null; rejectionReason?: string | null } | null;
}

export function videoStatusPatch(v: VideoLike | undefined): StatusPatch | null {
  if (!v) return { status: 'FAILED', error: err({ message: 'Không tìm thấy video trên YouTube (đã xóa, hoặc là video private của kênh khác)', code: 'NOT_FOUND', action: 'fix' }) };
  const s = v.status ?? {};
  const privacy = s.privacyStatus ?? null;
  switch (s.uploadStatus) {
    case 'processed':
      return privacy === 'private'
        ? { status: 'LOCKED', privacy, error: err({ message: 'Video đang ở chế độ Private nên không gắn vào quảng cáo được — đổi sang Unlisted/Public, hoặc qua YouTube API Audit', code: 'LOCKED_PRIVATE', action: 'fix' }) }
        : { status: 'READY', privacy, error: null };
    case 'failed':
      return { status: 'FAILED', privacy, error: err({ message: `YouTube xử lý lỗi: ${s.failureReason ?? 'không rõ'}`, code: 'PROCESSING_FAILED', action: 'retry' }) };
    case 'rejected':
      return { status: 'FAILED', privacy, error: err({ message: `YouTube từ chối video: ${s.rejectionReason ?? 'không rõ'}`, code: `REJECTED_${s.rejectionReason ?? ''}`, action: 'fix' }) };
    case 'deleted':
      return { status: 'FAILED', privacy, error: err({ message: 'Video đã bị xóa trên YouTube', code: 'DELETED', action: 'fix' }) };
    default:
      return null; // 'uploaded' = đang xử lý
  }
}


// Trạng thái youTubeVideoUploads của Google Ads (enum số hoặc chuỗi tùy đường gọi)
const ADS_STATES = ['UNSPECIFIED', 'UNKNOWN', 'PENDING', 'UPLOADED', 'PROCESSED', 'FAILED', 'REJECTED', 'UNAVAILABLE'];
export function adsUploadPatch(state: number | string | null | undefined, videoId: string | null | undefined): (StatusPatch & { youtubeId?: string }) | null {
  const s = typeof state === 'number' ? ADS_STATES[state] : state;
  switch (s) {
    case 'PROCESSED':
      return videoId ? { status: 'READY', youtubeId: videoId, privacy: 'unlisted', error: null } : null;
    case 'FAILED':
      return { status: 'FAILED', error: err({ message: 'Google Ads/YouTube xử lý video lỗi — kiểm tra định dạng file rồi upload lại', code: 'ADS_UPLOAD_FAILED', action: 'retry' }) };
    case 'REJECTED':
      return { status: 'FAILED', error: err({ message: 'Video bị từ chối (vi phạm chính sách hoặc trùng nội dung)', code: 'ADS_UPLOAD_REJECTED', action: 'fix' }) };
    case 'UNAVAILABLE':
      return { status: 'FAILED', error: err({ message: 'Video không còn khả dụng (đã bị xóa)', code: 'ADS_UPLOAD_UNAVAILABLE', action: 'fix' }) };
    default:
      return null; // PENDING / UPLOADED: đang xử lý
  }
}

// Đích upload lưu trong creatives.upload_target: 'ads:<customerId>' | 'youtube:<accountId>'
export type Target = { kind: 'ads'; customerId: string } | { kind: 'youtube'; accountId: string };
export function parseTarget(t: string | null): Target | null {
  const i = (t ?? '').indexOf(':');
  if (i < 0) return null;
  const kind = t!.slice(0, i);
  const id = t!.slice(i + 1); // accountId cũng chứa ':' (youtube:<sub>)
  if (kind === 'ads' && /^\d{10}$/.test(id)) return { kind, customerId: id };
  if (kind === 'youtube' && id) return { kind, accountId: id };
  return null;
}
