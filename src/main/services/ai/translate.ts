import PQueue from 'p-queue';
import { and, eq } from 'drizzle-orm';
import log from 'electron-log/main';
import { db } from '../../db';
import { apps, texts } from '../../db/schema';
import { UserFacingError } from '../../ipc/register';
import type { JobContext } from '../../jobs/queue';
import { getSecret } from '../settingsStore';
import { getLanguage } from '@shared/geo';
import { checkAdText, extractJson, maxOf, type TextField, type TranslateRequest, type TranslateResult, type TranslatedItem } from '@shared/adtext';

// Dịch text quảng cáo bằng Claude, chạy trong main (API key không bao giờ sang renderer).
// Kết quả luôn qua adsLength: câu vượt giới hạn được yêu cầu rút gọn tối đa 2 lần, sau đó đánh dấu đỏ để người dùng sửa.

export const AI_MODEL = 'claude-sonnet-5-5';
const API = 'https://api.anthropic.com/v1/messages';

export function getAiKey() {
  const k = getSecret('anthropicApiKey');
  if (!k) throw new UserFacingError({ message: 'Chưa nhập API key Claude — vào Cài đặt → AI', action: 'openSettings', code: 'NO_AI_KEY' });
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callClaude(system: string, user: string, key = getAiKey(), fetchFn: typeof fetch = fetch): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(API, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
    });
    if (res.ok) {
      const j = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string } };
    if (res.status === 401 || res.status === 403) {
      throw new UserFacingError({ message: 'API key Claude không hợp lệ hoặc hết quyền — kiểm tra ở Cài đặt → AI', action: 'openSettings', code: `AI_${res.status}` });
    }
    // Quá tải / giới hạn tốc độ: chờ rồi thử lại (2s → 4s → 8s)
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new UserFacingError({ message: `Claude báo lỗi: ${body.error?.message ?? `HTTP ${res.status}`}`, action: 'retry', code: body.error?.type ?? `AI_${res.status}` });
  }
}

const SYSTEM = `You are an expert app-store ad copywriter and localizer for Google App campaigns.
Rules you must follow:
- Write natural, persuasive ad copy in the target language, as a native marketer would. Do not translate word-for-word.
- Headlines must be at most 30 characters, descriptions at most 90 characters. CJK, Hangul and full-width characters count as 2.
- No ALL CAPS, no repeated punctuation (!!, ??), no emoji, no "click here", no unverifiable superlatives like "#1".
- Keep brand and app names unchanged.
- Reply with JSON only, no explanation.`;

function translatePrompt(langName: string, headlines: string[], descriptions: string[], appName: string | null, tone?: string) {
  return `Target language: ${langName}
${appName ? `App name (keep as is): ${appName}\n` : ''}${tone ? `Tone: ${tone}\n` : ''}
Translate and adapt these ad texts. Return exactly this JSON shape with the same number of items in the same order:
{"headlines": [...], "descriptions": [...]}

headlines (max 30 chars each):
${JSON.stringify(headlines)}

descriptions (max 90 chars each):
${JSON.stringify(descriptions)}`;
}

function shortenPrompt(langName: string, items: { field: TextField; text: string; len: number }[]) {
  return `Target language: ${langName}
These ${langName} ad texts are too long. Rewrite each to fit its limit while keeping the meaning and appeal.
Return JSON: {"items": ["...", ...]} in the same order.

${items.map((i, k) => `${k + 1}. (${i.field}, max ${maxOf(i.field)}, now ${i.len}) ${i.text}`).join('\n')}`;
}

// Tên ngôn ngữ tiếng Anh cho prompt (mã Google Ads: zh_CN → zh-CN, iw → he)
export function languageInEnglish(code: string) {
  try {
    const bcp = code === 'iw' ? 'he' : code.replace('_', '-');
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(bcp) ?? getLanguage(code)?.name ?? code;
  } catch {
    return getLanguage(code)?.name ?? code;
  }
}

export async function translateOne(
  lang: string,
  req: Pick<TranslateRequest, 'headlines' | 'descriptions' | 'tone'>,
  appName: string | null,
  call: (system: string, user: string) => Promise<string>,
): Promise<TranslateResult> {
  const langName = `${languageInEnglish(lang)} (${lang})`;
  const out = extractJson<{ headlines?: string[]; descriptions?: string[] }>(await call(SYSTEM, translatePrompt(langName, req.headlines, req.descriptions, appName, req.tone)));
  if (!out) return { lang, items: [], error: 'Claude trả về không đúng định dạng — thử lại' };

  const items: TranslatedItem[] = [
    ...req.headlines.map((source, i) => ({ field: 'headline' as const, source, text: out.headlines?.[i]?.trim() ?? '' })),
    ...req.descriptions.map((source, i) => ({ field: 'description' as const, source, text: out.descriptions?.[i]?.trim() ?? '' })),
  ].map((x) => ({ ...x, ...checkAdText(x.text, x.field), attempts: 1 }));

  // Rút gọn câu vượt giới hạn, tối đa 2 lần
  for (let round = 0; round < 2; round++) {
    const over = items.filter((x) => x.len > x.max);
    if (!over.length) break;
    const res = extractJson<{ items?: string[] }>(await call(SYSTEM, shortenPrompt(langName, over.map((x) => ({ field: x.field, text: x.text, len: x.len })))));
    over.forEach((x, k) => {
      const t = res?.items?.[k]?.trim();
      if (t) Object.assign(x, { text: t, ...checkAdText(t, x.field) });
      x.attempts++;
    });
  }
  return { lang, items };
}

export async function translateTexts(req: TranslateRequest, ctx: JobContext) {
  const key = getAiKey();
  const appName = req.appId ? (db.select({ n: apps.name }).from(apps).where(eq(apps.id, req.appId)).get()?.n ?? null) : null;
  const queue = new PQueue({ concurrency: 3 });
  let done = 0;
  ctx.progress(0, req.langs.length);
  const results = await Promise.all(
    req.langs.map((lang) =>
      queue.add(async () => {
        try {
          return await translateOne(lang, req, appName, (s, u) => callClaude(s, u, key));
        } catch (err) {
          if (err instanceof UserFacingError && err.info.action === 'openSettings') throw err; // key sai: dừng cả loạt
          log.warn(`[ai] dịch ${lang} lỗi`, err);
          return { lang, items: [], error: (err as Error).message } satisfies TranslateResult;
        } finally {
          ctx.progress(++done, req.langs.length);
        }
      }),
    ),
  );
  return results as TranslateResult[];
}

// Thư viện text đã duyệt theo app + ngôn ngữ, để dùng lại không phải dịch nữa
export function saveApprovedTexts(appId: string, lang: string, items: { field: TextField; text: string }[]) {
  db.transaction((tx) => {
    for (const it of items) {
      const exists = tx.select({ id: texts.id }).from(texts).where(and(eq(texts.appId, appId), eq(texts.lang, lang), eq(texts.field, it.field), eq(texts.text, it.text))).get();
      if (!exists) tx.insert(texts).values({ appId, lang, field: it.field, text: it.text, approved: true }).run();
    }
  });
}

export function textLibrary(appId: string) {
  return db.select().from(texts).where(and(eq(texts.appId, appId), eq(texts.approved, true))).all();
}
