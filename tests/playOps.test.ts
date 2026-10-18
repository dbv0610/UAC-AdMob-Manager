import { describe, expect, it } from 'vitest';
import { DEFAULT_VITALS_ALERTS, ReplySchema, appStage, applyReleaseAction, fillTemplate, releaseKey, reviewStats, stageTrack, summarizeVitals, vitalsBreaches, type PlayReview, type VitalsDay } from '@shared/playOps';

const rel = (codes: string[], status: string, userFraction?: number, extra: Record<string, unknown> = {}) => ({ name: codes.join(','), versionCodes: codes, status, userFraction, ...extra });

describe('đổi trạng thái release', () => {
  const live = rel(['100'], 'completed');
  const staged = rel(['101'], 'inProgress', 0.1, { releaseNotes: [{ language: 'en-US', text: 'Fixes' }] });

  it('tăng rollout, giữ nguyên release notes', () => {
    const r = applyReleaseAction([live, staged], '101', { kind: 'rollout', fraction: 0.5 });
    expect(r).toEqual({ releases: [live, { ...staged, userFraction: 0.5 }] });
  });
  it('không cho giảm hoặc giữ % rollout', () => {
    const r = applyReleaseAction([live, staged], '101', { kind: 'rollout', fraction: 0.05 });
    expect('error' in r && r.error).toContain('không cho giảm');
  });
  it('phát hành 100%: bỏ userFraction, thay bản completed cũ', () => {
    const r = applyReleaseAction([live, staged], '101', { kind: 'complete' });
    if ('error' in r) throw new Error(r.error);
    expect(r.releases).toHaveLength(1);
    expect(r.releases[0]).toMatchObject({ versionCodes: ['101'], status: 'completed' });
    expect('userFraction' in r.releases[0]).toBe(false);
  });
  it('tạm dừng / tiếp tục giữ nguyên %', () => {
    const halted = applyReleaseAction([live, staged], '101', { kind: 'halt' });
    expect(halted).toEqual({ releases: [live, { ...staged, status: 'halted' }] });
    const h = rel(['101'], 'halted', 0.1);
    expect(applyReleaseAction([live, h], '101', { kind: 'resume' })).toEqual({ releases: [live, { ...h, status: 'inProgress' }] });
    expect('error' in applyReleaseAction([live, staged], '101', { kind: 'resume' })).toBe(true);
  });
  it('chặn hai bản rollout dở trong cùng track và bản nháp chưa có build', () => {
    const draft = rel(['102'], 'draft');
    expect(applyReleaseAction([live, staged, draft], '102', { kind: 'rollout', fraction: 0.2 })).toMatchObject({ error: expect.stringContaining('rollout dở') });
    expect(applyReleaseAction([{ name: 'Nháp', versionCodes: [], status: 'draft' }], 'name:Nháp', { kind: 'complete' })).toMatchObject({ error: expect.stringContaining('APK/AAB') });
  });
  it('khóa release theo version code', () => {
    expect(releaseKey(rel(['5', '6'], 'draft'))).toBe('5,6');
    expect(releaseKey({ name: 'x', versionCodes: [] })).toBe('name:x');
  });
});

describe('vitals', () => {
  const day = (date: string, userCrashRate: number, userAnrRate: number, users = 1000): VitalsDay => ({ date, crashRate: userCrashRate * 1.5, userCrashRate, anrRate: userAnrRate, userAnrRate, users });
  it('trung bình 28 ngày có trọng số người dùng, xếp mức so với ngưỡng Google', () => {
    const days = [day('2026-10-01', 0.02, 0.001, 1000), day('2026-10-02', 0.005, 0.004, 3000)];
    const s = summarizeVitals(days);
    expect(s.userCrash28).toBeCloseTo((0.02 * 1000 + 0.005 * 3000) / 4000);
    expect(s.crash).toBe('warn'); // 0,875% ≥ 80% của ngưỡng 1,09% → gần ngưỡng (trung bình đều sẽ là 1,25% = vượt)
  });
  it('mức good / warn / bad', () => {
    expect(summarizeVitals([day('d', 0.005, 0.001)])).toMatchObject({ crash: 'good', anr: 'good' });
    expect(summarizeVitals([day('d', 0.009, 0.004)])).toMatchObject({ crash: 'warn', anr: 'warn' });
    expect(summarizeVitals([day('d', 0.02, 0.006)])).toMatchObject({ crash: 'bad', anr: 'bad' });
    expect(summarizeVitals([])).toMatchObject({ crash: null, latest: null });
  });
});

