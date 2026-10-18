import { describe, expect, it, vi } from 'vitest';
import { aspectOf, coverage, guessCountries, missingCells, parseYoutubeIds, videosForCountry, youtubeIdOf, type Creative } from '@shared/creative';
import { CHUNK, uploadResumable, type UploadDeps } from '../src/main/services/youtube/resumable';
import { msToNextPtDay, videoStatusPatch } from '../src/main/services/youtube/status';

vi.mock('electron', () => ({ net: { isOnline: () => true }, safeStorage: {}, shell: {}, app: {}, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('electron-log/main', () => ({ default: { info() {}, warn() {}, error() {} } }));
vi.mock('../src/main/db', () => ({ db: {} }));
const { mergeVideos } = await import('../src/main/services/googleAds/videos');

const cr = (p: Partial<Creative>): Creative => ({
  id: Math.random().toString(36),
  source: 'file',
  appId: null,
  name: 'v',
  path: '/v.mp4',
  kind: 'video',
  durationS: 15,
  width: 1920,
  height: 1080,
  aspect: 'landscape',
  sizeBytes: 1,
  countries: [],
  youtubeId: 'aaaaaaaaaaa',
  status: 'READY',
  privacy: 'unlisted',
  error: null,
  linkedCustomers: 0,
  createdAt: '2026-10-18',
  ...p,
});

describe('thư viện creative', () => {
  it('đoán quốc gia từ tên file có biên', () => {
    expect(guessCountries('promo_US_v2.mp4')).toEqual(['US']);
    expect(guessCountries('game_VN.mp4')).toEqual(['VN']);
    expect(guessCountries('a_US_JP_BR_final.mov')).toEqual(['US', 'JP', 'BR']);
    expect(guessCountries('a_USA_x.mp4')).toEqual([]); // 3 chữ không khớp
    expect(guessCountries('a_ZZ_x.mp4')).toEqual([]); // mã lạ
    expect(guessCountries('aUS_.mp4')).toEqual([]);
  });

  it('nhận tỉ lệ khung hình', () => {
    expect(aspectOf(1920, 1080)).toBe('landscape');
    expect(aspectOf(1080, 1920)).toBe('portrait');
    expect(aspectOf(1080, 1080)).toBe('square');
    expect(aspectOf(1080, 1000)).toBe('square');
  });

  it('đọc ID YouTube từ nhiều dạng link', () => {
    expect(youtubeIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdOf('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdOf('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdOf('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdOf('abc')).toBeNull();
    expect(parseYoutubeIds('dQw4w9WgXcQ\nhttps://youtu.be/dQw4w9WgXcQ, xxx')).toEqual({ ids: ['dQw4w9WgXcQ'], invalid: ['xxx'] });
  });

  it('ma trận đếm video riêng + dùng chung, bỏ video chưa sẵn sàng', () => {
    const list = [
      cr({ countries: ['US'], aspect: 'portrait' }),
      cr({ countries: ['US', 'VN'], aspect: 'landscape' }),
      cr({ countries: [], aspect: 'square' }),
      cr({ countries: ['VN'], aspect: 'portrait', status: 'PROCESSING' }),
      cr({ countries: ['VN'], aspect: 'portrait', status: 'LOCKED' }),
    ];
    const cov = coverage(list, ['US', 'VN']);
    expect(cov.US.portrait).toEqual({ own: 1, shared: 0 });
    expect(cov.VN.portrait).toEqual({ own: 0, shared: 0 });
    expect(cov.VN.square).toEqual({ own: 0, shared: 1 });
    expect(missingCells(cov)).toBe(1); // chỉ VN dọc
  });

  it('chọn video cho quốc gia: riêng trước, dùng chung sau, tối đa 20', () => {
    const list = [cr({ youtubeId: 'global00000', countries: [] }), cr({ youtubeId: 'us000000000', countries: ['US'] }), cr({ youtubeId: 'jp000000000', countries: ['JP'] })];
    expect(videosForCountry(list, 'US')).toEqual(['us000000000', 'global00000']);
    const many = Array.from({ length: 25 }, (_, i) => cr({ youtubeId: `v${String(i).padStart(10, '0')}`, countries: ['US'] }));
    expect(videosForCountry(many, 'US')).toHaveLength(20);
  });
});

describe('gắn video vào camp', () => {
  it('gộp video cũ + mới, bỏ video đã có, cắt ở 20', () => {
    const existing = ['a/1', 'a/2'];
    const r = mergeVideos(existing, [{ videoId: 'x', asset: 'a/1' }, { videoId: 'y', asset: null }, { videoId: 'z', asset: 'a/9' }]);
    expect(r.kept.map((k) => k.videoId)).toEqual(['y', 'z']);
    expect(r.overLimit).toBe(false);
    const full = mergeVideos(Array.from({ length: 19 }, (_, i) => `a/${i}`), [{ videoId: 'p', asset: null }, { videoId: 'q', asset: null }]);
    expect(full.kept.map((k) => k.videoId)).toEqual(['p']);
    expect(full.overLimit).toBe(true);
  });
});

describe('trạng thái YouTube', () => {
  it('processed + unlisted → READY; private → LOCKED; rejected → FAILED', () => {
    expect(videoStatusPatch({ status: { uploadStatus: 'processed', privacyStatus: 'unlisted' } })?.status).toBe('READY');
    expect(videoStatusPatch({ status: { uploadStatus: 'processed', privacyStatus: 'private' } })?.status).toBe('LOCKED');
    expect(videoStatusPatch({ status: { uploadStatus: 'rejected', rejectionReason: 'duplicate' } })?.status).toBe('FAILED');
    expect(videoStatusPatch({ status: { uploadStatus: 'uploaded' } })).toBeNull();
    expect(videoStatusPatch(undefined)?.status).toBe('FAILED');
  });

  it('thời gian tới 0h giờ PT', () => {
    // 2026-10-18 23:30 PDT = 06:30Z ngày 19 → còn 30 phút (+1 phút đệm)
    expect(msToNextPtDay(new Date('2026-10-19T06:30:00Z'))).toBe(31 * 60_000);
    expect(msToNextPtDay(new Date('2026-10-19T07:00:00Z'))).toBe(86_400_000 + 60_000);
  });
});

// ── Upload resumable với fetch giả ─────────────────────────────────────────
type Call = { url: string; method: string; headers: Record<string, string> };
function fakeServer(size: number, opts: { failAt?: number[]; status401Once?: boolean; quota?: boolean; already?: number } = {}) {
  let got = opts.already ?? 0;
  let n = 0;
  let said401 = false;
  const calls: Call[] = [];
  const res = (status: number, headers: Record<string, string> = {}, body?: unknown) =>
    new Response(body ? JSON.stringify(body) : null, { status, headers });
  const fetchFn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: init.method!, headers });
    n++;
    if (opts.status401Once && !said401 && n === 1) {
      said401 = true;
      return res(401);
    }
    if (init.method === 'POST') {
      if (opts.quota) return res(403, {}, { error: { message: 'quota', errors: [{ reason: 'uploadLimitExceeded' }] } });
      return res(200, { location: 'https://upload/session/1' });
    }
    const range = headers['Content-Range'];
    if (range.startsWith('bytes */')) {
      return got >= size ? res(200, {}, { id: 'VID', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }) : res(308, got ? { range: `bytes=0-${got - 1}` } : {});
    }
    if (opts.failAt?.includes(n)) throw new TypeError('fetch failed');
    const [, s, e] = range.match(/bytes (\d+)-(\d+)\//)!.map(Number);
    expect(s).toBe(got);
    got = e + 1;
    return got >= size ? res(201, {}, { id: 'VID', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }) : res(308, { range: `bytes=0-${got - 1}` });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function deps(fetchFn: typeof fetch, extra: Partial<UploadDeps> = {}): UploadDeps {
  return {
    fetch: fetchFn,
    readChunk: async (s, e) => new Uint8Array(e - s),
    getToken: () => 'tok',
    refreshToken: async () => 'tok2',
    sleep: async () => {},
    ...extra,
  };
}

describe('upload resumable', () => {
  const size = CHUNK * 2 + 100;
  const base = { size, mime: 'video/mp4', title: 't', session: null, onSession: () => {}, onProgress: () => {} };

  it('mở phiên rồi gửi từng chunk tới khi xong', async () => {
    const { fetchFn, calls } = fakeServer(size);
    const sessions: string[] = [];
    const out = await uploadResumable({ ...base, onSession: (u) => sessions.push(u) }, deps(fetchFn));
    expect(out).toEqual({ videoId: 'VID', privacy: 'unlisted', uploadStatus: 'uploaded' });
    expect(sessions).toEqual(['https://upload/session/1']);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(3);
    expect(calls[0].headers['X-Upload-Content-Length']).toBe(String(size));
  });

  it('tiếp tục phiên cũ từ offset YouTube đã nhận', async () => {
    const { fetchFn, calls } = fakeServer(size, { already: CHUNK });
    await uploadResumable({ ...base, session: 'https://upload/session/1' }, deps(fetchFn));
    expect(calls[0].headers['Content-Range']).toBe(`bytes */${size}`);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(calls.filter((c) => c.headers['Content-Range']?.startsWith('bytes 0-'))).toHaveLength(0);
  });

  it('lỗi mạng giữa chừng: chờ, hỏi offset, gửi tiếp', async () => {
    const { fetchFn } = fakeServer(size, { failAt: [3] });
    const sleep = vi.fn(async () => {});
    const out = await uploadResumable(base, deps(fetchFn, { sleep }));
    expect(out.videoId).toBe('VID');
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('401 → xin token mới rồi thử lại', async () => {
    const { fetchFn } = fakeServer(size, { status401Once: true });
    const refreshToken = vi.fn(async () => 'tok2');
    await uploadResumable(base, deps(fetchFn, { refreshToken }));
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it('hết quota → lỗi có reason, không retry', async () => {
    const { fetchFn } = fakeServer(size, { quota: true });
    await expect(uploadResumable(base, deps(fetchFn))).rejects.toMatchObject({ status: 403, reason: 'uploadLimitExceeded' });
  });
});

// ── Upload qua Google Ads (YouTubeVideoUploadService) ──────────────────────
const { uploadViaAds, adsVideoTitle } = await import('../src/main/services/youtube/adsResumable');
const { adsUploadPatch, parseTarget } = await import('../src/main/services/youtube/status');

function fakeAds(size: number, opts: { granularity?: number; failAt?: number[]; already?: number } = {}) {
  let got = opts.already ?? 0;
  let n = 0;
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: init.method!, headers, body: typeof init.body === 'string' ? init.body : undefined });
    n++;
    const cmd = headers['X-Goog-Upload-Command'];
    if (cmd === 'start') {
      return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://up/session', 'x-goog-upload-chunk-granularity': String(opts.granularity ?? 262144) } });
    }
    if (cmd === 'query') return new Response(null, { status: 200, headers: { 'x-goog-upload-status': 'active', 'x-goog-upload-size-received': String(got) } });
    if (opts.failAt?.includes(n)) throw new TypeError('fetch failed');
    expect(Number(headers['X-Goog-Upload-Offset'])).toBe(got);
    got += Number(headers['Content-Length']);
    if (cmd === 'upload, finalize') {
      expect(got).toBe(size);
      return new Response(JSON.stringify({ resourceName: 'customers/1234567890/youTubeVideoUploads/99' }), { status: 200, headers: { 'x-goog-upload-status': 'final' } });
    }
    return new Response(null, { status: 200, headers: { 'x-goog-upload-status': 'active' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('upload qua Google Ads', () => {
  const size = CHUNK * 2 + 123;
  const base = { customerId: '1234567890', loginCustomerId: '9999999999', developerToken: 'dev', size, mime: 'video/mp4', title: 'promo <US>', session: null, onSession: () => {}, onProgress: () => {} };

  it('start → các chunk upload → chunk cuối upload, finalize', async () => {
    const { fetchFn, calls } = fakeAds(size);
    const out = await uploadViaAds(base, deps(fetchFn));
    expect(out.resourceName).toBe('customers/1234567890/youTubeVideoUploads/99');
    const start = calls[0];
    expect(start.url).toBe('https://googleads.googleapis.com/resumable/upload/v25/customers/1234567890/youTubeVideoUploads:create');
    expect(start.headers['developer-token']).toBe('dev');
    expect(start.headers['login-customer-id']).toBe('9999999999');
    expect(JSON.parse(start.body!).you_tube_video_upload).toEqual({ video_title: 'promo US', video_description: '', video_privacy: 'UNLISTED' });
    expect(calls.slice(1).map((c) => c.headers['X-Goog-Upload-Command'])).toEqual(['upload', 'upload', 'upload, finalize']);
  });

  it('lỗi mạng giữa chừng: query offset rồi gửi tiếp', async () => {
    const { fetchFn, calls } = fakeAds(size, { failAt: [3] });
    const out = await uploadViaAds(base, deps(fetchFn));
    expect(out.resourceName).toContain('youTubeVideoUploads');
    expect(calls.some((c) => c.headers['X-Goog-Upload-Command'] === 'query')).toBe(true);
  });

  it('tiếp phiên cũ không mở phiên mới', async () => {
    const { fetchFn, calls } = fakeAds(size, { already: CHUNK });
    await uploadViaAds({ ...base, session: 'https://up/session' }, deps(fetchFn));
    expect(calls[0].headers['X-Goog-Upload-Command']).toBe('query');
    expect(calls.some((c) => c.headers['X-Goog-Upload-Command'] === 'start')).toBe(false);
  });

  it('trạng thái youTubeVideoUploads → trạng thái thư viện', () => {
    expect(adsUploadPatch(4, 'abcdefghijk')).toMatchObject({ status: 'READY', youtubeId: 'abcdefghijk' });
    expect(adsUploadPatch('PROCESSED', null)).toBeNull(); // chưa có video_id
    expect(adsUploadPatch(3, null)).toBeNull(); // UPLOADED: đang xử lý
    expect(adsUploadPatch('REJECTED', null)?.status).toBe('FAILED');
    expect(adsVideoTitle('a'.repeat(120))).toHaveLength(100);
  });

  it('đọc đích upload', () => {
    expect(parseTarget('ads:1234567890')).toEqual({ kind: 'ads', customerId: '1234567890' });
    expect(parseTarget('youtube:youtube:1077')).toEqual({ kind: 'youtube', accountId: 'youtube:1077' });
    expect(parseTarget(null)).toBeNull();
  });
});

describe('thay video LOW', async () => {
  const { pickReplacements } = await import('@shared/creative');
  it('ưu tiên video riêng của nước, cùng tỉ lệ; bỏ video đã có trong ad và video chưa sẵn sàng', () => {
    const lib = [
      cr({ youtubeId: 'us_portrait', countries: ['US'], aspect: 'portrait', name: 'a' }),
      cr({ youtubeId: 'gl_portrait', countries: [], aspect: 'portrait', name: 'b' }),
      cr({ youtubeId: 'us_landscap', countries: ['US'], aspect: 'landscape', name: 'c' }),
      cr({ youtubeId: 'jp_portrait', countries: ['JP'], aspect: 'portrait', name: 'd' }),
      cr({ youtubeId: 'us_inad_000', countries: ['US'], aspect: 'portrait', name: 'e' }),
      cr({ youtubeId: 'us_process0', countries: ['US'], aspect: 'portrait', status: 'PROCESSING', name: 'f' }),
    ];
    const r = pickReplacements(lib, 'US', 'portrait', ['us_inad_000']);
    expect(r.map((x) => x.youtubeId)).toEqual(['us_portrait', 'gl_portrait']);
    // không biết tỉ lệ video LOW → nhận mọi tỉ lệ
    expect(pickReplacements(lib, 'US', null, []).map((x) => x.youtubeId)).toContain('us_landscap');
  });
});
