import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library';
import { UserFacingError } from '../../ipc/register';
import { getOAuthClient } from './clientConfig';
import { APP_NAME } from '@shared/brand';

const PAGE = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>` +
  `<body style="font:15px system-ui;background:#0f172a;color:#f1f5f9;display:grid;place-items:center;height:100vh;margin:0">` +
  `<p>${msg}</p></body>`;

export interface SignInResult {
  tokens: Credentials;
  sub: string;
  email: string;
}

// Mở trình duyệt hệ thống, nhận code qua loopback 127.0.0.1:<cổng ngẫu nhiên>, đổi token bằng PKCE.
export async function signIn(scopes: string[]): Promise<SignInResult> {
  const { clientId, clientSecret } = getOAuthClient();
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomUUID();

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent', // luôn hỏi chọn tài khoản: tránh đăng nhập nhầm email đang mở sẵn trên trình duyệt
    include_granted_scopes: true,
    scope: ['openid', 'email', ...scopes],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  const code = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new UserFacingError({ message: 'Hết thời gian đăng nhập (5 phút)', action: 'retry', code: 'TIMEOUT' })),
      5 * 60_000,
    );
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', redirectUri);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (u.pathname !== '/') return res.writeHead(404).end(); // favicon.ico…
      if (u.searchParams.get('state') !== state) return res.writeHead(400).end(PAGE('State không khớp.'));
      clearTimeout(timer);
      const err = u.searchParams.get('error');
      if (err) {
        res.end(PAGE('Đăng nhập đã bị hủy. Có thể đóng tab này.'));
        // access_denied hay gặp nhất khi OAuth consent screen đang Testing mà email chưa có trong Test users
        const hint =
          err === 'access_denied'
            ? 'Google từ chối (access_denied): bạn bấm Hủy, hoặc project OAuth đang ở chế độ Testing mà email này chưa có trong Test users — thêm email ở Google Cloud → OAuth consent screen → Audience, hoặc chuyển sang In production'
            : `Google từ chối đăng nhập: ${err}`;
        return reject(new UserFacingError({ message: hint, action: err === 'access_denied' ? 'openSettings' : 'retry', code: err }));
      }
      res.end(PAGE('Đăng nhập xong, quay lại ứng dụng. Có thể đóng tab này.'));
      resolve(u.searchParams.get('code')!);
    });
  });

  try {
    await shell.openExternal(url);
    const { tokens } = await client.getToken({ code: await code, codeVerifier });
    if (!tokens.refresh_token) {
      throw new UserFacingError({ message: 'Google không trả refresh token, hãy đăng nhập lại', action: 'retry' });
    }
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: clientId });
    const payload = ticket.getPayload()!;
    return { tokens, sub: payload.sub, email: payload.email ?? payload.sub };
  } finally {
    server.close();
  }
}

export async function revoke(refreshToken: string) {
  const { clientId, clientSecret } = getOAuthClient();
  await new OAuth2Client({ clientId, clientSecret }).revokeToken(refreshToken).catch(() => undefined);
}
