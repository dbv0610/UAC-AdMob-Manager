import { eq } from 'drizzle-orm';
import { OAuth2Client } from 'google-auth-library';
import log from 'electron-log/main';
import { db } from '../../db';
import { accounts } from '../../db/schema';
import { broadcast } from '../../events';
import { UserFacingError } from '../../ipc/register';
import { decrypt, encrypt } from '../settingsStore';
import { getOAuthClient } from './clientConfig';
import { revoke, signIn as oauthSignIn } from './oauth';
import type { Account, AccountKind } from '@shared/types';

// Incremental authorization: mỗi loại tài khoản chỉ xin đúng scope của nó.
export const SCOPES: Record<AccountKind, string[]> = {
  ads: ['https://www.googleapis.com/auth/adwords'],
  admob: ['https://www.googleapis.com/auth/admob.readonly'],
  youtube: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
  play: ['https://www.googleapis.com/auth/androidpublisher', 'https://www.googleapis.com/auth/playdeveloperreporting'],
  // firebase.remoteconfig chỉ dành cho service account (đăng nhập người dùng báo invalid_scope); cloud-platform dùng được cho cả
  // Remote Config REST lẫn Firebase Management API — giống cách Firebase CLI đăng nhập
  firebase: ['https://www.googleapis.com/auth/cloud-platform'],
};

function toAccount(r: typeof accounts.$inferSelect): Account {
  return { id: r.id, email: r.email, kind: r.kind, scopes: r.scopes.split(' '), status: r.status, createdAt: r.createdAt };
}

export function listAccounts(): Account[] {
  return db.select().from(accounts).all().map(toAccount);
}

export function getAccount(id: string) {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!row) throw new UserFacingError({ message: 'Không tìm thấy tài khoản', code: 'NOT_FOUND' });
  return row;
}

function emitAccounts() {
  broadcast({ type: 'accounts', accounts: listAccounts() });
}

export async function signIn(kind: AccountKind): Promise<Account> {
  const { tokens, sub, email } = await oauthSignIn(SCOPES[kind]);
  const id = `${kind}:${sub}`;
  const values = {
    id,
    email,
    kind,
    scopes: tokens.scope ?? SCOPES[kind].join(' '),
    refreshTokenEnc: encrypt(tokens.refresh_token!),
    status: 'active' as const,
  };
  db.insert(accounts)
    .values(values)
    .onConflictDoUpdate({ target: accounts.id, set: { email, scopes: values.scopes, refreshTokenEnc: values.refreshTokenEnc, status: 'active' } })
    .run();
  emitAccounts();
  return toAccount(getAccount(id));
}

export async function signOut(id: string) {
  const row = getAccount(id);
  if (row.refreshTokenEnc) await revoke(decrypt(row.refreshTokenEnc));
  db.delete(accounts).where(eq(accounts.id, id)).run();
  emitAccounts();
}

export function markReauth(id: string) {
  db.update(accounts).set({ status: 'reauth' }).where(eq(accounts.id, id)).run();
  emitAccounts();
}

export function loadRefreshToken(id: string) {
  const row = getAccount(id);
  if (!row.refreshTokenEnc || row.status === 'reauth') {
    throw new UserFacingError({ message: `${row.email} cần đăng nhập lại`, action: 'reauth', accountId: id, code: 'REAUTH' });
  }
  return decrypt(row.refreshTokenEnc);
}

// Lỗi invalid_grant = token bị thu hồi/hết hạn: đánh dấu tài khoản, không làm crash job.
export function isInvalidGrant(err: unknown) {
  const e = err as { message?: string; response?: { data?: { error?: string } } };
  return e?.response?.data?.error === 'invalid_grant' || /invalid_grant/.test(e?.message ?? '');
}

export function reauthError(id: string) {
  markReauth(id);
  const row = getAccount(id);
  return new UserFacingError({ message: `${row.email} cần đăng nhập lại`, action: 'reauth', accountId: id, code: 'REAUTH' });
}

export function authClientFor(id: string) {
  const { clientId, clientSecret } = getOAuthClient();
  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials({ refresh_token: loadRefreshToken(id) });
  return client;
}

// Access token ngắn hạn — thứ duy nhất được gửi sang worker upload.
export async function getAccessToken(id: string) {
  try {
    const { token } = await authClientFor(id).getAccessToken();
    if (!token) throw new Error('Không lấy được access token');
    return token;
  } catch (err) {
    if (isInvalidGrant(err)) {
      log.warn(`[auth] invalid_grant cho ${id}`);
      throw reauthError(id);
    }
    throw err;
  }
}
