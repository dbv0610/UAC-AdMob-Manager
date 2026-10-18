import { describe, expect, it } from 'vitest';
import { PushListingSchema, checkImage, checkListing, diffListings, imageTarget, normalizeLang, playLength, textsFromRows, type ListingText } from '@shared/listing';

const t = (language: string, over: Partial<ListingText> = {}): ListingText => ({
  language,
  title: 'StreamWave Player',
  shortDescription: 'Watch movies and TV shows in HD on any device.',
  fullDescription: 'Thousands of movies.',
  video: '',
  ...over,
});

describe('mã ngôn ngữ Play', () => {
  it('chuẩn hóa mã ISO, Android, Apple về mã Play', () => {
    expect(normalizeLang('ja')).toBe('ja-JP');
    expect(normalizeLang('pt_PT')).toBe('pt-PT');
    expect(normalizeLang('values-zh-rTW')).toBe('zh-TW');
    expect(normalizeLang('he')).toBe('iw-IL');
    expect(normalizeLang('vi-VN')).toBe('vi');
    expect(normalizeLang('es-MX')).toBe('es-419');
    expect(normalizeLang('de-AT')).toBe('de-DE');
    expect(normalizeLang('EN-gb')).toBe('en-GB');
    expect(normalizeLang('xx')).toBeNull();
  });
});

describe('kiểm tra text', () => {
  it('đếm ký tự kiểu Play (CJK = 1, emoji = 1)', () => {
    expect(playLength('映画を見る')).toBe(5);
    expect(playLength('🎬 Film')).toBe(6);
  });
  it('lỗi trống và quá giới hạn chặn đẩy', () => {
    const issues = checkListing(t('en-US', { title: 'A'.repeat(31), shortDescription: '' }));
    expect(issues).toContainEqual({ field: 'title', level: 'error', message: 'Dài 31/30' });
    expect(issues).toContainEqual({ field: 'shortDescription', level: 'error', message: 'Đang trống' });
  });
  it('cảnh báo chính sách metadata', () => {
    const msgs = checkListing(t('en-US', { title: 'BEST FREE PLAYER 🎬' })).map((i) => i.message);
    expect(msgs).toContain('Có emoji — Play hay từ chối');
    expect(msgs).toContain('Viết hoa toàn bộ');
    expect(msgs.some((m) => m.includes('BEST'))).toBe(true);
    expect(checkListing(t('en-US'))).toEqual([]);
    expect(checkListing(t('ja-JP', { shortDescription: 'HDで映画を見る' }))).toEqual([]); // CJK không có chữ hoa
  });
  it('video phải là link YouTube', () => {
    expect(checkListing(t('en-US', { video: 'https://vimeo.com/1' }))[0]).toMatchObject({ field: 'video', level: 'error' });
    expect(checkListing(t('en-US', { video: 'https://youtu.be/dQw4w9WgXcQ' }))).toEqual([]);
  });
});

describe('so sánh bản nháp với Play', () => {
  it('tách thêm mới / sửa / xóa', () => {
    const before = [t('en-US'), t('ja-JP'), t('de-DE')];
    const after = [t('en-US'), t('ja-JP', { title: 'ストリームウェーブ' }), t('vi')];
    expect(diffListings(before, after)).toEqual({ added: ['vi'], changed: ['ja-JP'], removed: ['de-DE'] });
  });
});

describe('đọc file Excel', () => {
  it('nhận tiêu đề cột linh hoạt, chuẩn hóa mã, báo dòng lỗi', () => {
    const rows = [
      ['Locale', 'Title', 'Short description', 'Full description'],
      ['ja', 'タイトル', '短い説明', '長い説明\r\n2行目'],
      ['', '', '', ''],
      ['klingon', 'x', 'y', 'z'],
      ['ja-JP', 'trùng', 'y', 'z'],
    ];
    const { texts, errors } = textsFromRows(rows);
    expect(texts).toEqual([{ language: 'ja-JP', title: 'タイトル', shortDescription: '短い説明', fullDescription: '長い説明\n2行目', video: '' }]);
    expect(errors).toEqual(['Dòng 4: Play không hỗ trợ ngôn ngữ “klingon”', 'Dòng 5: ja-JP trùng với dòng 2']);
  });
  it('thiếu cột bắt buộc', () => {
    expect(textsFromRows([['language', 'title']]).errors[0]).toContain('shortDescription');
  });
});

describe('thư mục ảnh', () => {
  it('đọc <ngôn ngữ>/<loại>/<file> và <ngôn ngữ>/<loại>.png', () => {
    expect(imageTarget('ja/phone/01.png')).toEqual({ language: 'ja-JP', type: 'phoneScreenshots' });
    expect(imageTarget('en-US/tenInchScreenshots/a.jpg')).toEqual({ language: 'en-US', type: 'tenInchScreenshots' });
    expect(imageTarget('vi/icon.png')).toEqual({ language: 'vi', type: 'icon' });
    expect(imageTarget('vi/feature-graphic.jpeg')).toEqual({ language: 'vi', type: 'featureGraphic' });
    expect(imageTarget('readme.png')).toBeNull();
    expect(imageTarget('vi/phone/notes.txt')).toBeNull();
    expect(imageTarget('vi/random/01.png')).toBeNull();
  });
  it('kiểm tra kích thước theo loại', () => {
    expect(checkImage('icon', { width: 512, height: 512, sizeBytes: 200_000 })).toEqual([]);
    expect(checkImage('icon', { width: 1024, height: 1024, sizeBytes: 2_000_000 })).toEqual(['Cần 512×512, ảnh là 1024×1024', 'Tối đa 1 MB']);
    expect(checkImage('phoneScreenshots', { width: 1080, height: 2400, sizeBytes: 1 })).toEqual(['Tỉ lệ tối đa 2:1']);
    expect(checkImage('phoneScreenshots', { width: 1080, height: 1920, sizeBytes: 1 })).toEqual([]);
  });
});

describe('schema đẩy lên Play', () => {
  const base = { accountId: 'play:1', packageName: 'com.streamwave.tv', upsert: [t('ja-JP')], remove: [], images: [], sendForReview: true };
  it('nhận request hợp lệ, cắt khoảng trắng', () => {
    const r = PushListingSchema.parse({ ...base, upsert: [t('ja-JP', { title: '  Stream  ' })] });
    expect(r.upsert[0].title).toBe('Stream');
  });
  it('chặn package name sai, ngôn ngữ lạ, text quá dài', () => {
    expect(PushListingSchema.safeParse({ ...base, packageName: 'streamwave' }).success).toBe(false);
    expect(PushListingSchema.safeParse({ ...base, remove: ['ja'] }).success).toBe(false);
    expect(PushListingSchema.safeParse({ ...base, upsert: [t('ja-JP', { shortDescription: 'x'.repeat(81) })] }).success).toBe(false);
  });
});
