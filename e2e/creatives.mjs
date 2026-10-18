// Thư viện creative trên app thật với video mẫu tạo bằng ffmpeg: node e2e/creatives.mjs <thư mục ra>
import { _electron as electron } from 'playwright';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const out = path.resolve(process.argv[2] ?? 'e2e/out');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-e2e-'));
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-media-'));
const env = { ...process.env, UAC_USER_DATA: userData };

// Video mẫu: ngang (US), dọc (VN, file quay dọc có cờ xoay), vuông (dùng chung), 1 ảnh, 1 file rác
const mk = (name, size, color, extra = []) =>
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=3`, '-f', 'lavfi', '-i', 'sine=d=3', '-shortest', ...extra, path.join(media, name)]);
mk('promo_US_v1.mp4', '640x360', 'royalblue');
mk('promo_VN_tall.mp4', '360x640', 'deeppink');
mk('promo_square.mp4', '400x400', 'orange');
fs.mkdirSync(path.join(media, 'sub'));
mk('sub/promo_US_JP_v2.mp4', '360x640', 'seagreen');
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=purple:s=1200x628', '-frames:v', '1', path.join(media, 'banner_BR.png')]);
fs.writeFileSync(path.join(media, 'notes.txt'), 'không phải video');

let app = await electron.launch({ args: ['.'], env });
await (await app.firstWindow()).waitForSelector('text=Kết nối tài khoản', { timeout: 15000 });
await app.close();
const db = new Database(path.join(userData, 'app.db'));
db.prepare(`INSERT INTO apps (id, name, store, store_app_id) VALUES ('app1', 'StreamWave', 'GOOGLE_PLAY', 'com.streamwave.tv')`).run();
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(JSON.stringify({ ...prefs, onboardingDone: true, currentAppId: 'app1' }));
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForSelector('role=tab[name="Danh sách"]', { timeout: 15000 });
await page.getByRole('link', { name: 'Creatives' }).or(page.getByRole('button', { name: 'Creatives' })).first().click();
await page.waitForSelector('text=Thư viện trống');
await page.screenshot({ path: `${out}/creatives-empty.png` });

// Kéo thả = importPaths với đường dẫn thật (hộp thoại hệ điều hành không tự động hóa được)
const r1 = await page.evaluate((p) => window.api.creatives.importPaths({ paths: [p], appId: 'app1' }), media);
const r2 = await page.evaluate((p) => window.api.creatives.importPaths({ paths: [p], appId: 'app1' }), media); // lần 2: toàn bộ trùng
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/creatives-library.png` });

const list = await page.evaluate(() => window.api.creatives.list());
const by = Object.fromEntries(list.map((c) => [c.name, c]));
const thumbs = fs.readdirSync(path.join(userData, 'thumbs')).length;
const thumbOk = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('uac-thumb:') && i.naturalWidth > 0).length);

// Chọn 2 video bằng click + shift-click → gán quốc gia
const cards = page.getByRole('checkbox', { name: /promo_/ });
await cards.nth(0).click();
await cards.nth(1).click({ modifiers: ['Shift'] });
await page.screenshot({ path: `${out}/creatives-selected.png` });
await page.getByRole('button', { name: 'Gán quốc gia' }).click();
await page.getByRole('radio', { name: 'Thêm vào quốc gia đang có' }).check();
await page.getByLabel('Tìm quốc gia').fill('thai');
await page.getByLabel('Tìm quốc gia').press('Enter');
await page.screenshot({ path: `${out}/creatives-countries-dialog.png` });
await page.getByRole('button', { name: 'Lưu' }).click();
await page.waitForTimeout(300);

// Nhập ID YouTube tay (không có tài khoản YouTube → READY ngay)
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Nhập ID YouTube' }).click();
await page.getByLabel('Link hoặc ID (mỗi dòng một video)').fill('https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/shorts/aBcDeFgHiJk\nsai-link');
await page.getByLabel('Tỉ lệ khung hình').selectOption('portrait');
await page.getByLabel('Tìm quốc gia').fill('VN');
await page.getByLabel('Tìm quốc gia').press('Enter');
await page.screenshot({ path: `${out}/creatives-manual-dialog.png` });
await page.getByRole('button', { name: /^Thêm 2 video/ }).click();
await page.waitForTimeout(400);

// Upload: chưa có tài khoản YouTube → hộp thoại hướng dẫn đăng nhập, nút Upload bị khóa
await page.getByRole('checkbox', { name: 'promo_US_v1' }).click();
await page.getByRole('button', { name: /Upload video/ }).click();
await page.screenshot({ path: `${out}/creatives-upload-dialog.png` });
const uploadDisabled = await page.getByRole('button', { name: /^Upload 1 video/ }).isDisabled();
await page.keyboard.press('Escape');

await page.getByRole('tab', { name: /Ma trận/ }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/creatives-matrix.png` });
const missingText = await page.locator('text=/ô thiếu video/').first().textContent().catch(() => null);

// Thư viện → wizard: chọn video cho dòng VN
await page.evaluate(() => window.api.plans.saveDraft({ id: crypto.randomUUID(), appId: 'app1', customerId: null, rows: [], step: 0, updatedAt: new Date().toISOString() }));
const final = await page.evaluate(() => window.api.creatives.list());
await app.close();

const result = {
  import1: r1,
  import2: r2,
  count: final.length,
  aspects: Object.fromEntries(list.map((c) => [c.name, `${c.aspect} ${c.width}x${c.height} ${c.countries.join(',')}`])),
  thumbsOnDisk: thumbs,
  thumbsRendered: thumbOk,
  usJpCountries: by['promo_US_JP_v2']?.countries,
  thaiAdded: final.filter((c) => c.countries.includes('TH')).length,
  manual: final.filter((c) => c.source === 'youtube').map((c) => `${c.youtubeId} ${c.status} ${c.aspect} ${c.countries}`),
  uploadDisabled,
  missingText,
  errors,
};
console.log(JSON.stringify(result, null, 2));
fs.rmSync(media, { recursive: true, force: true });
