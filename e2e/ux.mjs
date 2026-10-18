// Giao diện Campaigns / Creatives / Rules (bảng + ngăn chi tiết) trên app thật: node e2e/ux.mjs <thư mục ra>
// Danh sách camp lấy từ Google Ads nên được giả lập qua IPC; còn lại là dữ liệu mẫu trong SQLite.
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
// ── Thêm cho tính năng mở rộng: nước organic (DE), nhật ký thay đổi, hiệu quả video đã quét ──
for (let n = 1; n <= 20; n++) {
  insR.run(day(n), 'DE', 'REWARDED', 'AdMob Network', Math.round(15e6), 4000, 6000, 5000, 30);
}
const insC = db.prepare(`INSERT INTO change_events (id, customer_id, at, date, campaign_id, resource_type, operation, client_type, user_email, fields, details) VALUES (?, '1234567890', ?, ?, ?, ?, 'UPDATE', ?, ?, ?, ?)`);
insC.run('ce1', new Date(Date.now() - 4 * 86400_000).toISOString(), day(4), '444', 'CAMPAIGN_BUDGET', 'GOOGLE_ADS_WEB_CLIENT', 'owner@example.com', '["amount_micros"]', JSON.stringify([{ field: 'budget', before: 20e6, after: 30e6, kind: 'money' }]));
insC.run('ce2', new Date(Date.now() - 2 * 86400_000).toISOString(), day(2), '444', 'CAMPAIGN', 'GOOGLE_ADS_API', null, '["target_cpa.target_cpa_micros"]', JSON.stringify([{ field: 'targetCpa', before: 1.5e6, after: 1.35e6, kind: 'money' }]));
insC.run('ce3', new Date(Date.now() - 2 * 86400_000).toISOString(), day(2), '111', 'AD_GROUP_AD', 'GOOGLE_ADS_WEB_CLIENT', 'owner@example.com', '["ad.app_ad.youtube_videos"]', '[]');
const vp = (videoId, title, cost, conv, rel, verdict, label, camps) => ({
  videoId, title, impressions: conv * 150 + 2000, clicks: conv * 3, costMicros: cost * 1e6, conversions: conv, cpiMicros: conv ? (cost / conv) * 1e6 : null,
  ctr: 0.02, cvr: 0.3, relCpi: rel, verdict, labels: [label],
  campaigns: camps.map(([id, name, c]) => ({ campaignId: id, campaignName: name, country: c, label, enabled: true, impressions: 2000, clicks: 50, costMicros: (cost / camps.length) * 1e6, conversions: conv / camps.length })),
});
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('videoPerf:1234567890', ?)`).run(JSON.stringify({
  at: new Date().toISOString(), from: day(7), to: day(1),
  items: [
    vp('dQw4w9WgXcQ', 'Promo dọc VN', 220, 180, 0.65, 'winner', 'BEST', [['111', 'streamwave_GP_US_tCPI', 'US'], ['222', 'streamwave_GP_VN_tCPI', 'VN']]),
    vp('aBcDeFgHiJk', 'Gameplay ngang', 160, 60, 1.6, 'loser', 'LOW', [['111', 'streamwave_GP_US_tCPI', 'US']]),
    vp('ZyXwVuTsRqP', 'Teaser 15s', 40, 25, 1.0, 'neutral', 'GOOD', [['333', 'streamwave_GP_IN_tCPI', 'IN']]),
    vp('QwErTyUiOpA', 'Mới thêm', 3, 0, null, 'learning', 'LEARNING', [['555', 'streamwave_GP_JP_tCPI', 'JP']]),
  ],
}));
db.close();


app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
await page.waitForSelector('role=tab[name="Danh sách"]', { timeout: 15000 });
const shots = [];
const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png` });
  shots.push(name);
};

