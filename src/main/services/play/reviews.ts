import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { assertOnline, withRetry } from '../googleAds/client';
import { callClaude } from '../ai/translate';
import { playClient, wrapPlayError } from './client';
import { getJson, setJson } from '../settingsStore';
import { REPLY_MAX, type PlayReview, type ReplyRequest, type ReplyTemplate } from '@shared/playOps';

// Review người dùng: Play API chỉ trả review có bình luận, sửa trong 7 ngày gần nhất.

const iso = (t?: androidpublisher_v3.Schema$Timestamp) => new Date(Number(t?.seconds ?? 0) * 1000 + Math.round((t?.nanos ?? 0) / 1e6)).toISOString();

// Gọi với translationLanguage=vi: text là bản dịch, originalText là nguyên văn (chỉ có khi khác tiếng Việt)
function toReview(r: androidpublisher_v3.Schema$Review): PlayReview {
  const u = r.comments?.find((c) => c.userComment)?.userComment ?? {};
  const dev = r.comments?.find((c) => c.developerComment)?.developerComment;
  const original = (u.originalText ?? '').trim();
  return {
    id: r.reviewId ?? '',
    author: r.authorName || 'Người dùng Google',
    rating: u.starRating ?? 0,
    text: original || (u.text ?? '').trim(),
    translated: original ? (u.text ?? '').trim() : null,
    language: u.reviewerLanguage ?? null,
    device: u.deviceMetadata?.productName ?? u.device ?? null,
    appVersion: u.appVersionName ?? (u.appVersionCode ? String(u.appVersionCode) : null),
    androidVersion: u.androidOsVersion ?? null,
    at: iso(u.lastModified),
    thumbsUp: u.thumbsUpCount ?? 0,
    reply: dev?.text ? { text: dev.text, at: iso(dev.lastModified) } : null,
  };
}

// Câu trả lời mẫu dùng chung mọi app
export const replyTemplates = () => getJson<ReplyTemplate[]>('playReplyTemplates') ?? [];
export const setReplyTemplates = (t: ReplyTemplate[]) => (setJson('playReplyTemplates', t), t);

export async function listReviews(accountId: string, packageName: string): Promise<PlayReview[]> {
  const api = playClient(accountId);
  const out: PlayReview[] = [];
  let token: string | undefined;
  try {
    // Tối đa 10 trang × 100: app rất lớn vẫn không treo màn
    for (let page = 0; page < 10; page++) {
      const res = await withRetry(() => api.reviews.list({ packageName, maxResults: 100, token, translationLanguage: 'vi' }));
      out.push(...(res.data.reviews ?? []).map(toReview));
      token = res.data.tokenPagination?.nextPageToken ?? undefined;
      if (!token) break;
    }
  } catch (err) {
    throw wrapPlayError(accountId, packageName, err, 'reviews');
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export async function replyReview(req: ReplyRequest) {
  assertOnline();
  const { accountId, packageName, reviewId, text } = req;
  try {
    const res = await playClient(accountId).reviews.reply({ packageName, reviewId, requestBody: { replyText: text } });
    const at = res.data.result?.lastEdited ? iso(res.data.result.lastEdited) : new Date().toISOString();
    db.insert(auditLog).values({ actor: 'user', entity: 'play.reviewReply', entityId: `${packageName}/${reviewId}`, after: JSON.stringify(text) }).run();
    return { text: res.data.result?.replyText ?? text, at };
  } catch (err) {
    throw wrapPlayError(accountId, packageName, err, 'reviews');
  }
}

const SYSTEM = `You write replies from an app developer to Google Play user reviews.
Rules you must follow:
- Reply in the same language as the review.
- At most 300 characters. Plain text only, no markdown, no emoji, no signature.
- Be polite, specific to what the user wrote, and brief. Thank happy users; for problems, apologize once and say what they can try or that the team is looking into it.
- Never promise refunds, rewards, release dates or features. Never ask for or include personal data.
- If a support email is given, you may invite the user to write to it.
- Reply with the reply text only.`;

export async function suggestReply(input: { appName: string | null; rating: number; text: string; language: string | null; supportEmail?: string | null }) {
  const user = [
    input.appName && `App: ${input.appName}`,
    input.supportEmail && `Support email: ${input.supportEmail}`,
    `Rating: ${input.rating}/5`,
    input.language && `Review language code: ${input.language}`,
    `Review: ${input.text || '(no text, rating only)'}`,
  ]
    .filter(Boolean)
    .join('\n');
  const text = (await callClaude(SYSTEM, user)).trim().replace(/^"|"$/g, '');
  return [...text].slice(0, REPLY_MAX).join('');
}
