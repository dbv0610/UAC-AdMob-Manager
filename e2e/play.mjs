// Màn Google Play trên app thật, Play API thay bằng handler giả trong main: node e2e/play.mjs <thư mục ra>
import { _electron as electron } from 'playwright';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'e2e/out');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-e2e-'));
const env = { ...process.env, UAC_USER_DATA: userData };

let app = await electron.launch({ args: ['.'], env });
await (await app.firstWindow()).waitForSelector('text=Kết nối tài khoản', { timeout: 15000 });
await app.close();

const db = new Database(path.join(userData, 'app.db'));
db.prepare(`INSERT INTO accounts (id, email, kind, scopes, refresh_token_enc, status) VALUES ('play:1', 'dev@streamwave.tv', 'play', 'https://www.googleapis.com/auth/androidpublisher', NULL, 'active')`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, admob_app_id, ads_customer_id, roas_target, icon_url) VALUES ('app1', 'StreamWave', 'GOOGLE_PLAY', 'com.streamwave.tv', NULL, NULL, NULL, 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%234f46e5"/><path d="M24 18l24 14-24 14z" fill="white"/></svg>')`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, admob_app_id, ads_customer_id, roas_target) VALUES ('app3', 'Podcast Go', 'GOOGLE_PLAY', 'com.streamwave.podcast', NULL, NULL, NULL)`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, admob_app_id, ads_customer_id, roas_target) VALUES ('app4', 'Ghi Âm Pro', 'GOOGLE_PLAY', 'com.streamwave.recorder', NULL, NULL, NULL)`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, admob_app_id, ads_customer_id, roas_target) VALUES ('app2', 'Radio FM', 'GOOGLE_PLAY', 'com.streamwave.radio', NULL, NULL, NULL)`).run();
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(JSON.stringify({ ...prefs, onboardingDone: true, currentAppId: null }));
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
await page.waitForSelector('text=Google Play'); // registerIpc đã chạy xong mới thay handler được
await app.evaluate(({ ipcMain }) => {
  const L = (language, title, short) => ({ language, title, shortDescription: short, fullDescription: `${title}\n\nFull description for ${language}.`, video: '' });
  ipcMain.removeHandler('play:pull');
  ipcMain.handle('play:pull', () => ({
    packageName: 'com.streamwave.tv',
    defaultLanguage: 'en-US',
    listings: [L('en-US', 'StreamWave Player', 'Watch movies and TV shows in HD.'), L('ja-JP', 'ストリームウェーブ', 'HDで映画を見る'), L('de-DE', 'StreamWave Player', 'Filme in HD ansehen.')],
    fetchedAt: new Date().toISOString(),
  }));
  ipcMain.removeHandler('play:images');
  ipcMain.handle('play:images', () => ({}));

  const R = (codes, status, userFraction, name) => ({ key: codes.join(','), name: name ?? `1.${codes[0]}`, versionCodes: codes, status, userFraction: userFraction ?? null, notesLanguages: ['en-US', 'vi'] });
  const tracks = [
    { track: 'production', releases: [R(['120'], 'completed'), R(['121'], 'inProgress', 0.2)] },
    { track: 'beta', releases: [R(['122'], 'completed')] },
    { track: 'internal', releases: [R(['123'], 'draft')] },
  ];
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 17 + i)).toISOString().slice(0, 10);
    const spike = i > 22 ? 0.006 : 0;
    return { date: d, crashRate: 0.009 + spike + 0.001 * Math.sin(i), userCrashRate: 0.006 + spike + 0.0008 * Math.sin(i), anrRate: 0.003, userAnrRate: 0.0022 + 0.0004 * Math.cos(i), users: 12000 + i * 50 };
  });
  const versions = [
    { versionCode: '121', userCrashRate: 0.0142, userAnrRate: 0.0021, users: 2400, lastDate: days.at(-1).date },
    { versionCode: '120', userCrashRate: 0.0058, userAnrRate: 0.0019, users: 9800, lastDate: days.at(-1).date },
    { versionCode: '119', userCrashRate: 0.0061, userAnrRate: 0.0025, users: 150, lastDate: days.at(-3).date },
  ];
  const vitals = { packageName: 'com.streamwave.tv', at: new Date().toISOString(), days, versions };
  const now = Date.now();
  const reviews = [
    { id: 'r1', author: 'Minh Anh', rating: 1, text: 'App bị văng mỗi khi mở phim ở chế độ toàn màn hình. Rất khó chịu.', language: 'vi', device: 'Galaxy A54', appVersion: '1.121', androidVersion: 34, at: new Date(now - 3600e3).toISOString(), thumbsUp: 3, reply: null, translated: null },
    { id: 'r2', author: 'John P.', rating: 5, text: 'Great player, smooth HD playback.', language: 'en', device: 'Pixel 8', appVersion: '1.120', androidVersion: 35, at: new Date(now - 86400e3).toISOString(), thumbsUp: 0, reply: { text: 'Thanks John, glad you enjoy it!', at: new Date(now - 80000e3).toISOString() }, translated: 'Trình phát tuyệt vời, phát HD mượt.' },
    { id: 'r3', author: 'Kenji', rating: 3, text: '字幕のサイズを変更したいです。', language: 'ja', device: 'Xperia 10', appVersion: '1.120', androidVersion: 33, at: new Date(now - 2 * 86400e3).toISOString(), thumbsUp: 1, reply: null, translated: 'Tôi muốn thay đổi cỡ phụ đề.' },
  ];
  const stats = { count: 3, avg: 3, unanswered: 2, lowUnanswered: 1 };
  const summary = { latest: days.at(-1), userCrash28: 0.0081, userAnr28: 0.0023, crash: 'warn', anr: 'good' };
  ipcMain.removeHandler('play:tracks');
  ipcMain.handle('play:tracks', () => tracks);
  ipcMain.removeHandler('play:vitals');
  ipcMain.handle('play:vitals', () => vitals);
  ipcMain.removeHandler('play:reviews');
  ipcMain.handle('play:reviews', () => reviews);
  ipcMain.removeHandler('apps:refreshIcons');
  ipcMain.handle('apps:refreshIcons', () => 0);
  ipcMain.removeHandler('play:resolveAccount');
  ipcMain.handle('play:resolveAccount', () => 'play:1');
  ipcMain.removeHandler('play:vitalsAlerts');
  ipcMain.handle('play:vitalsAlerts', () => ({ crash: 0.0109, anr: 0.0047, daily: true, autoHalt: false, minUsers: 200 }));
  ipcMain.removeHandler('play:replyTemplates');
  ipcMain.handle('play:replyTemplates', () => [{ id: 't1', name: 'Xin lỗi lỗi văng app', text: 'Xin lỗi vì sự cố! Đội {app} đang sửa lỗi văng app, bạn cập nhật bản mới giúp chúng tôi nhé.' }]);
  const closedTracks = [{ track: 'qa-closed', releases: [R(['15'], 'completed', null, '0.9 beta')] }, { track: 'internal', releases: [R(['16'], 'completed', null, '0.9.1')] }];
  ipcMain.removeHandler('play:overviewCached');
  ipcMain.handle('play:overviewCached', () => ({
    at: new Date().toISOString(),
    apps: [
      { appId: 'app1', name: 'StreamWave', packageName: 'com.streamwave.tv', accountId: 'play:1', stage: 'production', tracks, vitals: summary, vitalsAt: vitals.at, reviews: stats, lastListingAt: new Date(now - 7200e3).toISOString(), errors: [] },
      { appId: 'app3', name: 'Podcast Go', packageName: 'com.streamwave.podcast', accountId: 'play:1', stage: 'closed', tracks: closedTracks, vitals: null, vitalsAt: null, reviews: null, lastListingAt: null, vitalsScopeMissing: true, errors: [] },
      { appId: 'app2', name: 'Radio FM', packageName: 'com.streamwave.radio', accountId: null, stage: 'none', tracks: [], vitals: null, vitalsAt: null, reviews: null, lastListingAt: null, errors: ['Tài khoản: dev@streamwave.tv không có quyền với com.streamwave.radio. Vào Play Console → Người dùng và quyền…'] },
    ],
    reauthAccounts: ['play:1'],
  }));
});
await page.setViewportSize({ width: 1400, height: 900 });
await page.getByRole('button', { name: 'Google Play' }).first().click();
await page.waitForSelector('text=Đang rollout dở');
await page.screenshot({ path: `${out}/play-overview.png` });
await page.getByRole('radio', { name: /Đang thử nghiệm/ }).click();
await page.screenshot({ path: `${out}/play-overview-testing.png` });
await page.getByRole('radio', { name: /Tất cả/ }).click();

