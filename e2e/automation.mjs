// AI dịch + Cài đặt AI + video LOW trên app thật: node e2e/automation.mjs <thư mục ra>
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
db.prepare(`INSERT INTO ads_customers VALUES ('1234567890', '9999999999', 'ads:test', 'Test Ads', 'USD', 'Asia/Ho_Chi_Minh', 0, 1)`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, ads_customer_id) VALUES ('app1', 'StreamWave', 'GOOGLE_PLAY', 'com.streamwave.tv', '1234567890')`).run();
// Bản nháp wizard: US (tiếng Anh, có text) + JP + BR + VN, đang ở bước Cấu hình
const row = (countryCode, languages, text) => ({
  countryCode, languages, dailyBudget: 20, goal: 'INSTALLS_TCPI', target: 1.5, conversionActions: [],
  headlines: text ? ['Watch free movies', 'Fast HD player'] : [''], descriptions: text ? ['Thousands of movies in HD, no annoying ads.'] : [''],
  videoIds: [], imageAssetIds: [],
});
const draft = { id: 'd1', appId: 'app1', customerId: '1234567890', rows: [row('US', ['en'], true), row('JP', ['ja']), row('BR', ['pt']), row('VN', ['vi'])], step: 2, updatedAt: new Date().toISOString() };
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('planDraft', ?)`).run(JSON.stringify(draft));
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(JSON.stringify({ ...prefs, onboardingDone: true, currentAppId: 'app1', currentAdsCustomerId: '1234567890' }));
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForSelector('role=tab[name="Danh sách"]', { timeout: 15000 });
await page.getByRole('tab', { name: 'Tạo kế hoạch' }).click();
await page.waitForSelector('text=Dịch text bằng AI');

// Chưa có key → dialog chỉ đường tới Cài đặt
await page.getByLabel('Chọn tất cả dòng').check();
await page.getByRole('button', { name: 'Dịch text bằng AI' }).first().click();
await page.waitForSelector('text=Cần nhập API key Claude');
await page.screenshot({ path: `${out}/translate-nokey.png` });
await page.getByRole('button', { name: 'Mở Cài đặt → AI' }).click();
await page.getByRole('tab', { name: 'AI' }).click();
await page.getByLabel('API key Claude').fill('abc');
await page.getByRole('button', { name: 'Lưu key' }).click();
const keyError = await page.locator('[role=alert]').first().textContent();
await page.getByLabel('API key Claude').fill('sk-ant-api03-' + 'x'.repeat(40));
await page.getByRole('button', { name: 'Lưu key' }).click();
await page.waitForSelector('text=Đã lưu');
await page.screenshot({ path: `${out}/settings-ai.png` });
const status = await page.evaluate(() => window.api.secrets.status());

// Có key → bước chọn nguồn + ngôn ngữ đích (không gọi API thật)
await page.getByRole('button', { name: 'Campaigns' }).first().click();
await page.getByRole('tab', { name: 'Tạo kế hoạch' }).click();
await page.getByLabel('Chọn tất cả dòng').check();
await page.getByRole('button', { name: 'Dịch text bằng AI' }).first().click();
await page.waitForSelector('text=Dịch sang (ngôn ngữ chính');
await page.screenshot({ path: `${out}/translate-config.png` });
const targetLangs = await page.locator('label:has(input[type=checkbox])').filter({ hasText: '·' }).allTextContents();
const btn = await page.getByRole('button', { name: /^Dịch sang \d+ ngôn ngữ/ }).textContent();
await page.keyboard.press('Escape');

// Creatives → Video hiệu quả thấp (chưa quét)
await page.getByRole('button', { name: 'Creatives' }).first().click();
await page.getByRole('tab', { name: 'Thay video LOW' }).click();
await page.waitForSelector('text=Chưa quét');
await page.screenshot({ path: `${out}/low-videos.png` });
await app.close();

console.log(JSON.stringify({ keyError, aiKey: status.aiKey, targetLangs, btn, errors }, null, 2));
