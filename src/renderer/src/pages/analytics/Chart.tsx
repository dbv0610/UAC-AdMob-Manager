import { useLayoutEffect, useRef, useState } from 'react';
import { METRICS, cumulative, metricOf, type DailyPoint, type Metric, type MetricKind } from '@shared/analytics';
import { fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { cx } from '@/components/ui';

// Biểu đồ SVG tự vẽ (không thêm thư viện). Một khung dùng chung cho: chi phí & doanh thu, một chỉ số, lũy kế.

type Color = 'accent' | 'accent-2' | 'muted' | 'success' | 'info' | 'warning';
const FILL: Record<Color, string> = { accent: 'fill-accent/60', 'accent-2': 'fill-accent-2/60', muted: 'fill-muted/30', success: 'fill-success/60', info: 'fill-info/60' , warning: 'fill-warning/60' };
const FILL_HOVER: Record<Color, string> = { accent: 'fill-accent', 'accent-2': 'fill-accent-2', muted: 'fill-muted/50', success: 'fill-success', info: 'fill-info' , warning: 'fill-warning' };
const STROKE: Record<Color, string> = { accent: 'stroke-accent', 'accent-2': 'stroke-accent-2', muted: 'stroke-muted', success: 'stroke-success', info: 'stroke-info' , warning: 'stroke-warning' };
const DOT: Record<Color, string> = { accent: 'fill-accent', 'accent-2': 'fill-accent-2', muted: 'fill-muted', success: 'fill-success', info: 'fill-info' , warning: 'fill-warning' };
const SWATCH: Record<Color, string> = { accent: 'bg-accent', 'accent-2': 'bg-accent-2', muted: 'bg-muted', success: 'bg-success', info: 'bg-info' , warning: 'bg-warning' };

export interface Series {
  label: string;
  values: (number | null)[];
  kind: 'bar' | 'line';
  color: Color;
  dashed?: boolean;
  signed?: boolean; // cột âm tô đỏ (lợi nhuận)
  dates?: string[]; // ngày riêng của series (kỳ trước) để hiện trong tooltip
}

export const fmtKind = (v: number | null, kind: MetricKind, currency: string, pctDigits = 0) =>
  v == null || !isFinite(v) ? '—' : kind === 'money' ? fmtMoney(v, currency) : kind === 'pct' ? fmtPct(v, pctDigits) : fmtNumber(v);

export function TrendChart({
  dates,
  series,
  kind,
  currency,
  height = 220,
  refLine,
  weekly,
  ariaLabel,
  notes,
  pctDigits = 0,
}: {
  dates: string[];
  series: Series[];
  kind: MetricKind;
  currency: string;
  height?: number;
  refLine?: { value: number; label: string; tone?: 'success' | 'danger' }; // mặc định xanh (mục tiêu); đỏ = ngưỡng xấu
  weekly?: boolean;
  ariaLabel: string;
  notes?: Record<string, string[]>; // ngày → ghi chú (thay đổi trên Google Ads), vẽ ◆ trên trục
  pctDigits?: number; // tỉ lệ nhỏ (crash 1,09%) cần số lẻ
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 60, r: 12, t: notes ? 18 : 12, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null && isFinite(v));
  if (refLine) all.push(refLine.value);
  // Vạch trục đều, bước “đẹp”, luôn có 0
  const rawHi = Math.max(1e-9, ...all);
  const rawLo = Math.min(0, ...all);
  const tickStep = niceStep((rawHi - rawLo) / 4);
  const hi = Math.ceil(rawHi / tickStep) * tickStep;
  const lo = Math.floor(rawLo / tickStep) * tickStep;
  const n = Math.max(1, dates.length);
  const step = w / n;
  const x = (i: number) => pad.l + i * step + step / 2;
  const y = (v: number) => pad.t + h - ((v - lo) / (hi - lo)) * h;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + tickStep / 2; t += tickStep) ticks.push(Math.abs(t) < tickStep / 1e6 ? 0 : t);
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor(w / 56)));
  const bars = series.filter((s) => s.kind === 'bar');
  const barW = Math.min(28, (step * 0.7) / Math.max(1, bars.length));
  const tickFmt = (v: number) => (kind === 'pct' ? fmtPct(v, pctDigits) : compact(v));

  const linePath = (s: Series) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-muted/50' : 'stroke-border'} strokeDasharray={t ? '3 3' : undefined} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[10px] tabular-nums">{tickFmt(t)}</text>
          </g>
        ))}
        {refLine && (
          <g pointerEvents="none">
            <line x1={pad.l} x2={width - pad.r} y1={y(refLine.value)} y2={y(refLine.value)} className={refLine.tone === 'danger' ? 'stroke-danger' : 'stroke-success'} strokeDasharray="6 4" strokeWidth={1.5} />
            <text x={width - pad.r - 4} y={y(refLine.value) - 4} textAnchor="end" className={cx(refLine.tone === 'danger' ? 'fill-danger' : 'fill-success', 'text-[10px] font-medium')}>{refLine.label}</text>
          </g>
        )}
        {dates.map((d, i) => (
          <g key={d} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - step / 2} y={pad.t} width={step} height={h} fill="transparent" />
            {hover === i && <rect x={x(i) - step / 2} y={pad.t} width={step} height={h} className="fill-surface-2" />}
            {bars.map((s, b) => {
              const v = s.values[i];
              if (v == null || !isFinite(v)) return null;
              const top = Math.min(y(v), y(0));
              const neg = s.signed && v < 0;
              return (
                <rect key={s.label} x={x(i) - (barW * bars.length) / 2 + b * barW} y={top} width={barW - 1} height={Math.max(0.5, Math.abs(y(v) - y(0)))} rx={2}
                  className={neg ? (hover === i ? 'fill-danger' : 'fill-danger/60') : hover === i ? FILL_HOVER[s.color] : FILL[s.color]} />
              );
            })}
            {i % labelEvery === 0 && (
              <text x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[10px] tabular-nums">{(weekly ? 'T ' : '') + d.slice(5).replace('-', '/')}</text>
            )}
          </g>
        ))}
        {notes && dates.map((d, i) => notes[d]?.length ? (
          <g key={`n${d}`} pointerEvents="none">
            <line x1={x(i)} x2={x(i)} y1={pad.t} y2={pad.t + h} className="stroke-accent-2/40" strokeDasharray="2 3" />
            <path d={`M${x(i)},${pad.t - 6} l5,5 l-5,5 l-5,-5 Z`} className="fill-accent-2" />
          </g>
        ) : null)}
        {series.filter((s) => s.kind === 'line').map((s) => (
          <g key={s.label} pointerEvents="none">
            <path d={linePath(s)} fill="none" strokeWidth={2} className={STROKE[s.color]} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
            {!s.dashed && s.values.map((v, i) => (v == null || !isFinite(v) ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4 : n > 45 ? 0 : 2.5} className={DOT[s.color]} />))}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            {s.kind === 'bar' ? <span className={cx('inline-block size-2.5 rounded-sm opacity-70', SWATCH[s.color])} aria-hidden /> : (
              <span className={cx('inline-block h-0.5 w-3', SWATCH[s.color], s.dashed && 'opacity-50')} aria-hidden />
            )}
            {s.label}
          </span>
        ))}
      </div>
      {hover != null && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.max(0, Math.min(x(hover) + 10, width - 200)) }}>
          <p className="font-medium">{weekly ? `Tuần từ ${dates[hover]}` : dates[hover]}</p>
          {series.map((s) => (
            <p key={s.label} className="flex justify-between gap-3">
              <span className="text-muted">{s.label}{s.dates?.[hover] ? ` (${s.dates[hover].slice(5).replace('-', '/')})` : ''}</span>
              <span className="num">{fmtKind(s.values[hover] ?? null, kind, currency, pctDigits)}</span>
            </p>
          ))}
          {notes?.[dates[hover]]?.length ? (
            <div className="mt-1 border-t border-border pt-1">
              {notes[dates[hover]].slice(0, 4).map((n, k) => <p key={k} className="max-w-72 text-accent-2">◆ {n}</p>)}
              {notes[dates[hover]].length > 4 && <p className="text-muted">+{notes[dates[hover]].length - 4} thay đổi khác</p>}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Các kiểu biểu đồ dựng sẵn ───────────────────────────────────────────────
export type ChartMode = 'combo' | 'cumulative' | Metric;

// Kỳ trước được căn theo vị trí (ngày thứ i của kỳ này ↔ ngày thứ i của kỳ trước)
export function chartSeries(mode: ChartMode, points: DailyPoint[], prev: DailyPoint[] | null): { series: Series[]; kind: MetricKind } {
  const pv = prev && prev.length ? prev.slice(-points.length) : null;
  if (mode === 'combo') {
    const s: Series[] = [
      { label: 'Chi phí Google Ads', values: points.map((p) => p.spend), kind: 'bar', color: 'accent' },
      { label: 'Doanh thu quảng cáo AdMob', values: points.map((p) => p.revenue), kind: 'line', color: 'accent-2' },
    ];
    if (pv) s.push({ label: 'Doanh thu kỳ trước', values: pv.map((p) => p.revenue), kind: 'line', color: 'muted', dashed: true, dates: pv.map((p) => p.date) });
    return { series: s, kind: 'money' };
  }
  if (mode === 'cumulative') {
    const c = cumulative(points);
    return {
      series: [
        { label: 'Chi phí lũy kế', values: c.map((p) => p.spend), kind: 'line', color: 'accent' },
        { label: 'Doanh thu lũy kế', values: c.map((p) => p.revenue), kind: 'line', color: 'accent-2' },
        { label: 'Lời/lỗ lũy kế', values: c.map((p) => p.revenue - p.spend), kind: 'bar', color: 'success', signed: true },
      ],
      kind: 'money',
    };
  }
  const meta = METRICS[mode];
  const isSum = ['spend', 'revenue', 'profit', 'installs', 'adImpressions'].includes(mode);
  const s: Series[] = [
    { label: meta.label, values: points.map((p) => metricOf(p, mode)), kind: isSum ? 'bar' : 'line', color: mode === 'revenue' ? 'accent-2' : mode === 'profit' ? 'success' : 'accent', signed: mode === 'profit' },
  ];
  if (pv) s.push({ label: `${meta.label} kỳ trước`, values: pv.map((p) => metricOf(p, mode)), kind: 'line', color: 'muted', dashed: true, dates: pv.map((p) => p.date) });
  return { series: s, kind: meta.kind };
}

// Ngày hòa vốn trong kỳ: lần đầu doanh thu lũy kế ≥ chi phí lũy kế (khi có chi)
export function breakEvenDate(points: DailyPoint[]) {
  const c = cumulative(points);
  const last = c[c.length - 1];
  if (!last || last.spend <= 0) return null;
  const i = c.findIndex((p) => p.spend > 0 && p.revenue >= p.spend);
  return i < 0 ? null : c[i].date;
}

function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const compact = (v: number) => new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
