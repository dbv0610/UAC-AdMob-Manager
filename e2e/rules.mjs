// Rules trên app thật với dữ liệu mẫu: node e2e/rules.mjs <thư mục ra>
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

// ── Dữ liệu mẫu 20 ngày, 5 nước ─────────────────────────────────────────────
const db = new Database(path.join(userData, 'app.db'));
const iso = (d) => d.toLocaleDateString('en-CA');
const day = (n) => iso(new Date(Date.now() - n * 86400_000));
db.prepare(`INSERT INTO ads_customers VALUES ('1234567890', '9999999999', 'ads:test', 'Test Ads', 'USD', 'Asia/Ho_Chi_Minh', 0, 1)`).run();
db.prepare(`INSERT INTO apps (id, name, store, store_app_id, admob_app_id, ads_customer_id, roas_target) VALUES ('app1', 'StreamWave', 'GOOGLE_PLAY', 'com.streamwave.tv', 'ca-app-pub-123~456', '1234567890', 0.8)`).run();
const camps = { US: '111', VN: '222', IN: '333', BR: '444', JP: '555' };
for (const [c, id] of Object.entries(camps)) {
  db.prepare(`INSERT INTO campaign_meta (campaign_id, customer_id, name, app_id, status, target_cpa_micros, target_roas, updated_at) VALUES (?, '1234567890', ?, 'com.streamwave.tv', 'ENABLED', ?, NULL, ?)`).run(id, `streamwave_GP_${c}_tCPI`, c === 'IN' ? 200000 : 1500000, new Date().toISOString());
}
// Hồ sơ: US lời, VN hòa, IN CPI cao, BR ROAS thấp + CTR cao, JP eCPM tụt hôm qua + chi phí hôm nay tăng vọt
const prof = {
  US: { spend: 120, inst: 60, rev: 150, imp: 30000 },
  VN: { spend: 40, inst: 80, rev: 38, imp: 50000 },
  IN: { spend: 30, inst: 40, rev: 20, imp: 60000 },
  BR: { spend: 50, inst: 45, rev: 20, imp: 8000, ctr: 0.12 },
  JP: { spend: 60, inst: 20, rev: 70, imp: 9000 },
};
const insS = db.prepare(`INSERT INTO spend_daily (date, campaign_id, country, app_id, cost_micros, installs, clicks, impressions, customer_id, currency, conversions) VALUES (?, ?, ?, 'com.streamwave.tv', ?, ?, 0, 0, '1234567890', 'USD', ?)`);
const insR = db.prepare(`INSERT INTO revenue_daily (date, admob_app_id, country, format, ad_source, earnings_micros, impressions, requests, matched, clicks, currency) VALUES (?, 'ca-app-pub-123~456', ?, ?, ?, ?, ?, ?, ?, ?, 'USD')`);
for (let n = 0; n <= 20; n++) {
  const wobble = 1 + 0.15 * Math.sin(n);
  for (const [c, p] of Object.entries(prof)) {
    let spend = p.spend * wobble;
    if (c === 'JP' && n === 0) spend = p.spend * 3; // hôm nay tăng vọt
    insS.run(day(n), camps[c], c, Math.round(spend * 1e6), p.inst * wobble, p.inst * wobble);
    if (n === 0) continue; // AdMob trễ: chưa có doanh thu hôm nay
    const rev = c === 'JP' && n === 1 ? p.rev * 0.4 : p.rev * wobble;
    for (const [src, share] of [['AdMob Network', 0.6], ['Meta Audience Network', 0.25], ['Unity Ads', 0.15]]) {
      const imp = Math.round(p.imp * share);
      insR.run(day(n), c, 'REWARDED', src, Math.round(rev * share * 1e6), imp, Math.round(imp * 1.6), Math.round(imp * 1.3), Math.round(imp * (p.ctr ?? 0.01)));
    }
  }
}
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(JSON.stringify({ ...prefs, onboardingDone: true, currentAppId: 'app1', currentAdsCustomerId: '1234567890' }));
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('reportSync', ?)`).run(
  JSON.stringify({ at: new Date(Date.now() - 2 * 3600_000).toISOString(), from: day(29), to: day(0), spend: { ok: true, at: new Date().toISOString() }, revenue: { ok: false, at: null, error: 'Chưa đăng nhập tài khoản AdMob có publisher pub-123' } }),
);
// Ngân sách camp (GĐ 5) để rule chỉnh ngân sách có số
db.prepare(`UPDATE campaign_meta SET budget_micros = 50000000, budget_resource = 'customers/1234567890/campaignBudgets/' || campaign_id, budget_shared = 0`).run();
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForSelector('role=tab[name="Danh sách"]', { timeout: 15000 });
await page.getByRole('button', { name: 'Rules' }).first().click();
await page.waitForSelector('text=Chưa có rule nào');
await page.screenshot({ path: `${out}/rules-empty.png` });

// Tạo rule từ mẫu "Pause quốc gia ROAS thấp" (ngưỡng 30%) → sửa ngưỡng 50% để BR (40%) khớp
await page.getByRole('button', { name: /Dùng mẫu/ }).click();
await page.getByLabel('Giá trị 2').fill('50');
await page.getByRole('button', { name: 'Chạy thử với dữ liệu hôm nay' }).click();
await page.waitForSelector('text=/camp sẽ bị tác động/');
await page.screenshot({ path: `${out}/rules-editor-test.png` });
const testText = await page.locator('text=/camp sẽ bị tác động/').textContent();
await page.getByRole('button', { name: 'Lưu rule' }).click();
await page.waitForTimeout(300);

// Rule thứ 2: hạ tCPI từ mẫu, nhập % sai để thấy lỗi
await page.getByLabel('Tạo từ mẫu').selectOption({ index: 2 });
await page.getByLabel(/Thay đổi \(%/).fill('-35');
const blocked = await page.getByRole('button', { name: 'Lưu rule' }).isDisabled();
await page.screenshot({ path: `${out}/rules-editor-invalid.png` });
await page.getByLabel(/Thay đổi \(%/).fill('-10');
await page.getByRole('button', { name: 'Lưu rule' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/rules-list.png` });