describe('review', () => {
  const r = (rating: number, reply: boolean): PlayReview => ({ id: String(Math.random()), author: 'a', rating, text: 't', language: 'en', device: null, appVersion: null, androidVersion: null, at: '', thumbsUp: 0, reply: reply ? { text: 'ok', at: '' } : null, translated: null });
  it('thống kê chưa trả lời và ≤2 sao', () => {
    expect(reviewStats([r(5, true), r(1, false), r(2, false), r(4, false)])).toEqual({ count: 4, avg: 3, unanswered: 3, lowUnanswered: 2 });
    expect(reviewStats([]).avg).toBeNull();
  });
  it('câu trả lời tối đa 350 ký tự', () => {
    const base = { accountId: 'play:1', packageName: 'com.a.b', reviewId: 'x' };
    expect(ReplySchema.safeParse({ ...base, text: 'a'.repeat(350) }).success).toBe(true);
    expect(ReplySchema.safeParse({ ...base, text: 'a'.repeat(351) }).success).toBe(false);
    expect(ReplySchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
  });
});

describe('giai đoạn app', () => {
  const T = (track: string, status: string) => ({ track, releases: [{ key: '1', name: '1', versionCodes: ['1'], status: status as 'completed', userFraction: null, notesLanguages: [] }] });
  it('suy ra từ các track, kể cả kênh kín tự đặt tên', () => {
    expect(appStage([T('production', 'completed'), T('alpha', 'completed')])).toBe('production');
    expect(appStage([T('production', 'draft'), T('beta', 'completed')])).toBe('open');
    expect(appStage([T('alpha', 'completed'), T('internal', 'completed')])).toBe('closed');
    expect(appStage([T('qa-team', 'inProgress')])).toBe('closed');
    expect(appStage([T('internal', 'completed')])).toBe('internal');
    expect(appStage([T('production', 'draft')])).toBe('none');
    expect(stageTrack([T('qa-team', 'completed'), T('internal', 'completed')])?.track).toBe('qa-team');
  });
});

describe('cảnh báo vitals theo ngưỡng tự đặt', () => {
  const prefs = { ...DEFAULT_VITALS_ALERTS, crash: 0.01, anr: 0.005, minUsers: 100 };
  const d = (date: string, c: number, a: number, users = 1000) => ({ date, crashRate: c, userCrashRate: c, anrRate: a, userAnrRate: a, users });
  it('báo theo ngày mới nhất và theo phiên bản, bỏ qua bản ít người dùng', () => {
    const data = {
      packageName: 'com.a.b',
      at: '',
      days: [d('2026-10-01', 0.002, 0.001), d('2026-10-02', 0.015, 0.001)],
      versions: [
        { versionCode: '121', userCrashRate: 0.03, userAnrRate: 0.001, users: 500, lastDate: '2026-10-02' },
        { versionCode: '122', userCrashRate: 0.2, userAnrRate: 0.2, users: 20, lastDate: '2026-10-02' },
      ],
    };
    const b = vitalsBreaches(data, prefs);
    expect(b.map((x) => `${x.scope}:${x.label}:${x.metric}`)).toEqual(['day:2026-10-02:crash', 'version:121:crash']);
    expect(vitalsBreaches(data, { ...prefs, daily: false }).some((x) => x.scope === 'day')).toBe(false);
  });
  it('luôn báo khi trung bình 28 ngày vượt ngưỡng Google', () => {
    const b = vitalsBreaches({ packageName: 'x', at: '', days: [d('2026-10-01', 0.02, 0.006, 50)] }, prefs);
    expect(b.map((x) => x.scope)).toEqual(['avg28', 'avg28']); // ngày có 50 người dùng < minUsers nên không báo theo ngày
  });
  it('điền tên app vào câu trả lời mẫu', () => {
    expect(fillTemplate('Cảm ơn bạn đã dùng {app}! {app} sẽ tốt hơn.', 'StreamWave')).toBe('Cảm ơn bạn đã dùng StreamWave! StreamWave sẽ tốt hơn.');
  });
});
