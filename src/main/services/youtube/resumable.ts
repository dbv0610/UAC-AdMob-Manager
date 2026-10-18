// Upload resumable của YouTube Data API, tách khỏi worker để test được bằng fetch giả.
// https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

export const CHUNK = 8 * 1024 * 1024; // bội số 256 KiB theo yêu cầu của giao thức
const INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false';

export class UploadError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public reason: string | null = null,
    public sessionGone = false,
  ) {
    super(message);
  }
}

export interface UploadDeps {
  fetch: typeof fetch;
  readChunk(start: number, end: number): Promise<Uint8Array>; // [start, end)
  getToken(): string;
  refreshToken(): Promise<string>; // hỏi main access token mới khi gặp 401
  sleep(ms: number): Promise<void>;
  signal?: AbortSignal;
}

export interface UploadOpts {
  size: number;
  mime: string;
  title: string;
  session: string | null;
  onSession(url: string): void;
  onProgress(sent: number): void;
}

export interface UploadDone {
  videoId: string;
  privacy: string | null;
  uploadStatus: string | null;
}

async function errorOf(res: Response, fallback: string) {
  let reason: string | null = null;
  let message = fallback;
  try {
    const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? null;
    message = j.error?.message ?? message;
  } catch {
    // body không phải JSON
  }
  return new UploadError(message, res.status, reason, res.status === 404 || res.status === 410);
}

// Range: bytes=0-1048575 → đã nhận 1048576 byte
const received = (res: Response) => {
  const m = res.headers.get('range')?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
};

const transient = (s: number | null) => s == null || s >= 500 || s === 429;

export async function uploadResumable(opts: UploadOpts, deps: UploadDeps): Promise<UploadDone> {
  const { size, mime } = opts;
  const authed = async (init: (token: string) => RequestInit & { url: string }) => {
    for (let attempt = 0; ; attempt++) {
      const { url, ...req } = init(deps.getToken());
      const res = await deps.fetch(url, { ...req, signal: deps.signal });
      if (res.status === 401 && attempt === 0) {
        await deps.refreshToken();
        continue;
      }
      return res;
    }
  };

  let session = opts.session;
  if (!session) {
    const res = await authed((token) => ({
      url: INIT_URL,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': mime,
      },
      body: JSON.stringify({
        snippet: { title: opts.title, categoryId: '28' },
        status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
      }),
    }));
    if (!res.ok) throw await errorOf(res, `Không mở được phiên upload (HTTP ${res.status})`);
    session = res.headers.get('location');
    if (!session) throw new UploadError('YouTube không trả về địa chỉ phiên upload', res.status);
    opts.onSession(session);
  }

  const finish = async (res: Response): Promise<UploadDone> => {
    const v = (await res.json()) as { id?: string; status?: { privacyStatus?: string; uploadStatus?: string } };
    if (!v.id) throw new UploadError('YouTube không trả về ID video', res.status);
    opts.onProgress(size);
    return { videoId: v.id, privacy: v.status?.privacyStatus ?? null, uploadStatus: v.status?.uploadStatus ?? null };
  };

  // Hỏi YouTube đã nhận bao nhiêu byte (dùng khi tiếp tục phiên cũ hoặc sau lỗi mạng)
  const query = async () => {
    const res = await authed((token) => ({
      url: session!,
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
    }));
    if (res.status === 200 || res.status === 201) return { done: await finish(res) };
    if (res.status === 308) return { offset: received(res) };
    throw await errorOf(res, `Không đọc được tiến độ phiên upload (HTTP ${res.status})`);
  };

  let offset = 0;
  let needQuery = !!opts.session; // phiên cũ hoặc vừa lỗi: phải hỏi offset trước khi gửi tiếp
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
      const end = Math.min(offset + CHUNK, size);
      const body = await deps.readChunk(offset, end);
      const res = await authed((token) => ({
        url: session!,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Length': String(end - offset),
          'Content-Range': `bytes ${offset}-${end - 1}/${size}`,
        },
        body: body as unknown as RequestInit['body'],
      }));
      if (res.status === 200 || res.status === 201) return await finish(res);
      if (res.status === 308) {
        offset = received(res);
        failures = 0;
        continue;
      }
      throw await errorOf(res, `Upload lỗi HTTP ${res.status}`);
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      const status = err instanceof UploadError ? err.status : null;
      // Lỗi mạng / 5xx: chờ rồi hỏi lại offset, tiếp tục từ chỗ dở (tối đa 5 lần liên tiếp)
      if (!transient(status) || ++failures > 5) throw err instanceof UploadError ? err : new UploadError((err as Error).message, null);
      await deps.sleep(2000 * 2 ** (failures - 1));
      needQuery = true;
    }
  }
}
