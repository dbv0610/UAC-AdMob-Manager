import { safeStorage } from 'electron';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { DEFAULT_NAME_TEMPLATE } from '@shared/plan';
import type { Prefs } from '@shared/types';

export const DEFAULT_PREFS: Prefs = {
  theme: 'light',
  density: 'compact',
  zoom: 1,
  locale: 'vi-VN',
  sidebarCollapsed: false,
  jobDrawerOpen: false,
  currentAppId: null,
  currentAdsCustomerId: null,
  range: 'last7',
  onboardingDone: false,
  nameTemplate: DEFAULT_NAME_TEMPLATE,
  youtubeAccountId: null,
  uploadVia: 'ads',
  uploadCustomerId: null,
  autoSync: true,
  syncHour: 7,
  closeToTray: true,
};

function getRaw(key: string) {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

function setRaw(key: string, value: string) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function getPrefs(): Prefs {
  const v = getRaw('prefs');
  return { ...DEFAULT_PREFS, ...(v ? (JSON.parse(v) as Partial<Prefs>) : {}) };
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  setRaw('prefs', JSON.stringify(next));
  return next;
}

export function getJson<T>(key: string): T | null {
  const v = getRaw(key);
  return v ? (JSON.parse(v) as T) : null;
}

export function setJson(key: string, value: unknown) {
  setRaw(key, JSON.stringify(value));
}

// ── Secret: mã hóa bằng keychain hệ điều hành ──────────────────────────────
export function assertEncryption() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không hỗ trợ mã hóa (safeStorage)');
}

export function encrypt(plain: string) {
  assertEncryption();
  return safeStorage.encryptString(plain).toString('base64');
}

export function decrypt(enc: string) {
  return safeStorage.decryptString(Buffer.from(enc, 'base64'));
}

export function setSecret(key: string, plain: string) {
  setRaw(`secret:${key}`, encrypt(plain));
}

export function deleteSecret(key: string) {
  db.delete(settings).where(eq(settings.key, `secret:${key}`)).run();
}

export function getSecret(key: string): string | null {
  const v = getRaw(`secret:${key}`);
  return v ? decrypt(v) : null;
}

export function storageBackend(): string | null {
  // getSelectedStorageBackend chỉ có trên Linux; 'basic_text' nghĩa là không có keyring thật.
  return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null;
}
