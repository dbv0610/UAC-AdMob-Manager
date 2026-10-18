import { describe, expect, it } from 'vitest';
import { budgetPacing, campaignFlags, creativeFlags } from '@shared/health';
import type { CampaignRow } from '@shared/types';
import type { Creative } from '@shared/creative';

const camp = (p: Partial<CampaignRow>): CampaignRow => ({
  id: '1', customerId: 'c', name: 'x', status: 'ENABLED', country: 'US', goalType: null, appId: null, budgetResource: 'b', budgetMicros: 10e6,
  budgetShared: false, targetCpaMicros: 1e6, targetRoas: null, costMicros: 35e6, conversions: 40, impressions: 1000, ...p,
});
const levels = (c: CampaignRow, pending = 0) => campaignFlags(c, 7, pending).map((f) => `${f.level}:${f.message.split(' ')[0]}`);

describe('cờ camp', () => {
  it('khỏe thì không có cờ', () => expect(levels(camp({}))).toEqual([]));
  it('bật mà không tiêu', () => expect(levels(camp({ costMicros: 0, conversions: 0 }))).toEqual(['warning:Đang']));
  it('chi nhiều không có chuyển đổi → đỏ', () => expect(levels(camp({ costMicros: 30e6, conversions: 0 }))).toEqual(['danger:Chi']));
  it('CPA vượt tCPI 30% khi đủ 10 chuyển đổi', () => {
    expect(levels(camp({ costMicros: 30e6, conversions: 20 }))).toEqual(['warning:CPA']);
    expect(levels(camp({ costMicros: 15e6, conversions: 5 }))).toEqual([]); // ít chuyển đổi thì im
  });
  it('chạm trần ngân sách, ngân sách chung, đề xuất chờ', () => {
    expect(levels(camp({ costMicros: 69e6, conversions: 69 }), 2)).toEqual(['info:Tiêu', 'info:2']);
    expect(levels(camp({ budgetShared: true }))).toEqual(['info:Ngân']);
    expect(budgetPacing(camp({ costMicros: 35e6 }), 7)).toBeCloseTo(0.5);
  });
});

const cr = (p: Partial<Creative>): Creative => ({
  id: 'a', source: 'file', appId: null, name: 'v.mp4', path: '/v.mp4', kind: 'video', durationS: 30, width: 1920, height: 1080, aspect: 'landscape',
  sizeBytes: 1, countries: [], youtubeId: 'abc', status: 'READY', privacy: 'unlisted', error: null, linkedCustomers: 1, createdAt: '', ...p,
});
describe('cờ creative', () => {
  it('sẵn sàng + đã gắn thì sạch', () => expect(creativeFlags(cr({}))).toEqual([]));
  it('lỗi, bị khóa, thiếu tỉ lệ, quá ngắn, chưa gắn, chưa upload', () => {
    expect(creativeFlags(cr({ status: 'FAILED', error: { message: 'x', code: 'E' } as never }))[0]).toMatchObject({ level: 'danger', message: 'x' });
    expect(creativeFlags(cr({ status: 'LOCKED' }))[0].level).toBe('danger');
    expect(creativeFlags(cr({ aspect: null }))[0].level).toBe('warning');
    expect(creativeFlags(cr({ durationS: 6 }))[0].message).toMatch(/10 giây/);
    expect(creativeFlags(cr({ linkedCustomers: 0 }))[0].level).toBe('info');
    expect(creativeFlags(cr({ status: 'LOCAL', youtubeId: null }))[0].message).toMatch(/Chưa upload/);
  });
});
