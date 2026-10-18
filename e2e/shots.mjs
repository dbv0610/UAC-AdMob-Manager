// Chụp các màn chính ở chế độ sáng/tối: node e2e/shots.mjs <thư mục ra>
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? 'e2e/out';
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uac-e2e-'));
const app = await electron.launch({ args: ['.'], env: { ...process.env, UAC_USER_DATA: userData } });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForSelector('text=Kết nối tài khoản', { timeout: 15000 });
await page.setViewportSize({ width: 1360, height: 860 }).catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/onboarding-light.png` });

await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
await page.getByRole('tab', { name: 'App' }).click();
await page.fill('#an', 'StreamWave');
await page.fill('#aid', 'com.streamwave.tv');
await page.fill('#adm', 'sai-dinh-dang');
await page.locator('#adm').blur();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/settings-app-validation.png` });
await page.fill('#adm', 'ca-app-pub-1234567890~1111');
await page.getByRole('button', { name: 'Thêm app' }).click();
await page.waitForSelector('text=Đã lưu app StreamWave');
await page.screenshot({ path: `${out}/settings-app-saved.png` });

await page.getByRole('button', { name: /Tìm lệnh/ }).click(); // accelerator menu không nhận phím giả lập
await page.waitForSelector('[cmdk-input]');
await page.keyboard.type('giao diện');
await page.screenshot({ path: `${out}/palette.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.getByRole('tab', { name: 'Tài khoản' }).click();
await page.screenshot({ path: `${out}/settings-dark.png` });

console.log(JSON.stringify({ errors, userData }, null, 2));
await app.close();
