import { describe, expect, it } from 'vitest';
import { describeChange, pacingOf, rankVideos, verdictOf, type ChangeEventRow, type VideoCampStat } from '@shared/insights';

const row = (p: Partial<VideoCampStat & { videoId: string; title: string }>) => ({
  videoId: 'v1', title: '', campaignId: 'c1', campaignName: 'x_US', country: 'US', label: 'GOOD' as const, enabled: true,
  impressions: 5000, clicks: 100, costMicros: 100e6, conversions: 50, ...p,
});

describe('hiệu quả video', () => {
  it('so CPI video với CPI chung của camp chứa nó', () => {
    // Camp c1: tổng 300$ / 150 cài = CPI 2$. v1 CPI 1$ (rẻ), v2 CPI 4$ (đắt)
    const r = rankVideos([
      row({ videoId: 'v1', costMicros: 100e6, conversions: 100 }),
      row({ videoId: 'v2', costMicros: 200e6, conversions: 50 }),
    ]);
    const v1 = r.find((x) => x.videoId === 'v1')!;
    const v2 = r.find((x) => x.videoId === 'v2')!;
    expect(v1.relCpi).toBeCloseTo(0.5);
    expect(v1.verdict).toBe('winner');
    expect(v2.relCpi).toBeCloseTo(2);
    expect(v2.verdict).toBe('loser');
    expect(r[0].videoId).toBe('v2'); // xếp theo chi phí
  });

  it('gộp nhiều camp, ít hiển thị thì đang học, nhãn LOW là thua', () => {
    const r = rankVideos([row({ campaignId: 'a' }), row({ campaignId: 'b', costMicros: 50e6, conversions: 10 })]);
    expect(r[0].campaigns).toHaveLength(2);
    expect(r[0].costMicros).toBe(150e6);
    expect(verdictOf({ impressions: 300, conversions: 0, costMicros: 1, relCpi: null, labels: ['GOOD'] })).toBe('learning');
    expect(verdictOf({ impressions: 5000, conversions: 3, costMicros: 1, relCpi: null, labels: ['LOW'] })).toBe('loser');
  });
});

describe('ngân sách tháng', () => {
  it('dự báo cuối tháng và đề xuất mỗi ngày', () => {
    // 11/10: đã qua 10 ngày, còn 21 ngày tính cả hôm nay
    const p = pacingOf({ today: '2026-10-11', budget: 3000, spent: 1000, avg7: 100, dailyBudgets: 150 });
    expect(p.daysLeft).toBe(21);
    expect(p.projected).toBe(3100);
    expect(p.projectedByBudget).toBe(1000 + 150 * 21);
    expect(p.status).toBe('on');
    expect(p.suggestedDaily).toBeCloseTo(2000 / 21);
    expect(pacingOf({ today: '2026-10-11', budget: 2000, spent: 1000, avg7: 100, dailyBudgets: 0 }).status).toBe('over');
    expect(pacingOf({ today: '2026-10-11', budget: 6000, spent: 1000, avg7: 100, dailyBudgets: 0 }).status).toBe('under');
    expect(pacingOf({ today: '2026-10-11', budget: null, spent: 1, avg7: 1, dailyBudgets: 0 }).status).toBe('none');
  });
});

describe('nhật ký thay đổi', () => {
  const ev = (p: Partial<ChangeEventRow>): ChangeEventRow => ({ id: '1', customerId: 'c', at: '', date: '2026-10-10', campaignId: '1', campaignName: 'x', resourceType: 'CAMPAIGN', operation: 'UPDATE', source: 'Web', user: null, details: [], fields: [], ...p });
  it('mô tả trước → sau, hoặc theo loại thay đổi', () => {
    const money = (m: number) => `$${m / 1e6}`;
    const pct = (v: number) => `${v * 100}%`;
    expect(describeChange(ev({ details: [{ field: 'budget', before: 10e6, after: 12e6, kind: 'money' }] }), money, pct)).toBe('Ngân sách/ngày $10 → $12');
    expect(describeChange(ev({ details: [{ field: 'status', before: 'ENABLED', after: 'PAUSED', kind: 'text' }] }), money, pct)).toBe('Trạng thái ENABLED → PAUSED');
    expect(describeChange(ev({ resourceType: 'AD_GROUP_AD', fields: ['ad.app_ad.youtube_videos'] }), money, pct)).toBe('Sửa quảng cáo (video/text) (ad.app_ad.youtube_videos)');
  });
});
