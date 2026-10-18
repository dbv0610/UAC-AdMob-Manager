import { describe, expect, it } from 'vitest';
import { AnalyticsRangeSchema, DEFAULT_ALERT_PREFS, addDays, bucketDaily, countryStats, cumulative, dailyOf, daysBetween, delta, evaluateAlerts, heatmapOf, insightsOf, kpisOf, median, quadrants, rangeOf, resolveRange, toCsv, unitFlags, sourceFlags, kpisFromTotals, type DayRow } from '@shared/analytics';
import { parseMediation, parseUnitSources, parseUnits, publisherOf } from '../src/main/services/admob/parse';

const row = (p: Partial<DayRow>): DayRow => ({ date: '2026-10-17', appId: 'a', country: 'US', spend: 0, installs: 0, revenue: 0, adImpressions: 0, matched: 0, requests: 0, adClicks: 0, adsImpressions: 0, adsClicks: 0, ...p });
const fmt = { fmtPct: (v: number) => `${Math.round(v * 100)}%`, fmtMoney: (v: number) => `$${v.toFixed(2)}` };

describe('kỳ báo cáo', () => {
  it('7 ngày trọn vẹn kết thúc hôm qua, kỳ trước liền kề', () => {
    expect(rangeOf('last7', '2026-10-18')).toEqual({ from: '2026-10-11', to: '2026-10-17', prevFrom: '2026-10-04', prevTo: '2026-10-10' });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('kỳ Analytics mở rộng', () => {
  const today = '2026-10-18';
  it('preset: hôm qua, 90 ngày, tháng này, tháng trước; kỳ trước cùng độ dài', () => {
    expect(resolveRange('yesterday', today)).toEqual({ from: '2026-10-17', to: '2026-10-17', prevFrom: '2026-10-16', prevTo: '2026-10-16' });
    const r90 = resolveRange('last90', today);
    expect(daysBetween(r90.from, r90.to)).toBe(90);
    expect(daysBetween(r90.prevFrom, r90.prevTo)).toBe(90);
    expect(resolveRange('thisMonth', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-17', prevTo: '2026-09-30' });
    expect(resolveRange('lastMonth', today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-02', prevTo: '2026-08-31' });
    // Ngày 1: “tháng này” lùi về tháng trước thay vì kỳ rỗng
    expect(resolveRange('thisMonth', '2026-11-01')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('tự chọn từ–đến, kiểm tra hợp lệ', () => {
    expect(resolveRange({ from: '2026-02-27', to: '2026-03-02' })).toEqual({ from: '2026-02-27', to: '2026-03-02', prevFrom: '2026-02-23', prevTo: '2026-02-26' });
    expect(AnalyticsRangeSchema.safeParse({ from: '2026-03-02', to: '2026-02-27' }).success).toBe(false);
    expect(AnalyticsRangeSchema.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(false);
    expect(AnalyticsRangeSchema.safeParse('last90').success).toBe(true);
    expect(AnalyticsRangeSchema.safeParse('last999').success).toBe(false);
  });
});

describe('gộp tuần, lũy kế, bản đồ nhiệt, ma trận', () => {
  it('gộp theo tuần bắt đầu thứ Hai; lũy kế cộng dồn', () => {
    // 2026-10-11 là Chủ nhật → thuộc tuần 05/10; 12–18 là tuần mới
    const pts = dailyOf([row({ date: '2026-10-11', spend: 1 }), row({ date: '2026-10-12', spend: 2 }), row({ date: '2026-10-18', spend: 3 })], '2026-10-11', '2026-10-18');
    const w = bucketDaily(pts, 'week');
    expect(w.map((p) => [p.date, p.spend])).toEqual([['2026-10-05', 1], ['2026-10-12', 5]]);
    expect(cumulative(pts).map((p) => p.spend).at(-1)).toBe(6);
  });

  it('heatmap top nước theo chi phí, ô theo ngày', () => {
    const h = heatmapOf([row({ country: 'US', spend: 5, revenue: 6 }), row({ country: 'VN', spend: 9 }), row({ country: 'JP', revenue: 0 })], '2026-10-16', '2026-10-17');
    expect(h.countries).toEqual(['VN', 'US']);
    expect(h.cells[1][1]).toMatchObject({ spend: 5, revenue: 6 });
  });

  it('chia 4 góc theo ngưỡng ROAS và trung vị chi phí', () => {
    const rows = [{ spend: 100, roas: 1.5 }, { spend: 10, roas: 2 }, { spend: 120, roas: 0.4 }, { spend: 5, roas: 0.2 }, { spend: 0, roas: null }];
    const q = quadrants(rows, 1);
    expect(rows.map(q.of)).toEqual(['star', 'scale', 'cut', 'watch', null]);
  });

  it('KPI mới: lợi nhuận, CTR Ads, tỉ lệ cài, fill rate', () => {
    const k = kpisOf([row({ spend: 50, revenue: 80, installs: 20, adsImpressions: 1000, adsClicks: 40, matched: 900, requests: 1000, adImpressions: 450 })]);
    expect(k).toMatchObject({ profit: 30, adsCtr: 0.04, cvr: 0.5, fillRate: 0.9, showRate: 0.5 });
  });
});

describe('nhận định', () => {
  const mk = (country: string, cur: Partial<DayRow>, prev: Partial<DayRow> = {}) => ({ cur: row({ country, ...cur }), prev: row({ country, date: '2026-10-09', ...prev }) });
  const fmtI = { fmtPct: (v: number) => `${Math.round(v * 100)}%`, fmtMoney: (v: number) => `$${v.toFixed(0)}` };
  it('lỗ nặng, nên tăng, ROAS giảm, nước organic', () => {
    const data = [
      mk('US', { spend: 500, revenue: 100, installs: 200 }, { spend: 400, revenue: 400 }),
      mk('VN', { spend: 30, revenue: 60, installs: 30 }),
      mk('JP', { spend: 300, revenue: 330, installs: 100 }),
      mk('DE', { revenue: 40, adImpressions: 1000 }),
    ];
    const stats = countryStats(data.map((x) => x.cur), data.map((x) => x.prev), []);
    const ids = insightsOf(stats, kpisOf(data.map((x) => x.cur)), { target: 1, minSpend: 20, ...fmtI });
    const by = Object.fromEntries(ids.map((i) => [i.id, i]));
    expect(by.burn.countries).toEqual(['US']);
    expect(by.scale.countries).toEqual(['VN']);
    expect(by.drop.countries).toContain('US');
    expect(by.expand.countries).toEqual(['DE']);
    expect(by.profit.tone).toBe('danger');
  });
});

describe('KPI và ROAS', () => {
  it('tính CPI, ROAS, eCPM; chia 0 → null', () => {
    const k = kpisOf([row({ spend: 100, installs: 50, revenue: 80, adImpressions: 20000 }), row({ country: 'VN', spend: 0, revenue: 10, adImpressions: 1000 })]);
    expect(k).toMatchObject({ spend: 100, installs: 50, cpi: 2, revenue: 90, roas: 0.9 });
    expect(k.ecpm).toBeCloseTo(90 / 21);
    expect(kpisOf([]).roas).toBeNull();
    expect(delta(1.2, 1)).toBeCloseTo(0.2);
    expect(delta(1, 0)).toBeNull();
  });

  it('bảng quốc gia có ROAS kỳ trước, show rate, nước chỉ có doanh thu', () => {
    const cur = [row({ spend: 100, revenue: 120, adImpressions: 400, matched: 1000, adClicks: 8 }), row({ country: 'VN', revenue: 5 })];
    const prev = [row({ date: '2026-10-09', spend: 100, revenue: 100 })];
    const s = countryStats(cur, prev, []);
    const us = s.find((x) => x.country === 'US')!;
    expect(us.roas).toBeCloseTo(1.2);
    expect(us.prevRoas).toBeCloseTo(1);
    expect(us.showRate).toBeCloseTo(0.4);
    expect(us.ctr).toBeCloseTo(0.02);
    expect(s.find((x) => x.country === 'VN')!.roas).toBeNull();
  });

  it('chuỗi ngày đủ mọi ngày kể cả ngày trống', () => {
    const d = dailyOf([row({ date: '2026-10-12', spend: 5 })], '2026-10-11', '2026-10-13');
    expect(d.map((x) => x.spend)).toEqual([0, 5, 0]);
  });

  it('trung vị', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('cảnh báo', () => {
  const today = '2026-10-18';
  const days = (n: number, f: (date: string, i: number) => Partial<DayRow>) =>
    Array.from({ length: n }, (_, i) => {
      const date = addDays(today, -(i + 1));
      return row({ date, ...f(date, i) });
    });
  const run = (rows: DayRow[], extra: Partial<Parameters<typeof evaluateAlerts>[0]> = {}) =>
    evaluateAlerts({ rows, today, prefs: DEFAULT_ALERT_PREFS, roasTargets: {}, tcpi: {}, ...fmt, ...extra });

  it('CTR > 8% với ≥ 1.000 impressions → đỏ; ít traffic thì im', () => {
    expect(run(days(7, () => ({ adImpressions: 200, adClicks: 20, matched: 300 })))[0]).toMatchObject({ rule: 'ctr', level: 'danger' });
    expect(run(days(7, () => ({ adImpressions: 100, adClicks: 20, matched: 120 })))).toEqual([]);
  });

  it('show rate < 40% → vàng', () => {
    const a = run(days(7, () => ({ adImpressions: 300, matched: 1000, adClicks: 3 })));
    expect(a.map((x) => x.rule)).toEqual(['showRate']);
  });

  it('eCPM hôm qua < 70% trung vị 7 ngày → vàng', () => {
    const rows = days(8, (_, i) => ({ adImpressions: 2000, matched: 2500, revenue: i === 0 ? 4 : 10 }));
    expect(run(rows).map((x) => x.rule)).toEqual(['ecpmDrop']);
  });

  it('chi phí hôm nay > 2× trung vị → vàng', () => {
    const rows = [...days(7, () => ({ spend: 30 })), row({ date: today, spend: 70 })];
    expect(run(rows).map((x) => x.rule)).toEqual(['spendSpike']);
  });

  it('ROAS 7 ngày dưới ngưỡng app → đỏ; dưới mức chi tối thiểu thì im', () => {
    const rows = days(7, () => ({ spend: 20, revenue: 10 }));
    expect(run(rows, { roasTargets: { a: 0.8 } }).map((x) => x.rule)).toEqual(['roasLow']);
    expect(run(days(7, () => ({ spend: 5, revenue: 1 })), { roasTargets: { a: 0.8 } })).toEqual([]);
  });

  it('CPI 3 ngày > tCPI × 1,3 → vàng', () => {
    const rows = days(3, () => ({ spend: 30, installs: 10 })); // CPI 3
    expect(run(rows, { tcpi: { 'a|US': 2 } }).map((x) => x.rule)).toEqual(['cpiHigh']);
    expect(run(rows, { tcpi: { 'a|US': 2.5 } })).toEqual([]);
  });
});

describe('AdMob mediation report', () => {
  it('đọc header/row/footer, BigInt micros, ngày YYYYMMDD', () => {
    const r = parseMediation(
      [
        { header: { localizationSettings: { currencyCode: 'USD' } } },
        { row: { dimensionValues: { DATE: { value: '20261017' }, APP: { value: 'ca-app-pub-1~2' }, COUNTRY: { value: 'US' }, FORMAT: { value: 'REWARDED' }, AD_SOURCE: { value: '5450213213286189855', displayLabel: 'AdMob Network' } },
          metricValues: { ESTIMATED_EARNINGS: { microsValue: '12345678' }, IMPRESSIONS: { integerValue: '1000' }, AD_REQUESTS: { integerValue: '1500' }, MATCHED_REQUESTS: { integerValue: '1400' }, CLICKS: { integerValue: '12' } } } },
        { footer: { matchingRowCount: '1' } },
      ],
      'USD',
    );
    expect(r.rows).toEqual([{ date: '2026-10-17', admobAppId: 'ca-app-pub-1~2', country: 'US', format: 'REWARDED', adSource: 'AdMob Network', earningsMicros: 12345678, impressions: 1000, requests: 1500, matched: 1400, clicks: 12, currency: 'USD' }]);
    expect(publisherOf('ca-app-pub-3940256099942544~3347511713')).toBe('pub-3940256099942544');
    expect(publisherOf('sai')).toBeNull();
  });
});

describe('CSV', () => {
  it('có BOM, escape dấu phẩy/ngoặc kép', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'He said "hi"'], [1, null]])).toBe('﻿a,b\r\n"x,y","He said ""hi"""\r\n1,');
  });
});

describe('ad unit', () => {
  it('parse báo cáo AD_UNIT, gộp dòng trùng khóa, lấy tên unit', () => {
    const dv = (unit: string) => ({ DATE: { value: '20261017' }, APP: { value: 'ca-app-pub-1~2' }, AD_UNIT: { value: unit, displayLabel: 'Rewarded_Home' }, COUNTRY: { value: 'US' }, FORMAT: { value: 'REWARDED' } });
    const mv = { ESTIMATED_EARNINGS: { microsValue: '1500000' }, IMPRESSIONS: { integerValue: '100' }, AD_REQUESTS: { integerValue: '200' }, MATCHED_REQUESTS: { integerValue: '150' }, CLICKS: { integerValue: '3' } };
    const rows = parseUnits([{ header: { localizationSettings: { currencyCode: 'USD' } } }, { row: { dimensionValues: dv('ca-app-pub-1/9'), metricValues: mv } }, { row: { dimensionValues: dv('ca-app-pub-1/9'), metricValues: mv } }, { footer: {} }], 'USD');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adUnitId: 'ca-app-pub-1/9', adUnitName: 'Rewarded_Home', date: '2026-10-17', earningsMicros: 3000000, impressions: 200, requests: 400, clicks: 6 });
  });

  it('cờ: fill thấp, show rate thấp, CTR cao, eCPM tụt', () => {
    const k = (rev: number, imp: number, matched: number, req: number, clicks = 0) => kpisFromTotals({ spend: 0, installs: 0, revenue: rev, adImpressions: imp, matched, requests: req, adClicks: clicks });
    const flags = (cur: ReturnType<typeof k>, prev = k(0, 0, 0, 0)) => unitFlags(cur, prev, fmt.fmtPct, fmt.fmtMoney).map((f) => f.message.split(' ')[0] + ' ' + f.level);
    expect(flags(k(10, 3000, 3500, 20000))).toEqual(['Fill danger']);
    expect(flags(k(10, 1000, 9000, 10000))).toEqual(['Show warning']);
    expect(flags(k(10, 2000, 2500, 3000, 300))).toEqual(['CTR danger']);
    expect(flags(k(2, 2000, 2500, 3000), k(5, 2000, 2500, 3000))).toEqual(['eCPM warning']);
    expect(flags(k(1, 100, 200, 300))).toEqual([]); // ít traffic thì im
  });
});

describe('ad unit × nguồn', () => {
  it('parse gộp theo (ngày, unit, tên nguồn)', () => {
    const r = (src: string) => ({ row: {
      dimensionValues: { DATE: { value: '20261017' }, APP: { value: 'ca-app-pub-1~2' }, AD_UNIT: { value: 'ca-app-pub-1/9' }, AD_SOURCE: { value: src, displayLabel: 'Meta Audience Network (bidding)' } },
      metricValues: { ESTIMATED_EARNINGS: { microsValue: '1000000' }, IMPRESSIONS: { integerValue: '10' }, AD_REQUESTS: { integerValue: '50' }, MATCHED_REQUESTS: { integerValue: '20' }, CLICKS: { integerValue: '1' } },
    } });
    const rows = parseUnitSources([r('111'), r('222')], 'USD');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adSource: 'Meta Audience Network (bidding)', earningsMicros: 2000000, requests: 100 });
  });

  it('cờ nguồn: fill ~0, show thấp, kéo eCPM unit, phụ thuộc một nguồn', () => {
    const k = (rev: number, imp: number, matched: number, req: number) => kpisFromTotals({ spend: 0, installs: 0, revenue: rev, adImpressions: imp, matched, requests: req });
    const none = k(0, 0, 0, 0);
    const msgs = (cur: ReturnType<typeof k>, unit: ReturnType<typeof k>) => sourceFlags(cur, none, unit, fmt.fmtPct, fmt.fmtMoney).map((f) => f.message.split(' ')[0]);
    const unit = k(100, 50000, 60000, 100000);
    expect(msgs(k(0.1, 100, 150, 10000), unit)).toEqual(['Fill']);
    expect(msgs(k(5, 1000, 4000, 8000), unit)).toEqual(['Show']);
    expect(msgs(k(20, 25000, 30000, 40000), unit)).toEqual(['Chiếm']); // 50% hiển thị, eCPM 0,8 < 60% của 2
    expect(msgs(k(90, 20000, 25000, 30000), unit)).toEqual(['Chiếm']); // 90% doanh thu
  });
});

describe('kỳ “từ trước đến nay”', () => {
  it('từ ngày đầu có dữ liệu đến hôm qua; chưa có dữ liệu thì 30 ngày', async () => {
    const { resolveRange, rangeDays } = await import('@shared/analytics');
    expect(resolveRange('all', '2026-10-18', '2024-03-05')).toMatchObject({ from: '2024-03-05', to: '2026-10-17' });
    expect(resolveRange('all', '2026-10-18', null)).toMatchObject({ from: '2026-09-18', to: '2026-10-17' });
    expect(rangeDays('all')).toBeNull();
    expect(rangeDays('last14')).toBe(14);
  });
});
