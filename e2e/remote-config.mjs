// Màn Remote Config trên app thật, Firebase API thay bằng handler giả trong main: node e2e/remote-config.mjs <thư mục ra>
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

const projects = [
  { projectId: 'qr-scanner-prod', displayName: 'QR Scanner', projectNumber: '111', accountId: 'firebase:1', apps: [{ appId: '1:111:android:aa', platform: 'ANDROID', displayName: 'QR Scanner Android', packageName: 'com.qr.scanner', appStoreId: null }] },
  { projectId: 'streamwave-prod', displayName: 'StreamWave', projectNumber: '222', accountId: 'firebase:1', apps: [{ appId: '1:222:android:bb', platform: 'ANDROID', displayName: 'StreamWave', packageName: 'com.streamwave.tv', appStoreId: null }] },
];
const db = new Database(path.join(userData, 'app.db'));
db.prepare(`INSERT INTO accounts (id, email, kind, scopes, refresh_token_enc, status, meta) VALUES ('firebase:1', 'dev@streamwave.tv', 'firebase', 'https://www.googleapis.com/auth/firebase.remoteconfig', NULL, 'active', ?)`).run(JSON.stringify({ projects }));
// Tài khoản Firebase thứ 2: một project riêng + một project dùng chung với tài khoản 1
const projects2 = [
  { projectId: 'radio-fm-prod', displayName: 'Radio FM', projectNumber: '333', accountId: 'firebase:2', apps: [] },
  { ...projects[1], accountId: 'firebase:2' },
];
db.prepare(`INSERT INTO accounts (id, email, kind, scopes, refresh_token_enc, status, meta) VALUES ('firebase:2', 'studio@blueleft.dev', 'firebase', 'https://www.googleapis.com/auth/cloud-platform', NULL, 'active', ?)`).run(JSON.stringify({ projects: projects2 }));
const prefs = JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'prefs'`).get()?.value ?? '{}');
db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('prefs', ?)`).run(JSON.stringify({ ...prefs, onboardingDone: true }));
db.close();

app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
await page.waitForSelector('text=Remote Config');
await app.evaluate(({ ipcMain }) => {
  const template = (unit) => ({
    conditions: [
      { name: 'vn_users', expression: "device.country in ['vn']", tagColor: 'GREEN' },
      { name: 'ios', expression: "device.os == 'ios'", tagColor: 'BLUE' },
    ],
    parameters: {
      inter_unit_id: { valueType: 'STRING', description: 'Ad unit interstitial', defaultValue: { value: `ca-app-pub-111/${unit}` }, conditionalValues: { vn_users: { value: 'ca-app-pub-111/999' } } },
      inter_interval_sec: { valueType: 'NUMBER', defaultValue: { value: '30' }, conditionalValues: { vn_users: { value: '45' } } },
      ads_config: { valueType: 'JSON', defaultValue: { value: `{"banner":{"unit":"ca-app-pub-111/${unit}","refresh":30},"native":true}` } },
      new_paywall: { valueType: 'BOOLEAN', defaultValue: { value: 'false' }, conditionalValues: { ios: { rolloutValue: { rolloutId: 'r1', value: 'true', percent: 20 } } } },
    },
    parameterGroups: { onboarding: { parameters: { onboarding_steps: { valueType: 'NUMBER', defaultValue: { value: '3' } } } } },
    version: { versionNumber: '42', updateTime: new Date().toISOString(), updateUser: { email: 'dev@streamwave.tv' } },
  });
  const h = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
  h('rc:template', (_e, _acc, pid) => ({ projectId: pid, template: template(pid === 'qr-scanner-prod' ? '222' : '444'), etag: 'etag-1', fetchedAt: new Date().toISOString() }));
  h('rc:planReplace', (_e, req) => req.targets.map((t, i) => ({
    ...t, etag: 'etag-1', error: null,
    changes: [
      { key: 'inter_unit_id', group: null, slot: 'default', valueType: 'STRING', before: `ca-app-pub-111/${i ? '444' : '222'}`, after: `ca-app-pub-555/${i ? '444' : '222'}`, error: null },
      { key: 'inter_unit_id', group: null, slot: 'vn_users', valueType: 'STRING', before: 'ca-app-pub-111/999', after: 'ca-app-pub-555/999', error: null },
      { key: 'ads_config', group: null, slot: 'default', valueType: 'JSON', before: `{"banner":{"unit":"ca-app-pub-111/${i ? '444' : '222'}"}}`, after: `{"banner":{"unit":"ca-app-pub-555/${i ? '444' : '222'}"}}`, error: null },
    ],
    skipped: i ? [] : [{ key: 'new_paywall', group: null, slot: 'ios', reason: 'Đang chạy rollout / A/B test trên Console' }],
  })));
  h('rc:versions', () => [
    { versionNumber: '42', updateTime: new Date().toISOString(), updateUser: { email: 'dev@streamwave.tv' }, updateOrigin: 'CONSOLE', updateType: 'INCREMENTAL_UPDATE', description: 'Tăng interval VN' },
    { versionNumber: '41', updateTime: new Date(Date.now() - 86400e3).toISOString(), updateUser: { email: 'dev@streamwave.tv' }, updateOrigin: 'REST_API', updateType: 'INCREMENTAL_UPDATE', description: 'AppOps Studio: tìm & thay thế' },
  ]);
  h('rc:version', () => { const t = template('222'); t.parameters.inter_interval_sec.conditionalValues.vn_users.value = '30'; return t; });
});
await page.setViewportSize({ width: 1400, height: 900 });
await page.getByRole('button', { name: 'Remote Config' }).first().click();
await page.waitForSelector('text=inter_unit_id');
await page.screenshot({ path: `${out}/rc-params.png` });
await page.getByRole('button', { name: 'Sửa ads_config' }).click();
await page.waitForSelector('text=JSON hợp lệ');
await page.screenshot({ path: `${out}/rc-json-editor.png` });
await page.getByLabel('Giá trị mặc định').press('End');
await page.getByLabel('Giá trị mặc định').type(',');
await page.screenshot({ path: `${out}/rc-json-error.png` });
await page.getByRole('button', { name: 'Hủy' }).click();

