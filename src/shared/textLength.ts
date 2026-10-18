import { z } from 'zod';

// Google Ads tính ký tự rộng (CJK, Hangul, full-width) gấp đôi.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
export const adsLength = (s: string) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;

const limited = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} đang trống`)
    .refine((s) => adsLength(s) <= max, { error: (iss) => `Dài ${adsLength(String(iss.input))}/${max}` });

export const HeadlineSchema = limited(HEADLINE_MAX, 'Tiêu đề');
export const DescriptionSchema = limited(DESCRIPTION_MAX, 'Mô tả');

// Màu bộ đếm: vàng khi còn ≤ 10% (27/30), đỏ khi vượt
export function counterTone(len: number, max: number): 'muted' | 'warning' | 'danger' {
  if (len > max) return 'danger';
  if (len >= Math.floor(max * 0.9)) return 'warning';
  return 'muted';
}