// ── Giả lập Google Ads: danh sách camp + ghi thay đổi ───────────────────────
const M = 1e6;
const rows = [
  ['111', 'streamwave_GP_US_tCPI', 'US', 'ENABLED', 50, 1.5, 345, 230],
  ['222', 'streamwave_GP_VN_tCPI', 'VN', 'ENABLED', 50, 1.5, 120, 160],
  ['333', 'streamwave_GP_IN_tCPI', 'IN', 'ENABLED', 30, 0.2, 90, 80],
  ['444', 'streamwave_GP_BR_tCPI', 'BR', 'ENABLED', 20, 1.5, 70, 0],
  ['555', 'streamwave_GP_JP_tCPI', 'JP', 'ENABLED', 40, 1.5, 0, 0],
  ['666', 'streamwave_GP_DE_tROAS', 'DE', 'PAUSED', 25, null, 60, 12],
].map(([id, name, country, status, budget, tcpa, cost, conv]) => ({
  id, customerId: '1234567890', name, status, country, goalType: 'INSTALLS', appId: 'com.streamwave.tv',
  budgetResource: `customers/1234567890/campaignBudgets/${id}`, budgetMicros: budget * M, budgetShared: id === '333',
  targetCpaMicros: tcpa == null ? null : tcpa * M, targetRoas: tcpa == null ? 1.2 : null, costMicros: cost * M, conversions: conv, impressions: conv * 120 + 500,
}));
await app.evaluate(({ ipcMain }, rows) => {
  ipcMain.removeHandler('ads:campaigns');
  ipcMain.handle('ads:campaigns', () => rows);
  ipcMain.removeHandler('ai:summary');
  ipcMain.handle('ai:summary', () => ({ at: new Date().toISOString(), from: '2026-10-11', to: '2026-10-17',
    text: 'Tổng quan\n- Chi 2.380 US$, doanh thu 2.166 US$, ROAS 91% (ngưỡng 80%).\nVấn đề\n- BR ROAS 40%, CTR quảng cáo 12% — nghi traffic không hợp lệ.\nNên làm\n- Tạm dừng camp BR, kiểm tra vị trí đặt QC.\n- Tăng ngân sách US 10%.' }));
  ipcMain.removeHandler('ads:applyChanges');
  ipcMain.handle('ads:applyChanges', (_e, input) => ({ applied: input.changes.length, operations: input.changes.length }));
}, rows);

// Rule + đề xuất thật trên dữ liệu mẫu
await page.evaluate(async () => {
  const base = { enabled: true, scope: { appId: null, countries: [] }, window: 'LAST_7_DAYS', cooldownHours: 72, maxChangesPerWeek: 2 };
  await window.api.rules.save({ ...base, id: crypto.randomUUID(), name: 'Dừng nước ROAS < 50%', when: { all: [{ metric: 'roas', op: '<', value: 0.5 }, { metric: 'spend', op: '>=', value: 50 }] }, then: { action: 'PAUSE_CAMPAIGN' }, mode: 'SUGGEST' });
  await window.api.rules.save({ ...base, id: crypto.randomUUID(), name: 'Hạ tCPI khi CPI cao', when: { all: [{ metric: 'cpi', op: '>', ref: 'tcpi', factor: 1.2 }] }, then: { action: 'ADJUST_TCPA', pct: -10 }, mode: 'SUGGEST' }).catch(() => undefined);
  await window.api.rules.run();
});
await page.waitForTimeout(2500);

// ── Campaigns ────────────────────────────────────────────────────────────────
await page.getByRole('button', { name: 'Campaigns' }).first().click();
await page.getByRole('tab', { name: 'Danh sách' }).click();
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForSelector('text=streamwave_GP_US_tCPI', { timeout: 8000 }).catch(async (e) => {
  await page.screenshot({ path: `${out}/debug-campaigns.png` });
  throw e;
});
await shot('campaigns-list');
const flagged = await page.getByRole('button', { name: /Cần chú ý/ }).textContent();
await page.getByRole('radio', { name: /Có cảnh báo/ }).click();
const flaggedRows = await page.locator('tbody tr').count();
await shot('campaigns-flagged');
await page.getByRole('radio', { name: /^Tất cả/ }).click();
await page.getByRole('row', { name: /streamwave_GP_BR_tCPI/ }).click();
await page.waitForSelector('aside[aria-label="Chi tiết streamwave_GP_BR_tCPI"]');
await shot('campaign-drawer');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const campNext = await page.locator('aside h2').first().textContent();
await page.locator('aside').getByRole('tab', { name: 'Hiệu quả' }).click();
await page.waitForTimeout(500);
await shot('campaign-drawer-perf');
await page.locator('aside').getByRole('tab', { name: 'Đề xuất rule' }).click();
await page.waitForTimeout(400);
await shot('campaign-drawer-rules');
await page.locator('aside').getByRole('tab', { name: 'Tổng quan' }).click();
await page.locator('aside').getByRole('button', { name: '+10%' }).click();
await page.waitForSelector('role=dialog[name=/thay đổi/i]').catch(() => undefined);
await shot('campaign-diff');
const diffShown = await page.locator('[role=dialog][aria-modal=true]').count();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');

// ── Rules ────────────────────────────────────────────────────────────────────
await page.getByRole('button', { name: 'Rules' }).first().click();
await page.waitForSelector('role=tab[name=/Chờ duyệt/]');
await page.getByRole('tab', { name: /Chờ duyệt/ }).click();
await page.waitForTimeout(400);
await shot('rules-pending');
const pendingRows = await page.locator('tbody tr').count();
if (pendingRows) {
  await page.locator('tbody tr').first().click();
  await page.waitForSelector('aside');
  await shot('rules-suggestion-drawer');
  await page.keyboard.press('Escape');
}
await page.getByRole('tab', { name: /^Rule/ }).click();
await page.getByRole('button', { name: /^Rule Dừng nước/ }).click();
await page.waitForSelector('aside');
await shot('rules-rule-drawer');
await page.keyboard.press('Escape');
await page.getByRole('tab', { name: /Lịch sử/ }).click();
await shot('rules-history');