// Mở app từ bảng → tab Store listing (dạng bảng mọi ngôn ngữ)
// Menu xổ xuống ở sidebar: danh sách app Google Play
await page.screenshot({ path: `${out}/play-sidebar-apps.png` });
await page.getByLabel('Danh sách app Google Play').getByRole('button', { name: 'StreamWave' }).click();
await page.waitForSelector('text=Tên ứng dụng (30)');
await page.screenshot({ path: `${out}/play-listing-table.png` });

await page.getByRole('tab', { name: 'Release' }).click();
await page.waitForSelector('text=Thử nghiệm mở');
await page.screenshot({ path: `${out}/play-releases.png` });
await page.getByLabel('Tỉ lệ rollout mới').first().selectOption('50');
await page.getByRole('button', { name: 'Tăng rollout' }).first().click();
await page.waitForSelector('role=dialog');
await page.screenshot({ path: `${out}/play-release-confirm.png` });
await page.getByRole('button', { name: 'Hủy' }).click();

await page.getByRole('tab', { name: 'Vitals' }).click();
await page.waitForSelector('text=Crash rate theo ngày');
await page.screenshot({ path: `${out}/play-vitals.png`, fullPage: true });

await page.getByRole('tab', { name: 'Review' }).click();
await page.waitForSelector('text=Minh Anh');
await page.screenshot({ path: `${out}/play-reviews.png` });

