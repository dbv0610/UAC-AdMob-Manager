// Analytics trên app thật với dữ liệu chi phí/doanh thu mẫu: node e2e/analytics.mjs <thư mục ra>
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
const insS = db.prepare(`INSERT INTO spend_daily (date, campaign_id, country, app_id, cost_micros, installs, clicks, impressions, customer_id, currency, conversions) VALUES (?, ?, ?, 'com.streamwave.tv', ?, ?, ?, ?, '1234567890', 'USD', ?)`);
const insR = db.prepare(`INSERT INTO revenue_daily (date, admob_app_id, country, format, ad_source, earnings_micros, impressions, requests, matched, clicks, currency) VALUES (?, 'ca-app-pub-123~456', ?, ?, ?, ?, ?, ?, ?, ?, 'USD')`);
// DE: chỉ có doanh thu (organic) → gợi ý mở rộng
prof.DE = { spend: 0, inst: 0, rev: 15, imp: 4000 };
for (let n = 0; n <= 100; n++) {
  const wobble = 1 + 0.15 * Math.sin(n);
  // 30 ngày gần nhất BR xấu đi để có “ROAS giảm mạnh”
  const trend = (c) => (c === 'BR' && n >= 14 ? 2.2 : 1);
  for (const [c, p] of Object.entries(prof)) {
    let spend = p.spend * wobble;
    if (c === 'JP' && n === 0) spend = p.spend * 3; // hôm nay tăng vọt
    if (spend > 0) {
      const inst = p.inst * wobble;
      insS.run(day(n), camps[c], c, Math.round(spend * 1e6), inst, Math.round(inst * 2.5), Math.round(inst * 60), inst);
      // US có thêm camp thứ hai nhỏ
      if (c === 'US') insS.run(day(n), '666', c, Math.round(spend * 0.3e6), inst * 0.2, Math.round(inst * 0.6), Math.round(inst * 20), inst * 0.2);
    }
    if (n === 0) continue; // AdMob trễ: chưa có doanh thu hôm nay
    const rev = (c === 'JP' && n === 1 ? p.rev * 0.4 : p.rev * wobble) * trend(c);
    for (const [fmt, src, share] of [['REWARDED', 'AdMob Network', 0.45], ['INTERSTITIAL', 'AdMob Network', 0.15], ['REWARDED', 'Meta Audience Network', 0.25], ['BANNER', 'Unity Ads', 0.15]]) {
      const imp = Math.round(p.imp * share);
      insR.run(day(n), c, fmt, src, Math.round(rev * share * 1e6), imp, Math.round(imp * 1.6), Math.round(imp * 1.3), Math.round(imp * (p.ctr ?? 0.01)));
    }
  }
}
// Ad unit: 4 unit; Inter_Level fill thấp, Banner_Bottom show rate thấp, Native_List CTR cao
const units = [
  ['ca-app-pub-123/1001', 'Rewarded_Home', 'REWARDED', 0.55, 0.9, 0.85, 0.01],
  ['ca-app-pub-123/1002', 'Inter_Level', 'INTERSTITIAL', 0.25, 0.3, 0.8, 0.012],
  ['ca-app-pub-123/1003', 'Banner_Bottom', 'BANNER', 0.12, 0.85, 0.3, 0.004],
  ['ca-app-pub-123/1004', 'Native_List', 'NATIVE', 0.08, 0.8, 0.75, 0.11],
];
const insU = db.prepare(`INSERT INTO revenue_unit_daily (date, admob_app_id, ad_unit_id, ad_unit_name, country, format, earnings_micros, impressions, requests, matched, clicks, currency) VALUES (?, 'ca-app-pub-123~456', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')`);
const insUS = db.prepare(`INSERT INTO revenue_unit_source_daily (date, admob_app_id, ad_unit_id, ad_source, earnings_micros, impressions, requests, matched, clicks, currency) VALUES (?, 'ca-app-pub-123~456', ?, ?, ?, ?, ?, ?, ?, 'USD')`);
for (let n = 1; n <= 100; n++) {
  const wobble = 1 + 0.15 * Math.sin(n);
  for (const [c, p] of Object.entries(prof)) {
    for (const [id, name, fmt, share, fill, show, ctr] of units) {
      const imp = Math.round(p.imp * share * wobble);
      const matched = Math.round(imp / show);
      // Inter_Level: eCPM tụt trong 30 ngày gần nhất
      const ecpmCut = id.endsWith('1002') && n <= 30 ? 0.6 : 1;
      insU.run(day(n), id, name, c, fmt, Math.round(p.rev * share * wobble * ecpmCut * 1e6), imp, Math.round(matched / fill), matched, Math.round(imp * ctr));
    }
  }
  // Unit × nguồn: Inter_Level có nguồn Unity fill ~0 và Meta show thấp
  for (const [id, , , share] of units) {
    const totRev = Object.values(prof).reduce((s, p) => s + p.rev, 0) * share * wobble * (id.endsWith('1002') && n <= 30 ? 0.6 : 1);
    const totImp = Object.values(prof).reduce((s, p) => s + p.imp, 0) * share * wobble;
    for (const [src, rs, is, fill, show] of [['AdMob Network', 0.55, 0.45, 0.6, 0.9], ['Meta Audience Network (bidding)', 0.3, 0.25, 0.3, id.endsWith('1002') ? 0.35 : 0.85], ['AppLovin (bidding)', 0.13, 0.2, 0.25, 0.85], ['Unity Ads', 0.02, 0.1, id.endsWith('1002') ? 0.02 : 0.2, 0.8]]) {
      const imp = Math.round(totImp * is);
      const matched = Math.round(imp / show);
      insUS.run(day(n), id, src, Math.round(totRev * rs * 1e6), imp, Math.round(matched / fill), matched, Math.round(imp * 0.01));
    }
  }
}
db.prepare(`INSERT INTO campaign_meta (campaign_id, customer_id, name, app_id, status, target_cpa_micros, target_roas, updated_at, budget_micros) VALUES ('666', '1234567890', 'streamwave_GP_US_tROAS', 'com.streamwave.tv', 'PAUSED', NULL, 1.2, ?, 50000000)`).run(new Date().toISOString());
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(JSON.stringify({ ...prefs, onboardingDone: true, currentAppId: 'app1', currentAdsCustomerId: '1234567890' }));
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('reportSync', ?)`).run(
  JSON.stringify({ at: new Date(Date.now() - 2 * 3600_000).toISOString(), from: day(29), to: day(0), spend: { ok: true, at: new Date().toISOString() }, revenue: { ok: false, at: null, error: 'Chưa đăng nhập tài khoản AdMob có publisher pub-123' } }),
);
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForSelector('role=tab[name="Danh sách"]', { timeout: 15000 });
await page.getByRole('button', { name: 'Analytics' }).first().click();
await page.waitForSelector('role=heading[name="Chi phí & doanh thu"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/analytics.png`, fullPage: true });

