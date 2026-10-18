import { describe, expect, it } from 'vitest';
import { normalizeAppName, parseStoreLink, rankAdmobCandidates } from '@shared/storeLink';

describe('đọc link cửa hàng', () => {
  it('Google Play: link chi tiết, market://, link mời thử nghiệm, package', () => {
    const gp = (id: string) => ({ store: 'GOOGLE_PLAY', storeAppId: id });
    expect(parseStoreLink('https://play.google.com/store/apps/details?id=com.streamwave.tv&hl=vi')).toEqual(gp('com.streamwave.tv'));
    expect(parseStoreLink('play.google.com/store/apps/details?id=com.a_b.c2')).toEqual(gp('com.a_b.c2'));
    expect(parseStoreLink('market://details?id=com.streamwave.tv')).toEqual(gp('com.streamwave.tv'));
    expect(parseStoreLink('https://play.google.com/apps/testing/com.streamwave.podcast')).toEqual(gp('com.streamwave.podcast'));
    expect(parseStoreLink('  com.streamwave.tv ')).toEqual(gp('com.streamwave.tv'));
  });
  it('App Store: link và ID số', () => {
    const ios = (id: string) => ({ store: 'APPLE_APP_STORE', storeAppId: id });
    expect(parseStoreLink('https://apps.apple.com/vn/app/streamwave/id1234567890')).toEqual(ios('1234567890'));
    expect(parseStoreLink('id1234567890')).toEqual(ios('1234567890'));
  });
  it('không nhận link lạ', () => {
    expect(parseStoreLink('https://example.com/?id=com.a.b')).toBeNull();
    expect(parseStoreLink('https://play.google.com/apps/internaltest/4700')).toBeNull();
    expect(parseStoreLink('streamwave')).toBeNull();
  });
});

describe('khớp app AdMob tạo tay theo tên (app chưa live)', () => {
  const apps = [
    { appId: 'ca-app-pub-1~1', name: 'Podcast Go' },
    { appId: 'ca-app-pub-1~2', name: 'Podcast Go (test)' },
    { appId: 'ca-app-pub-1~3', name: 'Radio FM' },
  ];
  it('bỏ dấu, hoa thường, ký tự đặc biệt', () => {
    expect(normalizeAppName('Đài Phát Thanh - FM!')).toBe('daiphatthanhfm');
  });
  it('trùng tên xếp trước, tên chứa nhau xếp sau, không khớp thì bỏ', () => {
    expect(rankAdmobCandidates('podcast-go', apps)).toEqual([
      { appId: 'ca-app-pub-1~1', name: 'Podcast Go', exact: true },
      { appId: 'ca-app-pub-1~2', name: 'Podcast Go (test)', exact: false },
    ]);
    expect(rankAdmobCandidates(null, apps)).toEqual([]);
  });
});
