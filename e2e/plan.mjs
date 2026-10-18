// Chạy wizard tạo kế hoạch trên app thật với dữ liệu mẫu: node e2e/plan.mjs <thư mục ra>
import { _electron as electron } from 'playwright';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? 'e2e/out';
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-e2e-'));
const env = { ...process.env, UAC_USER_DATA: userData };

// Lần 1: để app tạo DB + migration; sau đó cài dữ liệu mẫu (customer, app, prefs)
let app = await electron.launch({ args: ['.'], env });
await (await app.firstWindow()).waitForSelector('text=Kết nối tài khoản', { timeout: 15000 });
await app.close();
const db = new Database(path.join(userData, 'app.db'));
db.prepare(`INSERT INTO ads_customers (customer_id, login_customer_id, account_id, name, currency, time_zone, manager, level)
  VALUES ('1234567890', '9999999999', 'ads:test', 'Test Ads', 'USD', 'Asia/Ho_Chi_Minh', 0, 1)`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, admob_app_id, ads_customer_id) VALUES ('app1', 'StreamWave', 'GOOGLE_PLAY', 'com.streamwave.tv', NULL, '1234567890')`).run();
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(
  JSON.stringify({ ...prefs, onboardingDone: true, currentAdsCustomerId: '1234567890', currentAppId: 'app1' }),
);
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
await page.waitForSelector('role=tab[name="Danh sách"]', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/campaigns-list-error.png` }); // chưa có token thật → banner lỗi có nút

await page.getByRole('tab', { name: 'Tạo kế hoạch' }).click();
await page.getByRole('radio', { name: /StreamWave/ }).click();
await page.screenshot({ path: `${out}/wizard-1-app.png` });
await page.getByRole('button', { name: 'Tiếp' }).click();
await page.getByRole('button', { name: /^SEA/ }).click();
await page.getByLabel('Tìm quốc gia').fill('an do');
await page.getByLabel('Tìm quốc gia').press('Enter');
await page.screenshot({ path: `${out}/wizard-2-countries.png` });
await page.getByRole('button', { name: 'Tiếp' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/wizard-3-grid-errors.png` });

// Sửa hàng loạt: chọn tất cả → ngân sách 20, mục tiêu tCPI 1.5; text cho mọi dòng
await page.getByLabel('Chọn tất cả dòng').check();
await page.getByLabel('Ngân sách cho các dòng chọn').fill('20');
await page.getByLabel('Mục tiêu cho các dòng chọn').selectOption('INSTALLS_TCPI');
await page.getByLabel('Target cho các dòng chọn').fill('1.5');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByLabel('Tiêu đề 1', { exact: true }).fill('Xem phim miễn phí mỗi ngày');
await page.getByRole('button', { name: 'Thêm tiêu đề' }).click();
await page.getByLabel('Tiêu đề 2', { exact: true }).fill('Ứng dụng xem phim nhanh nhất cho bạn'); // 35 ký tự → lỗi
await page.getByLabel('Mô tả 1', { exact: true }).fill('Hàng nghìn phim, chất lượng HD, không quảng cáo làm phiền.');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/wizard-3-grid-bulk.png` });
await page.getByLabel('Tiêu đề 2', { exact: true }).fill('Xem phim nhanh nhất');
// Dán cột ngân sách từ Excel vào dòng đầu
await page.getByLabel('Chọn tất cả dòng').uncheck();
await page.getByLabel('Ngân sách VN').focus();
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', '30\t1.2\n25\t1.1\n18\t0.9');
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/wizard-3-grid-ok.png` });
await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/wizard-4-review.png` });
await page.getByRole('button', { name: 'Kiểm tra với Google' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/wizard-4-validate-error.png` });

// Bản nháp còn sau khi mở lại app
await app.close();
app = await electron.launch({ args: ['.'], env });
const p2 = await app.firstWindow();
await p2.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
await p2.getByRole('tab', { name: 'Tạo kế hoạch' }).click();
await p2.waitForTimeout(500);
const draftKept = await p2.getByText('Tổng ngân sách/ngày').isVisible();
await p2.getByRole('button', { name: 'Cài đặt', exact: true }).click();
await p2.getByRole('tab', { name: 'Đặt tên' }).click();
await p2.fill('#nt', '{app}_{goal}_{foo}');
await p2.waitForTimeout(150);
await p2.screenshot({ path: `${out}/settings-naming-error.png` });
await p2.fill('#nt', '{app}_{geo}_{goal}_{yyyymmdd}_{seq}');
await p2.screenshot({ path: `${out}/settings-naming.png` });
await app.close();
console.log(JSON.stringify({ errors, draftKept, userData }, null, 2));