const data = await page.evaluate(() => window.api.analytics.get('app1', 'last7'));
const shots = [];
const shot = async (name, full = false) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  shots.push(name);
};
const closeDrawer = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
};

// Thẻ KPI → biểu đồ ROAS; lũy kế; 90 ngày theo tuần
await page.getByRole('button', { name: /^ROAS/ }).first().click();
await shot('chart-roas');
await page.getByRole('radio', { name: 'Lũy kế' }).first().click();
await shot('chart-cumulative');
await page.getByLabel('Kỳ báo cáo').selectOption('last90');
await page.waitForTimeout(500);
await page.getByRole('radio', { name: 'Tuần' }).click();
await page.getByRole('radio', { name: 'Chi & thu' }).first().click();
await shot('chart-90-week', true);

// Kỳ tự chọn
await page.getByLabel('Kỳ báo cáo').selectOption('custom');
await page.getByLabel('Từ ngày').fill(day(20));
await page.getByLabel('Đến ngày').fill(day(6));
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.waitForTimeout(300);
const customText = await page.locator('text=/\\d{2}\\/\\d{2} – \\d{2}\\/\\d{2}/').first().textContent();
await page.getByLabel('Kỳ báo cáo').selectOption('last30');
await page.waitForTimeout(400);

// Cần chú ý: lọc mức độ, ẩn hôm nay, xem chi tiết một nước
const attnTitles = await page.locator('h2:has-text("Cần chú ý")').locator('xpath=../..').locator('li p.font-medium').allTextContents();
await page.getByRole('radio', { name: /^Nghiêm trọng/ }).click();
const dangerCount = await page.locator('h2:has-text("Cần chú ý")').locator('xpath=../..').locator('li').count();
await page.getByRole('radio', { name: /^Tất cả/ }).click();
await page.locator('h2:has-text("Cần chú ý")').locator('xpath=../..').locator('li').first().hover();
await page.getByRole('button', { name: 'Ẩn', exact: true }).first().click();
const snoozedText = await page.getByText(/Đã ẩn 1 mục hôm nay/).count();
await shot('attention');
await page.getByRole('button', { name: 'Xem', exact: true }).first().click();
await page.waitForSelector('aside[aria-label^="Chi tiết"]');
await shot('drawer-country-from-attention');
await closeDrawer();

// Bảng quốc gia → ngăn chi tiết, chuyển mục bằng phím
await page.getByRole('row', { name: /Brazil/ }).click();
await page.waitForSelector('aside[aria-label="Chi tiết Brazil"]');
await page.locator('aside').getByRole('radio', { name: 'ROAS' }).click();
await shot('drawer-country');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);
const afterNext = await page.locator('aside h2').first().textContent();
await page.locator('aside').getByRole('tab', { name: /^Camp/ }).click();
await shot('drawer-country-camps');
await page.locator('aside').getByRole('tab', { name: 'Kiếm tiền' }).click();
await shot('drawer-country-money');
await page.locator('aside tbody tr').first().click(); // ad unit → mở ngăn ad unit
await page.waitForTimeout(300);
const fromCountryToUnit = await page.locator('aside h2').first().textContent();
await closeDrawer();

