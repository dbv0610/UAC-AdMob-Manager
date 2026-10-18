import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: { isOnline: () => true }, safeStorage: {}, app: {} }));
vi.mock('../src/main/db', () => ({ db: {} }));
const { adsErrorCode } = await import('../src/main/services/googleAds/client');

describe('mã lỗi Google Ads (oneof)', () => {
  it('lấy nhánh có giá trị, bỏ nhánh rỗng đứng trước', () => {
    expect(adsErrorCode({ request_error: undefined, query_error: 0, authorization_error: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' })).toBe('authorization_error.CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION');
    expect(adsErrorCode({ authorization_error: 'CUSTOMER_NOT_ENABLED' })).toBe('authorization_error.CUSTOMER_NOT_ENABLED');
    expect(adsErrorCode({ a: 'UNSPECIFIED' })).toBeUndefined();
    expect(adsErrorCode(undefined)).toBeUndefined();
  });
});