// Sửa một tham số → bản nháp → hộp publish có diff
await page.getByRole('button', { name: 'Sửa inter_interval_sec' }).click();
await page.getByLabel('Giá trị mặc định').fill('25');
await page.getByRole('button', { name: 'Lưu vào bản nháp' }).click();
await page.getByRole('button', { name: 'Publish lên Firebase' }).click();
await page.waitForSelector('role=dialog');
await page.screenshot({ path: `${out}/rc-publish.png` });
await page.getByRole('button', { name: 'Hủy' }).click();

await page.getByRole('tab', { name: 'Điều kiện' }).click();
await page.getByRole('button', { name: 'Thêm điều kiện' }).click();
await page.getByLabel('Tên điều kiện').fill('android_vn_new');
await page.getByLabel('Thêm quy tắc').selectOption('country');
await page.screenshot({ path: `${out}/rc-condition.png` });
await page.getByRole('button', { name: 'Hủy' }).click();

await page.getByRole('tab', { name: 'A/B tự quản' }).click();
await page.getByRole('button', { name: 'Tạo thí nghiệm' }).click();
await page.getByLabel('Tên thí nghiệm (seed)').fill('inter_freq_oct');
await page.getByLabel('Thêm tham số').selectOption({ label: 'inter_interval_sec' });
await page.screenshot({ path: `${out}/rc-ab.png` });

await page.getByRole('tab', { name: 'Tìm & thay thế' }).click();
await page.getByRole('button', { name: 'Chọn hết' }).click();
await page.getByLabel('Tìm', { exact: true }).fill('ca-app-pub-111');
await page.getByLabel('Thay bằng').fill('ca-app-pub-555');
await page.getByRole('button', { name: 'Tìm & xem trước' }).click();
await page.waitForSelector('text=Kết quả');
await page.screenshot({ path: `${out}/rc-replace.png`, fullPage: true });

await page.getByRole('combobox').first().selectOption({ label: 'studio@blueleft.dev · 2 project' });
await page.waitForSelector('text=Remote Config · Radio FM');
await page.screenshot({ path: `${out}/rc-account.png` });
// Chọn tài khoản từ menu xổ xuống ở sidebar
await page.getByRole('button', { name: /dev@streamwave.tv/ }).click();
await page.waitForSelector('text=Remote Config · QR Scanner');
await page.screenshot({ path: `${out}/rc-sidebar-accounts.png` });
await page.getByRole('combobox').first().selectOption({ index: 0 });
await page.getByRole('tab', { name: 'Lịch sử' }).click();
await page.getByRole('button', { name: /#41/ }).click();
await page.waitForSelector('text=Khôi phục #41');
await page.screenshot({ path: `${out}/rc-history.png` });

await app.close();
console.log(`Ảnh chụp: ${out}`);