// Chạy thật → đề xuất chờ duyệt
await page.getByRole('button', { name: 'Chạy rule ngay' }).click();
await page.waitForTimeout(1500);
const pending = await page.evaluate(() => window.api.rules.suggestions('pending'));
await page.getByRole('tab', { name: /Chờ duyệt/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/rules-pending.png` });
const badge = await page.locator('nav [aria-label$="đề xuất chờ duyệt"]').textContent().catch(() => null);

// Chạy lại không sinh trùng
await page.evaluate(() => window.api.rules.run());
await page.waitForTimeout(1200);
const pending2 = await page.evaluate(() => window.api.rules.suggestions('pending'));

// Bỏ qua 1 đề xuất; áp dụng 1 (không có tài khoản Google thật → báo lỗi, ghi failed)
await page.getByRole('button', { name: 'Bỏ qua', exact: true }).nth(1).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Áp dụng', exact: true }).first().click();
await page.waitForSelector('text=/Xem trước thay đổi/');
await page.screenshot({ path: `${out}/rules-diff.png` });
await page.getByRole('button', { name: /^Áp dụng \d+ thay đổi/ }).click();
await page.waitForTimeout(800);
await page.getByRole('tab', { name: 'Lịch sử' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/rules-history.png` });
const history = await page.evaluate(() => window.api.rules.suggestions('history'));

// Cài đặt → Tự động
await page.getByRole('button', { name: 'Cài đặt' }).first().click();
await page.getByRole('tab', { name: 'Tự động' }).click();
await page.getByLabel('Giờ chạy (giờ trên máy)').selectOption('6');
await page.screenshot({ path: `${out}/settings-automation.png` });
const prefsAfter = await page.evaluate(() => window.api.prefs.get());
await app.close();

console.log(JSON.stringify({
  testText,
  invalidBlocked: blocked,
  pending: pending.map((p) => `${p.country} ${p.change.field} ${p.change.before}→${p.change.after}`),
  pendingAfterRerun: pending2.length,
  badge,
  history: history.map((h) => `${h.status} ${h.country}${h.error ? ' (' + h.error.slice(0, 40) + ')' : ''}`),
  syncHour: prefsAfter.syncHour,
  errors,
}, null, 2));
