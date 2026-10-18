// Upload video qua Google Ads API (YouTubeVideoUploadService) bằng giao thức resumable của Google
// (X-Goog-Upload-*). Video lên kênh YouTube do Google quản lý của tài khoản Ads: không cần tài khoản
// YouTube, không cần YouTube API Audit, luôn Unlisted.
// https://developers.google.com/google-ads/api/docs/assets/upload-videos
import { UploadError, type UploadDeps } from './resumable';

export const ADS_API_VERSION = 'v25'; // cùng phiên bản với thư viện google-ads-api
const DEFAULT_CHUNK = 8 * 1024 * 1024;

export interface AdsUploadOpts {
  customerId: string;
  loginCustomerId: string | null;
  developerToken: string;
  size: number;
  mime: string;
  title: string;
  session: string | null;
  onSession(url: string): void;
  onProgress(sent: number): void;
}

async function errorOf(res: Response, fallback: string) {
  let message = fallback;
  let reason: string | null = null;
  try {
    const j = (await res.json()) as {
      error?: { message?: string; status?: string; details?: { errors?: { message?: string; errorCode?: Record<string, string> }[] }[] };
    };
    const ads = j.error?.details?.[0]?.errors?.[0];
    message = ads?.message ?? j.error?.message ?? message;
    reason = ads?.errorCode ? Object.entries(ads.errorCode).map(([k, v]) => `${k}.${v}`)[0] : (j.error?.status ?? null);
  } catch {
    // body không phải JSON
  }
  return new UploadError(message, res.status, reason, res.status === 404 || res.status === 410);
}

const transient = (s: number | null) => s == null || s >= 500 || s === 429;

// Tiêu đề tối đa 100 ký tự, không có < >
export const adsVideoTitle = (name: string) => name.replace(/[<>]/g, '').slice(0, 100) || 'Video';

export async function uploadViaAds(opts: AdsUploadOpts, deps: UploadDeps): Promise<{ resourceName: string }> {
  const { size } = opts;
  const authed = async (url: string, init: (token: string) => RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      const res = await deps.fetch(url, { ...init(deps.getToken()), signal: deps.signal });
      if (res.status === 401 && attempt === 0) {
        await deps.refreshToken();
        continue;
      }
      return res;
    }
  };
  const base = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    ...(opts.developerToken ? { 'developer-token': opts.developerToken } : {}), // đã khai tử, chỉ gửi nếu còn lưu
    ...(opts.loginCustomerId ? { 'login-customer-id': opts.loginCustomerId } : {}),
  });

  let session = opts.session;
  let chunk = DEFAULT_CHUNK;
  if (!session) {
    const url = `https://googleads.googleapis.com/resumable/upload/${ADS_API_VERSION}/customers/${opts.customerId}/youTubeVideoUploads:create`;
    const res = await authed(url, (token) => ({
      method: 'POST',
      headers: {
        ...base(token),
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': opts.mime,
      },
      body: JSON.stringify({
        customer_id: opts.customerId,
        you_tube_video_upload: { video_title: adsVideoTitle(opts.title), video_description: '', video_privacy: 'UNLISTED' },
      }),
    }));
    if (!res.ok) throw await errorOf(res, `Google Ads không mở được phiên upload (HTTP ${res.status})`);
    session = res.headers.get('x-goog-upload-url');
    if (!session) throw new UploadError('Google Ads không trả về địa chỉ phiên upload', res.status);
    // Chunk phải là bội số của granularity server yêu cầu (trừ chunk cuối)
    const g = Number(res.headers.get('x-goog-upload-chunk-granularity'));
    if (g > 0) chunk = Math.max(g, Math.floor(DEFAULT_CHUNK / g) * g);
    opts.onSession(session);
  }

  const finish = async (res: Response) => {
    const j = (await res.json()) as { resourceName?: string; resource_name?: string };
    const resourceName = j.resourceName ?? j.resource_name;
    if (!resourceName) throw new UploadError('Google Ads không trả về resource name của video', res.status);
    opts.onProgress(size);
    return { resourceName };
  };

  // Hỏi server đã nhận bao nhiêu byte (tiếp phiên cũ hoặc sau lỗi mạng)
  const query = async () => {
    const res = await authed(session!, (token) => ({ method: 'POST', headers: { ...base(token), 'X-Goog-Upload-Command': 'query' } }));
    if (!res.ok) throw await errorOf(res, `Không đọc được tiến độ phiên upload (HTTP ${res.status})`);
    const status = res.headers.get('x-goog-upload-status');
    if (status === 'final') return { done: await finish(res) };
    if (status === 'cancelled') throw new UploadError('Phiên upload đã bị hủy', res.status, null, true);
    return { offset: Number(res.headers.get('x-goog-upload-size-received') ?? 0) };
  };

  let offset = 0;
  let needQuery = !!opts.session;
  let failures = 0;
  while (true) {
    try {
      if (needQuery) {
        const q = await query();
        if (q.done) return q.done;
        offset = q.offset!;
        needQuery = false;
      }
      opts.onProgress(offset);
      const end = Math.min(offset + chunk, size);
      const last = end >= size;
      const body = await deps.readChunk(offset, end);
      const res = await authed(session!, (token) => ({
        method: 'PUT',
        headers: {
          ...base(token),
          'X-Goog-Upload-Command': last ? 'upload, finalize' : 'upload',
          'X-Goog-Upload-Offset': String(offset),
          'Content-Length': String(end - offset),
        },
        body: body as unknown as RequestInit['body'],
      }));
      if (!res.ok) throw await errorOf(res, `Upload lỗi HTTP ${res.status}`);
      if (last) return await finish(res);
      offset = end;
      failures = 0;
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      const status = err instanceof UploadError ? err.status : null;
      if (!transient(status) || ++failures > 5) throw err instanceof UploadError ? err : new UploadError((err as Error).message, null);
      await deps.sleep(2000 * 2 ** (failures - 1));
      needQuery = true;
    }
  }
}