await page.getByRole('tab', { name: 'Store listing' }).click();
await page.getByRole('radio', { name: 'Từng ngôn ngữ' }).click();
await page.waitForSelector('text=Tiếng Anh (Mỹ)');
await page.screenshot({ path: `${out}/play-listing-default.png` });

// Sửa tiếng Nhật quá dài + emoji, xóa tiếng Đức, thêm tiếng Việt
await page.getByRole('button', { name: /Tiếng Nhật/ }).click();
await page.getByLabel('Tên ứng dụng').fill('ストリームウェーブ 🎬 最高の無料映画プレーヤー最高の無料映画プレーヤー');
await page.screenshot({ path: `${out}/play-listing-language.png` });
await page.getByLabel('Tên ứng dụng').fill('ストリームウェーブ HD');
await page.getByRole('button', { name: /Tiếng Đức/ }).click();
await page.getByRole('button', { name: 'Xóa ngôn ngữ' }).click();
await page.getByLabel('Thêm ngôn ngữ').selectOption('vi');
await page.getByLabel('Tên ứng dụng').fill('StreamWave - Xem phim HD');
await page.getByLabel('Mô tả ngắn').fill('Xem phim và chương trình TV chất lượng HD.');
await page.getByLabel('Mô tả đầy đủ').fill('Hàng nghìn bộ phim.');
await page.getByRole('button', { name: /^Đẩy lên Play/ }).click();
await page.waitForSelector('role=dialog');
await page.screenshot({ path: `${out}/play-listing-push.png` });

// Form thêm app: dán link mời thử nghiệm của app chưa live → tên từ Play Console, AdMob gợi ý theo tên
await app.evaluate(({ ipcMain }) => {
  ipcMain.removeHandler('apps:lookup');
  ipcMain.handle('apps:lookup', () => ({
    store: 'GOOGLE_PLAY', storeAppId: 'com.streamwave.podcast', name: 'Podcast Go', iconUrl: null, admobAppId: 'ca-app-pub-123~789', adsCustomerId: null, existingId: null,
    sources: { name: 'Play Console', admobAppId: 'AdMob (khớp theo tên, app chưa liên kết store)' },
    admobCandidates: [{ appId: 'ca-app-pub-123~789', name: 'Podcast Go', exact: true }, { appId: 'ca-app-pub-123~790', name: 'Podcast Go (test)', exact: false }],
    notes: [],
  }));
});
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Cài đặt' }).first().click();
await page.getByRole('tab', { name: 'App' }).click();
await page.getByLabel('Dán link cửa hàng để tự điền').fill('https://play.google.com/apps/testing/com.streamwave.podcast');
await page.getByRole('button', { name: 'Điền tự động' }).click();
await page.waitForSelector('text=Tên từ Play Console');
await page.screenshot({ path: `${out}/settings-app-lookup.png` });

await app.close();
console.log(`Ảnh chụp: ${out}`);
