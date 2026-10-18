import { describe, expect, it } from 'vitest';
import { COUNTRIES, COUNTRY_GROUPS, countryFromGeoId, geoTargetId, languageId, searchCountries } from '@shared/geo';
import { adsLength, counterTone } from '@shared/textLength';
import { CountryRowSchema, issueMap, NameTemplateSchema, newRow, PlanSchema, renderName, toMicros } from '@shared/plan';

describe('geo', () => {
  it('geo target = 2000 + ISO numeric', () => {
    expect(geoTargetId('US')).toBe(2840);
    expect(geoTargetId('vn')).toBe(2704);
    expect(geoTargetId('AU')).toBe(2036);
    expect(countryFromGeoId('2356')).toBe('IN');
  });
  it('IN gồm cả Hindi', () => {
    expect(COUNTRIES.find((c) => c.code === 'IN')!.languages).toEqual(['en', 'hi']);
    expect(languageId('hi')).toBe(1023);
  });
  it('nhóm chỉ chứa quốc gia có trong bảng, mã không trùng', () => {
    const codes = new Set(COUNTRIES.map((c) => c.code));
    expect(codes.size).toBe(COUNTRIES.length);
    for (const g of COUNTRY_GROUPS) for (const c of g.codes) expect(codes.has(c)).toBe(true);
  });
  it('tìm không dấu và theo mã', () => {
    expect(searchCountries('duc').map((c) => c.code)).toContain('DE');
    expect(searchCountries('jp').map((c) => c.code)).toEqual(['JP']);
  });
  it('mọi ngôn ngữ mặc định đều có ID', () => {
    for (const c of COUNTRIES) for (const l of c.languages) expect(() => languageId(l)).not.toThrow();
  });
});

describe('adsLength', () => {
  it('CJK tính 2', () => {
    expect(adsLength('abc')).toBe(3);
    expect(adsLength('ゲーム')).toBe(6);
    expect(adsLength('게임')).toBe(4);
    expect(adsLength('Tiếng Việt')).toBe(10);
  });
  it('màu bộ đếm', () => {
    expect(counterTone(24, 30)).toBe('muted');
    expect(counterTone(27, 30)).toBe('warning');
    expect(counterTone(31, 30)).toBe('danger');
  });
});

describe('CountryRowSchema', () => {
  const ok = { ...newRow('US'), dailyBudget: 50, headlines: ['Play now'], descriptions: ['Best game'] };
  it('dòng hợp lệ', () => expect(CountryRowSchema.safeParse(ok).success).toBe(true));
  it('tCPI thiếu target → lỗi đúng ô', () => {
    const r = CountryRowSchema.safeParse({ ...ok, goal: 'INSTALLS_TCPI' });
    expect(issueMap(r.error)).toHaveProperty('target');
  });
  it('tROAS cần conversion action', () => {
    const r = CountryRowSchema.safeParse({ ...ok, goal: 'TROAS', target: 1.2 });
    expect(issueMap(r.error)).toHaveProperty('conversionActions');
  });
  it('tiêu đề quá dài → lỗi headlines.1', () => {
    const r = CountryRowSchema.safeParse({ ...ok, headlines: ['ok', 'x'.repeat(31)] });
    expect(issueMap(r.error)['headlines.1']).toBe('Dài 31/30');
  });
  it('plan báo quốc gia lặp', () => {
    const r = PlanSchema.safeParse({ id: 'p', appId: 'a', customerId: '1234567890', rows: [ok, ok] });
    expect(issueMap(r.error)).toHaveProperty('rows.1.countryCode');
  });
});

describe('đặt tên', () => {
  it('template mặc định', () => {
    const name = renderName('{app}_{store}_{geo}_{goal}_{yyyymmdd}_{seq}', {
      app: 'Stream Wave', store: 'GOOGLE_PLAY', geo: 'US', goal: 'INSTALLS_TCPI', date: new Date(2026, 9, 17), seq: 1,
    });
    expect(name).toBe('streamwave_GP_US_tCPI_20261017_01');
  });
  it('template thiếu {geo} hoặc biến lạ bị từ chối', () => {
    expect(NameTemplateSchema.safeParse('{app}_{goal}').success).toBe(false);
    expect(NameTemplateSchema.safeParse('{app}_{geo}_{foo}').error?.issues[0].message).toBe('Biến không hỗ trợ: {foo}');
  });
  it('micros làm tròn 0.01', () => {
    expect(toMicros(12.345)).toBe(12_350_000);
    expect(toMicros(50000)).toBe(50_000_000_000);
  });
});
