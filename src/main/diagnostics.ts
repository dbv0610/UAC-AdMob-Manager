import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, net, safeStorage, type BrowserWindow } from 'electron';
import { desc, sql } from 'drizzle-orm';
import log from 'electron-log/main';
import { zipSync, strToU8 } from 'fflate';
import { db } from './db';
import * as schema from './db/schema';
import { getPrefs } from './services/settingsStore';
import { secretsStatus } from './services/auth/clientConfig';
import { APP_NAME } from '@shared/brand';

// Gói chẩn đoán gửi kèm khi báo lỗi: log (đã che token), thông tin máy, job và nhật ký thay đổi gần đây.
// KHÔNG chứa token, developer token, API key hay dữ liệu báo cáo.

// Che lần nữa cho chắc: access/refresh token Google, developer token, API key Claude, email
export function mask(text: string) {
  return text
    .replace(/(ya29\.|1\/\/)[\w.-]+/g, '$1***')
    .replace(/sk-ant-[\w-]+/g, 'sk-ant-***')
    .replace(/GOCSPX-[\w-]+/g, 'GOCSPX-***')
    .replace(/\b(bot)?\d{6,12}:[A-Za-z0-9_-]{30,}/g, '$1<telegram-token>***')
    .replace(/("?(refresh_token|access_token|developer[-_]token|client_secret|x-api-key)"?\s*[:=]\s*"?)[^",\s]+/gi, '$1***')
    .replace(/([\w.+-])[\w.+-]*@([\w-]+\.[\w.]+)/g, '$1***@$2');
}

const exported = new Set<string>();
export const wasDiagnosticsExport = (p: string) => exported.has(p);

export async function exportDiagnostics(win: BrowserWindow | null) {
  const name = `uac-admob-chan-doan-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
  const opts = { title: 'Xuất gói chẩn đoán', defaultPath: path.join(app.getPath('desktop'), name), filters: [{ name: 'Zip', extensions: ['zip'] }] };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;

  const files: Record<string, Uint8Array> = {};
  // Log: file hiện tại + các file theo ngày còn giữ
  const logDir = path.dirname(log.transports.file.getFile().path);
  for (const f of fs.readdirSync(logDir).filter((f) => f.endsWith('.log')).sort().slice(-14)) {
    files[`logs/${f}`] = strToU8(mask(fs.readFileSync(path.join(logDir, f), 'utf8')));
  }
  // Số dòng mỗi bảng (không đọc nội dung)
  const tables = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
  const counts = Object.fromEntries(tables.map((t) => [t.name, db.get<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(t.name)}`)?.n ?? 0]));
  const prefs = getPrefs();
  const info = {
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    os: process.getSystemVersion(),
    locale: app.getLocale(),
    packaged: app.isPackaged,
    online: net.isOnline(),
    safeStorage: safeStorage.isEncryptionAvailable(),
    secrets: secretsStatus(), // chỉ có/không, không có giá trị
    prefs: { ...prefs, youtubeAccountId: prefs.youtubeAccountId ? '(có)' : null },
    accounts: db.select({ kind: schema.accounts.kind, status: schema.accounts.status }).from(schema.accounts).all(),
    rowCounts: counts,
    exportedAt: new Date().toISOString(),
  };
  files['info.json'] = strToU8(mask(JSON.stringify(info, null, 2)));
  const jobs = db.select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt)).limit(200).all();
  files['jobs.json'] = strToU8(mask(JSON.stringify(jobs, null, 2)));
  const audit = db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at)).limit(500).all();
  files['audit_log.json'] = strToU8(mask(JSON.stringify(audit, null, 2)));
  files['README.txt'] = strToU8(
    `Gói chẩn đoán ${APP_NAME}.\n` + 'Gồm log (đã che token/email), thông tin phiên bản, 200 job và 500 thay đổi gần nhất.\nKhông có token, developer token, API key hay số liệu báo cáo.\n',
  );
  fs.writeFileSync(res.filePath, zipSync(files, { level: 6 }));
  exported.add(res.filePath);
  return res.filePath;
}

// Log theo ngày, giữ 14 ngày
export function setupLogRotation() {
  const day = () => new Date().toISOString().slice(0, 10);
  log.transports.file.resolvePathFn = (vars) => path.join(vars.libraryDefaultDir, `main-${day()}.log`);
  try {
    const dir = path.dirname(log.transports.file.getFile().path);
    const cutoff = Date.now() - 14 * 24 * 3600_000;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^main-(\d{4}-\d{2}-\d{2})\.log$/);
      if (m && Date.parse(m[1]) < cutoff) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    // thư mục log chưa có
  }
}
