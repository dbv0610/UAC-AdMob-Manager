import { describe, expect, it, vi } from 'vitest';
import { checkAdText, extractJson } from '@shared/adtext';

vi.mock('electron', () => ({ net: { isOnline: () => true }, safeStorage: {}, shell: {}, app: {}, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('electron-log/main', () => ({ default: { info() {}, warn() {}, error() {} } }));
vi.mock('../src/main/db', () => ({ db: {} }));
const { translateOne, callClaude, AI_MODEL } = await import('../src/main/services/ai/translate');

describe('kiểm tra text quảng cáo', () => {
  it('độ dài theo cách Google đếm (CJK × 2)', () => {
    expect(checkAdText('Xem phim miễn phí', 'headline')).toMatchObject({ len: 17, over: false, issues: [] });
    expect(checkAdText('無料で映画を見る無料で映画を見る', 'headline')).toMatchObject({ len: 32, over: true });
  });
  it('bắt lỗi chính sách hay gặp', () => {
    expect(checkAdText('Free movies!!', 'headline').issues).toContain('Lặp dấu câu (!!, ??)');
    expect(checkAdText('WATCH FREE MOVIES', 'headline').issues).toContain('Viết hoa toàn bộ');
    expect(checkAdText('Watch HD TV', 'headline').issues).toEqual([]); // viết tắt ngắn không tính
    expect(checkAdText('Click here to watch', 'description').issues[0]).toContain('Click here');
    expect(checkAdText('Watch now 🎬', 'headline').issues).toContain('Có emoji');
  });
  it('lấy JSON trong câu trả lời có chữ thừa', () => {
    expect(extractJson<{ a: number }>('Đây: ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('không có json')).toBeNull();
  });
});

describe('AI dịch', () => {
  const req = { headlines: ['Watch free movies', 'Fast HD player'], descriptions: ['Thousands of movies in HD, no annoying ads.'] };

  it('dịch rồi rút gọn câu vượt 30 ký tự, tối đa 2 lần', async () => {
    const calls: string[] = [];
    const call = vi.fn(async (_s: string, user: string) => {
      calls.push(user);
      if (calls.length === 1) return JSON.stringify({ headlines: ['Xem phim miễn phí mọi lúc mọi nơi rất nhanh', 'Trình phát HD nhanh'], descriptions: ['Hàng nghìn phim HD, không quảng cáo phiền.'] });
      return JSON.stringify({ items: ['Xem phim miễn phí mọi lúc'] });
    });
    const r = await translateOne('vi', req, 'StreamWave', call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(calls[0]).toContain('Target language: Vietnamese (vi)');
    expect(calls[0]).toContain('App name (keep as is): StreamWave');
    expect(calls[1]).toMatch(/\(headline, max 30, now 4\d\)/);
    expect(r.items[0]).toMatchObject({ text: 'Xem phim miễn phí mọi lúc', over: false, attempts: 2 });
    expect(r.items[2]).toMatchObject({ field: 'description', over: false, attempts: 1 });
  });

  it('vẫn quá dài sau 2 lần rút gọn → giữ lại, đánh dấu over để người dùng sửa', async () => {
    const long = 'x'.repeat(40);
    const call = vi.fn(async (_s: string, u: string) => (u.startsWith('Target language') && u.includes('Translate') ? JSON.stringify({ headlines: [long, 'ok'], descriptions: ['ok'] }) : JSON.stringify({ items: [long] })));
    const r = await translateOne('ja', req, null, call);
    expect(call).toHaveBeenCalledTimes(3);
    expect(r.items[0]).toMatchObject({ over: true, attempts: 3 });
  });

  it('model trả sai định dạng → báo lỗi cho ngôn ngữ đó', async () => {
    const r = await translateOne('de', req, null, async () => 'xin lỗi tôi không thể');
    expect(r.error).toContain('không đúng định dạng');
  });

  it('gọi Messages API đúng header/model; 401 → hướng dẫn mở Cài đặt; 429 → thử lại', async () => {
    const seen: RequestInit[] = [];
    let n = 0;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      n++;
      if (n === 1) return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":1}' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    vi.useFakeTimers();
    const p = callClaude('sys', 'hi', 'sk-ant-test', fetchFn);
    await vi.runAllTimersAsync();
    expect(await p).toBe('{"ok":1}');
    vi.useRealTimers();
    const h = seen[1].headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(String(seen[1].body)).model).toBe(AI_MODEL);
    const bad = (async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(callClaude('s', 'u', 'sk-ant-bad', bad)).rejects.toMatchObject({ info: { action: 'openSettings', code: 'AI_401' } });
  });
});

describe('gói chẩn đoán', async () => {
  vi.doMock('fflate', () => ({ zipSync: () => new Uint8Array(), strToU8: () => new Uint8Array() }));
  const { mask } = await import('../src/main/diagnostics');
  it('che token, key, client secret, email', () => {
    const s = mask('access_token: ya29.a0AfH6abc refresh_token="1//0gXyz" key sk-ant-api03-abcdef GOCSPX-zzz9 developer-token=AbCdEf123 user admob.studio@gmail.com');
    expect(s).not.toMatch(/a0AfH6abc|0gXyz|api03-abcdef|zzz9|AbCdEf123|admob\.studio@/);
    expect(s).toContain('a***@gmail.com');
  });
});
