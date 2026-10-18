// Định dạng theo ngôn ngữ UI (vi-VN: 1.240,50 ₫; en-US: $1,240.50).
let locale: string = 'vi-VN';
export const setLocale = (l: string) => (locale = l);

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  const k = `${locale}|${key}`;
  let f = cache.get(k);
  if (!f) cache.set(k, (f = new Intl.NumberFormat(locale, opts)));
  return f;
}

export const fmtMoney = (v: number, currency: string) =>
  nf(`money:${currency}`, { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(v);

export const fmtNumber = (v: number, digits = 0) =>
  nf(`num:${digits}`, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);

export const fmtPct = (v: number, digits = 1) =>
  nf(`pct:${digits}`, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

export const fromMicros = (micros: number) => micros / 1e6;
