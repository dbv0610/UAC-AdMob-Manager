// Kiểm tra text quảng cáo sau khi AI dịch: độ dài theo cách Google Ads đếm + vài lỗi chính sách hay gặp.
import { z } from 'zod';
import { adsLength, DESCRIPTION_MAX, HEADLINE_MAX } from './textLength';

export type TextField = 'headline' | 'description';
export const maxOf = (f: TextField) => (f === 'headline' ? HEADLINE_MAX : DESCRIPTION_MAX);

// Từ/cụm hay bị Google Ads từ chối vì "gimmicky" hoặc gây hiểu nhầm
const BANNED = [/click here/i, /\bclick now\b/i, /bấm vào đây/i, /#1\b/, /\bno\.? ?1\b/i, /100% free/i];

export function checkAdText(text: string, field: TextField) {
  const t = text.trim();
  const len = adsLength(t);
  const max = maxOf(field);
  const issues: string[] = [];
  if (!t) issues.push('Đang trống');
  if (len > max) issues.push(`Dài ${len}/${max}`);
  if (/([!?.])\1{1,}/.test(t) || /[!?]{2,}/.test(t)) issues.push('Lặp dấu câu (!!, ??)');
  // Viết hoa toàn bộ (bỏ qua chữ viết tắt ngắn như "TV", "HD")
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 6 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) issues.push('Viết hoa toàn bộ');
  if (/[\p{Extended_Pictographic}]/u.test(t)) issues.push('Có emoji');
  for (const re of BANNED) if (re.test(t)) issues.push(`Cụm dễ bị từ chối: “${t.match(re)![0]}”`);
  return { len, max, over: len > max, issues };
}

export interface TranslatedItem {
  field: TextField;
  source: string;
  text: string;
  len: number;
  max: number;
  over: boolean;
  issues: string[];
  attempts: number; // số lần gọi để rút gọn (tối đa 3 = 1 dịch + 2 rút gọn)
}

export interface TranslateResult {
  lang: string; // mã ngôn ngữ Google Ads (vi, ja, pt…)
  items: TranslatedItem[];
  error?: string;
}

export const TranslateRequestSchema = z.object({
  appId: z.string().nullable(),
  headlines: z.array(z.string().trim().min(1).max(200)).max(5),
  descriptions: z.array(z.string().trim().min(1).max(400)).max(5),
  langs: z.array(z.string().min(2).max(10)).min(1).max(40),
  tone: z.string().max(200).optional(),
});
export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

// Lấy JSON đầu tiên trong câu trả lời của model (đôi khi kèm chữ hoặc ```json)
export function extractJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