// ── Creatives ────────────────────────────────────────────────────────────────
await page.evaluate(async () => {
  await window.api.creatives.addYoutubeIds({ text: 'dQw4w9WgXcQ aBcDeFgHiJk', appId: 'app1', aspect: 'portrait', countries: ['VN'] });
  await window.api.creatives.addYoutubeIds({ text: 'ZyXwVuTsRqP', appId: 'app1', aspect: null, countries: [] });
});
await page.getByRole('button', { name: 'Creatives' }).first().click();
await page.waitForSelector('text=ZyXwVuTsRqP');
await shot('creatives-library');
await page.getByRole('button', { name: /ZyXwVuTsRqP/ }).first().click();
await page.waitForSelector('aside');
await shot('creative-drawer');
const drawerFlags = await page.locator('aside li').allTextContents();
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /dQw4w9WgXcQ/ }).first().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
const selBar = await page.getByRole('toolbar').count();
await shot('creatives-selected');

// ── Tính năng mở rộng ────────────────────────────────────────────────────────
// Ngân sách tháng
await page.getByRole('button', { name: 'Campaigns' }).first().click();
await page.getByRole('tab', { name: 'Danh sách' }).click();
await page.getByRole('button', { name: /Ngân sách tháng/ }).click();
await page.getByLabel(/Tổng chi tối đa/).fill('3000');
await shot('pacing-dialog');
await page.getByRole('button', { name: 'Lưu', exact: true }).click();
await page.waitForTimeout(400);
const pacingText = await page.getByRole('button', { name: /Ngân sách tháng/ }).textContent();
await shot('pacing-card');
// Lịch sử thay đổi trong ngăn camp
await page.getByRole('row', { name: /streamwave_GP_BR_tCPI/ }).click();
await page.locator('aside').getByRole('tab', { name: 'Lịch sử thay đổi' }).click();
await page.waitForTimeout(400);
const changeLines = await page.locator('aside ol li p.text-sm').allTextContents();
await shot('campaign-changes');
await page.keyboard.press('Escape');

// Hiệu quả video
await page.getByRole('button', { name: 'Creatives' }).first().click();
await page.getByRole('tab', { name: 'Hiệu quả video' }).click();
await page.waitForSelector('text=Promo dọc VN');
await shot('video-perf');
await page.getByRole('row', { name: /Gameplay ngang/ }).click();
await page.waitForSelector('aside');
await shot('video-perf-drawer');
await page.keyboard.press('Escape');
await page.getByRole('tab', { name: 'Thư viện' }).click();
await page.getByRole('button', { name: /dQw4w9WgXcQ/ }).first().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] }); // bỏ chọn
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /dQw4w9WgXcQ/ }).first().click();
await page.waitForSelector('text=Hiệu quả trên Google Ads');
await shot('creative-drawer-perf');
await page.keyboard.press('Escape');

// Analytics: dấu thay đổi trên biểu đồ, AI tóm tắt, tạo kế hoạch cho nước mở rộng
await page.getByRole('button', { name: 'Analytics' }).first().click();
await page.waitForSelector('role=heading[name="Chi phí & doanh thu"]');
await page.waitForTimeout(500);
const markers = await page.locator('svg[aria-label="Biểu đồ theo ngày"] path.fill-accent-2').count();
await shot('analytics-markers');
await page.evaluate(() => window.api.secrets.setAiKey('sk-ant-api03-e2e-test-key-0000000000000000000000'));
await page.getByRole('button', { name: 'Tóm tắt AI' }).click();
await page.getByRole('button', { name: 'Tạo tóm tắt' }).click().catch(() => undefined);
await page.waitForSelector('aside h3:has-text("Nên làm")');
await shot('ai-summary');
await page.keyboard.press('Escape');
const planBtn = page.getByRole('button', { name: 'Tạo kế hoạch' });
const hasPlan = await planBtn.count();
if (hasPlan) {
  await planBtn.first().click();
  await page.waitForTimeout(800);
}
const draft = await page.evaluate(() => window.api.plans.getDraft());
await shot('plan-from-expansion');

// Cài đặt → Thông báo (không gọi mạng: chỉ kiểm tra token sai dạng bị chặn)
await page.getByRole('button', { name: 'Cài đặt' }).first().click();
await page.getByRole('tab', { name: 'Thông báo' }).click();
await page.getByLabel(/Token bot/).fill('abc');
await page.getByRole('button', { name: 'Lưu token' }).click();
await page.waitForTimeout(500);
await shot('settings-telegram');
const tgError = await page.locator('text=/Token không đúng dạng/').count();
await app.close();

console.log(JSON.stringify({ pacingText, changeLines, markers, hasPlan, draftRows: draft?.rows.map((r) => `${r.countryCode}:${r.dailyBudget}`), draftStep: draft?.step, tgError, flagged, flaggedRows, campNext, diffShown, pendingRows, drawerFlags, selBar, shots, errors }, null, 2));
