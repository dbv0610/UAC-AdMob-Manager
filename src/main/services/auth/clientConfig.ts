import { UserFacingError } from '../../ipc/register';
import { getSecret } from '../settingsStore';
import type { SecretsStatus } from '@shared/types';

// OAuth client loại Desktop: ưu tiên giá trị người dùng nhập trong Settings, sau đó mới tới bản nhúng lúc build
// (Google không coi client secret loại Desktop là bí mật).
const BUNDLED_ID = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID as string | undefined;
const BUNDLED_SECRET = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET as string | undefined;

export function getOAuthClient() {
  const saved = getSecret('oauthClient');
  if (saved) return JSON.parse(saved) as { clientId: string; clientSecret: string };
  if (BUNDLED_ID && BUNDLED_SECRET) return { clientId: BUNDLED_ID, clientSecret: BUNDLED_SECRET };
  throw new UserFacingError({ message: 'Chưa cấu hình OAuth client (Desktop app)', action: 'openSettings', code: 'NO_OAUTH_CLIENT' });
}

// Google khai tử developer token từ 9/9/2026: mức truy cập Google Ads API giờ theo Cloud project chứa OAuth client,
// header developer-token bị máy chủ bỏ qua. Vẫn gửi token cũ nếu người dùng đã lưu, không có thì gửi rỗng.
export function getDeveloperToken() {
  return getSecret('developerToken') ?? '';
}

export function secretsStatus(): SecretsStatus {
  let clientId: string | null = null;
  try {
    clientId = getOAuthClient().clientId;
  } catch {
    // chưa cấu hình
  }
  return {
    oauthClient: getSecret('oauthClient') ? 'settings' : BUNDLED_ID && BUNDLED_SECRET ? 'bundled' : 'missing',
    clientId,
    projectNumber: clientId?.match(/^(\d+)-/)?.[1] ?? null,
    developerToken: !!getSecret('developerToken'),
    aiKey: !!getSecret('anthropicApiKey'),
  };
}