// Các tab
const tabRows = {};
for (const t of [/^Camp/, /^Định dạng QC/, /^Nguồn QC/]) {
  await page.getByRole('tab', { name: t }).first().click();
  await page.waitForTimeout(400);
  tabRows[String(t)] = await page.locator('main tbody tr').count();
  await shot(`tab-${String(t).replace(/\W+/g, '_')}`);
}

// Camp → ngăn chi tiết camp
await page.getByRole('tab', { name: /^Camp/ }).first().click();
await page.getByRole('row', { name: /streamwave_GP_US_tCPI/ }).click();
await page.waitForSelector('aside[aria-label="Chi tiết streamwave_GP_US_tCPI"]');
await shot('drawer-campaign');
await page.locator('aside').getByRole('tab', { name: /^Quốc gia/ }).click();
await shot('drawer-campaign-countries');
await closeDrawer();

// Ad unit: bảng + cờ + ngăn chi tiết + nguồn
await page.getByRole('tab', { name: /^Ad unit/ }).first().click();
await page.waitForSelector('text=Inter_Level');
const unitFlagsText = await page.locator('main tbody tr').allTextContents();
await page.getByRole('row', { name: /Inter_Level/ }).click();
await page.waitForSelector('aside[aria-label="Chi tiết Inter_Level"]');
await page.getByRole('radiogroup', { name: 'Chỉ số ad unit' }).getByRole('radio', { name: 'eCPM' }).click();
await page.getByLabel(/Tách theo nguồn/).check();
await shot('tab-adunit');
await page.locator('aside').getByRole('tab', { name: /^Nguồn mediation/ }).click();
await page.waitForTimeout(300);
const sourceRows = await page.locator('aside tbody tr').allTextContents();
await page.locator('aside').getByRole('row', { name: /Unity Ads/ }).click();
await shot('tab-adunit-sources');
await closeDrawer();

await page.getByRole('tab', { name: /^Camp/ }).first().click();
await page.getByRole('button', { name: 'Cột' }).click();
await shot('columns-picker');
await page.mouse.click(5, 5);
await page.getByRole('tab', { name: 'Ma trận ROAS' }).click();
await page.locator('svg[aria-label="Ma trận ROAS theo chi phí"] circle').first().hover();
await shot('tab-matrix', true);
await page.getByRole('tab', { name: 'Theo ngày × nước' }).click();
await shot('tab-heat', true);
await page.getByLabel('Chỉ số bản đồ nhiệt').selectOption('profit');
await shot('tab-heat-profit');
await page.getByRole('tab', { name: /^Camp/ }).first().click();

// Xuất CSV/XLSX: thay hộp thoại lưu của main bằng đường dẫn cố định
const csvPath = path.join(userData, 'roas.csv');
const xlsxPath = path.join(userData, 'roas.xlsx');
await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, csvPath);
await page.getByRole('button', { name: /^Xuất/ }).click();
await shot('export-menu');
await page.getByRole('menuitem', { name: /CSV/ }).click();
await page.waitForTimeout(500);
await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, xlsxPath);
await page.getByRole('button', { name: /^Xuất/ }).click();
await page.getByRole('menuitem', { name: /Excel/ }).click();
await page.waitForTimeout(800);

// Cài đặt → Cảnh báo: nhập sai thì báo, sửa ngưỡng ROAS mặc định
await page.getByRole('button', { name: 'Cài đặt' }).first().click();
await page.getByRole('tab', { name: 'Cảnh báo' }).click();
await page.getByLabel(/CTR lớn hơn/).fill('abc');
await page.screenshot({ path: `${out}/settings-alerts.png` });
await page.getByLabel(/CTR lớn hơn/).fill('10');
await page.getByRole('button', { name: 'Lưu' }).click();
await page.waitForTimeout(300);
const saved = await page.evaluate(() => window.api.analytics.alertPrefs());
await app.close();

console.log(JSON.stringify({
  kpis: { spend: data.kpis.spend, roas: data.kpis.roas },
  alerts: data.alerts.map((a) => `${a.level} ${a.country} ${a.rule}`),
  csvHead: fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8').split('\r\n').slice(0, 1) : null,
  xlsxSheets: fs.existsSync(xlsxPath) ? await (async () => { const { default: ExcelJS } = await import('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsxPath); return wb.worksheets.map((w) => `${w.name}:${w.rowCount}`); })() : null,
  attnTitles,
  dangerCount,
  snoozedText,
  afterNext,
  fromCountryToUnit,
  customText,
  tabRows,
  unitRows: unitFlagsText.map((t) => t.slice(0, 120)),
  sourceRows: sourceRows.map((t) => t.slice(0, 100)),
  shots,
  savedCtr: saved.ctrMax,
  errors,
}, null, 2));
