import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: { isOnline: () => true }, safeStorage: {}, shell: {}, app: {}, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('electron-log/main', () => ({ default: { info() {}, warn() {}, error() {} } }));
vi.mock('../src/main/db', () => ({ db: {} }));

const { buildCountryOps, mapFailure } = await import('../src/main/services/googleAds/campaignBuilder');
const { isTransient } = await import('../src/main/services/googleAds/client');
const { newRow } = await import('@shared/plan');

const row = {
  ...newRow('IN'),
  dailyBudget: 20,
  goal: 'TROAS' as const,
  target: 1.2,
  conversionActions: ['555'],
  headlines: ['A', 'B'],
  descriptions: ['C'],
  videoIds: ['aaaaaaaaaaa', 'bbbbbbbbbbb'],
};
const input = {
  customerId: '1234567890',
  appStoreId: 'com.x',
  store: 'GOOGLE_PLAY' as const,
  name: 'x_GP_IN_tROAS_20261018_01',
  row,
  videoAssets: new Map([['aaaaaaaaaaa', 'customers/1234567890/assets/77'], ['bbbbbbbbbbb', null]]),
};

describe('buildCountryOps', () => {
  const { ops, cells, newVideos } = buildCountryOps(input);
  const entities = ops.map((o) => o.entity);

  it('chỉ tạo asset video còn thiếu, dùng lại asset đã có', () => {
    expect(entities.filter((e) => e === 'asset')).toHaveLength(1);
    expect([...newVideos.values()]).toEqual(['bbbbbbbbbbb']);
    const ad = ops.find((o) => o.entity === 'ad_group_ad')!.resource as any;
    expect(ad.ad.app_ad.youtube_videos.map((v: any) => v.asset)).toEqual(['customers/1234567890/assets/77', 'customers/1234567890/assets/-101']);
  });
  it('thứ tự: asset → budget → campaign → geo → ngôn ngữ (IN = en + hi) → ad group → ad', () => {
    expect(entities).toEqual(['asset', 'campaign_budget', 'campaign', 'campaign_criterion', 'campaign_criterion', 'campaign_criterion', 'ad_group', 'ad_group_ad']);
    const geo = ops[3].resource as any;
    expect(geo.location.geo_target_constant).toBe('geoTargetConstants/2356');
    expect((ops[5].resource as any).language.language_constant).toBe('languageConstants/1023');
  });
  it('tROAS: target_roas + selective_optimization, camp PAUSED, budget micros', () => {
    const c = ops[2].resource as any;
    expect(c.target_roas).toEqual({ target_roas: 1.2 });
    expect(c.selective_optimization.conversion_actions).toEqual(['customers/1234567890/conversionActions/555']);
    expect(c.status).toBe(3); // PAUSED
    expect(c.app_campaign_setting.bidding_strategy_goal_type).toBe(5);
    expect((ops[1].resource as any).amount_micros).toBe(20_000_000);
  });
  it('lỗi Google trỏ về đúng ô', () => {
    const fail = {
      request_id: 'req-1',
      errors: [
        { message: 'Quá dài', error_code: { string_length_error: 'TOO_LONG' }, location: { field_path_elements: [
          { field_name: 'mutate_operations', index: 7 }, { field_name: 'ad_group_ad_operation' }, { field_name: 'create' },
          { field_name: 'ad' }, { field_name: 'app_ad' }, { field_name: 'headlines', index: 1 }, { field_name: 'text' }] } },
        { message: 'tROAS sai', location: { field_path_elements: [{ field_name: 'mutate_operations', index: 2 }, { field_name: 'campaign_operation' }, { field_name: 'create' }, { field_name: 'target_roas' }] } },
        { message: 'Ngôn ngữ', location: { field_path_elements: [{ field_name: 'mutate_operations', index: 5 }] } },
        { message: 'Video', location: { field_path_elements: [{ field_name: 'mutate_operations', index: 0 }] } },
      ],
    };
    const m = mapFailure(fail, cells)!;
    expect(m.requestId).toBe('req-1');
    expect(m.errors.map((e) => e.field)).toEqual(['headlines.1', 'target', 'languages.1', 'videoIds.1']);
    expect(m.errors[0].code).toBe('string_length_error.TOO_LONG');
  });
});

describe('isTransient', () => {
  it('quota / internal thì retry, lỗi dữ liệu thì không', () => {
    expect(isTransient({ errors: [{ error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] })).toBe(true);
    expect(isTransient({ errors: [{ error_code: { field_error: 'REQUIRED' } }] })).toBe(false);
    expect(isTransient({ code: 14, message: 'unavailable' })).toBe(true);
    expect(isTransient(new Error('ECONNRESET'))).toBe(true);
  });
});

describe('lỗi API chưa bật', async () => {
  const { apiDisabledError } = await import('../src/main/services/googleAds/client');
  it('nhận ra Google Ads API chưa bật và gợi ý cách bật', () => {
    const e = apiDisabledError(new Error('7 PERMISSION_DENIED: Google Ads API has not been used in project 1053749054631 before or it is disabled. Enable it by visiting …'));
    expect(e?.info).toMatchObject({ code: 'API_DISABLED', action: 'openSettings' });
    expect(e?.info.message).toContain('Google Ads API chưa được bật trong project Google Cloud 1053749054631');
    expect(apiDisabledError(new Error('khác'))).toBeNull();
  });
});
