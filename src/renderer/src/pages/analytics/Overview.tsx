import { useId } from 'react';
import { Coins, Info, Target, TrendingDown, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { METRICS, bucketDaily, delta, metricOf, type AnalyticsResult, type Metric } from '@shared/analytics';
import { fmtMoney, fmtPct } from '@/lib/format';
import { Card, cx } from '@/components/ui';
import { DeltaPill, Segmented } from '@/components/kit';
import { TrendChart, breakEvenDate, chartSeries, fmtKind, type ChartMode } from './Chart';

// Tổng quan: 4 thẻ chính (tiền vào/ra) + 6 thẻ phụ; bấm thẻ để vẽ chỉ số đó trên biểu đồ.

const HERO: { m: Metric; icon: LucideIcon; tint: string }[] = [
  { m: 'spend', icon: Wallet, tint: 'text-accent bg-accent/10' },
  { m: 'revenue', icon: Coins, tint: 'text-accent-2 bg-accent-2/10' },
  { m: 'profit', icon: TrendingUp, tint: 'text-success bg-success/10' },
  { m: 'roas', icon: Target, tint: 'text-info bg-info/10' },
];
const MINI: Metric[] = ['installs', 'cpi', 'ecpm', 'adImpressions', 'adsCtr', 'cvr'];

export function KpiCards({ d, mode, setMode }: { d: AnalyticsResult; mode: ChartMode; setMode: (m: ChartMode) => void }) {
  const pick = (m: Metric) => setMode(mode === m ? 'combo' : m);
  const active = (m: Metric) => mode === m || (mode === 'combo' && (m === 'spend' || m === 'revenue')) || (mode === 'cumulative' && m === 'profit');
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {HERO.map(({ m, icon, tint }) => {
          const meta = METRICS[m];
          const cur = d.kpis[m];
          const pv = d.prev[m];
          const loss = m === 'profit' && (cur ?? 0) < 0;
          const below = m === 'roas' && d.roasTarget != null && cur != null && cur < d.roasTarget;
          const Icon = loss ? TrendingDown : icon;
          return (
            <button key={m} aria-pressed={mode === m} onClick={() => pick(m)} title={`${meta.hint} — bấm để vẽ biểu đồ`}
              className={cx('group relative overflow-hidden rounded-lg border bg-surface p-4 text-left transition-all hover:-translate-y-px hover:shadow-md',
                active(m) ? 'border-accent/70 shadow-sm ring-2 ring-accent/15' : 'border-border')}>
              <div className="flex items-center gap-2">
                <span className={cx('grid size-8 place-items-center rounded-lg', loss || below ? 'bg-danger/10 text-danger' : tint)}><Icon className="size-4" aria-hidden /></span>
                <span className="text-sm text-muted">{meta.label}</span>
                <span className="flex-1" />
                {m !== 'profit' && <DeltaPill value={delta(cur, pv)} goodUp={meta.goodUp} />}
              </div>
              <p className={cx('num mt-2 text-left text-2xl font-semibold tracking-tight', loss || below ? 'text-danger' : m === 'profit' || (m === 'roas' && d.roasTarget != null) ? 'text-success' : '')}>
                {fmtKind(cur, meta.kind, d.currency)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Kỳ trước <span className="num">{fmtKind(pv, meta.kind, d.currency)}</span>
                {m === 'roas' && d.roasTarget != null && <> · ngưỡng <span className="num">{fmtPct(d.roasTarget, 0)}</span></>}
              </p>
              <Area values={d.daily.map((p) => metricOf(p, m))} className={cx('mt-2 h-10', loss || below ? 'text-danger' : tint.split(' ')[0])} />
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
        {MINI.map((m) => {
          const meta = METRICS[m];
          const cur = d.kpis[m];
          return (
            <button key={m} aria-pressed={mode === m} onClick={() => pick(m)} title={`${meta.hint} — bấm để vẽ biểu đồ`}
              className={cx('rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/50', mode === m ? 'border-accent/70 ring-2 ring-accent/15' : 'border-border')}>
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-xs text-muted">{meta.label}</span>
                <DeltaPill value={delta(cur, d.prev[m])} goodUp={meta.goodUp} small />
              </div>
              <p className="num mt-0.5 text-left text-lg font-semibold">{fmtKind(cur, meta.kind, d.currency)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// Đường + vùng tô mờ, dùng currentColor
function Area({ values, className }: { values: (number | null)[]; className?: string }) {
  const id = useId();
  const nums = values.map((v) => (v == null || !isFinite(v) ? null : v));
  const real = nums.filter((v): v is number => v != null);
  if (real.length < 2) return <div className={className} />;
  const lo = Math.min(0, ...real), hi = Math.max(...real);
  const W = 200, H = 40;
  const x = (i: number) => (i / Math.max(1, nums.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const pts = nums.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => !!p);
  const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cx('w-full', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ── Biểu đồ ─────────────────────────────────────────────────────────────────
const CHART_METRICS: Metric[] = ['spend', 'revenue', 'profit', 'roas', 'installs', 'cpi', 'ecpm', 'adImpressions', 'adsCtr', 'cvr'];

export function TrendCard({ d, mode, setMode, by, setBy, compare, setCompare, notes }: {
  d: AnalyticsResult;
  mode: ChartMode;
  setMode: (m: ChartMode) => void;
  by: 'day' | 'week';
  setBy: (b: 'day' | 'week') => void;
  compare: boolean;
  setCompare: (v: boolean) => void;
  notes?: Record<string, string[]>;
}) {
  const points = bucketDaily(d.daily, by);
  const prev = compare && mode !== 'cumulative' ? bucketDaily(d.prevDaily, by) : null;
  const { series, kind } = chartSeries(mode, points, prev);
  const cum = mode === 'cumulative';
  const be = breakEvenDate(d.daily);
  const refLine = mode === 'roas' && d.roasTarget != null ? { value: d.roasTarget, label: `Ngưỡng ${fmtPct(d.roasTarget, 0)}` } : undefined;
  const single = mode !== 'combo' && mode !== 'cumulative';

  return (
    <Card className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-base font-semibold">{cum ? 'Lời/lỗ lũy kế' : mode === 'combo' ? 'Chi phí & doanh thu' : METRICS[mode].label}</h2>
          <p className="flex items-center gap-1 text-xs text-muted" title="Doanh thu quảng cáo của mọi người dùng trong kỳ ÷ chi phí trong kỳ. Trộn người dùng organic và người dùng cũ; không gồm mua trong app (IAP).">
            <Info className="size-3" aria-hidden /> ROAS cùng kỳ (blended)
          </p>
        </div>
        <Segmented label="Kiểu biểu đồ" value={single ? 'metric' : mode} onChange={(v) => setMode(v === 'metric' ? 'roas' : (v as ChartMode))}
          options={[['combo', 'Chi & thu'], ['cumulative', 'Lũy kế'], ['metric', 'Chỉ số']]} />
        {single && (
          <select className="h-7 rounded-sm border border-border bg-surface px-1.5 text-sm" aria-label="Chỉ số" value={mode} onChange={(e) => setMode(e.target.value as Metric)}>
            {CHART_METRICS.map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
          </select>
        )}
        <Segmented label="Gộp theo" value={by} onChange={(v) => setBy(v as 'day' | 'week')} options={[['day', 'Ngày'], ['week', 'Tuần']]} />
        <label className={cx('flex h-7 items-center gap-1.5 rounded-sm border px-2 text-sm', compare ? 'border-accent/50 bg-accent/5 text-accent' : 'border-border text-muted', cum && 'opacity-50')}>
          <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={compare} disabled={cum} onChange={(e) => setCompare(e.target.checked)} /> Kỳ trước
        </label>
      </div>
      <div className="min-h-0 flex-1">
        <TrendChart dates={points.map((p) => p.date)} series={series} kind={kind} currency={d.currency} refLine={refLine} weekly={by === 'week'} height={250} notes={by === 'day' ? notes : undefined}
          ariaLabel={cum ? 'Chi phí và doanh thu lũy kế' : 'Biểu đồ theo ngày'} />
      </div>
      {cum && (
        <p className="mt-2 rounded-sm bg-surface-2 px-2.5 py-1.5 text-xs">
          {be ? <>Hòa vốn lũy kế từ <b className="text-success">{be}</b>.</> : d.kpis.spend > 0 ? <>Chưa hòa vốn trong kỳ — còn thiếu <b className="num text-danger">{fmtMoney(-Math.min(0, d.kpis.profit), d.currency)}</b>.</> : 'Chưa có chi phí trong kỳ.'}
        </p>
      )}
    </Card>
  );
}


export { DeltaPill, Segmented };
