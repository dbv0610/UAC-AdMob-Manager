import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { QUADRANT, quadrants, type CountryStat, type Heatmap, type Quadrant } from '@shared/analytics';
import { flag, getCountry } from '@shared/geo';
import { fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { Card, Input, Select, cx } from '@/components/ui';

const TONE_TEXT = { success: 'text-success', info: 'text-info', warning: 'text-warning', danger: 'text-danger' } as const;
const TONE_FILL = { success: 'fill-success/70', info: 'fill-info/70', warning: 'fill-warning/70', danger: 'fill-danger/70' } as const;

function useWidth(min = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(min, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, width] as const;
}

// ── Ma trận ROAS × chi phí ───────────────────────────────────────────────────
export function RoasMatrix({ rows, currency, target: initialTarget, onPick }: { rows: CountryStat[]; currency: string; target: number | null; onPick: (c: string) => void }) {
  const [ref, width] = useWidth();
  const [target, setTarget] = useState(initialTarget ?? 1);
  const [hover, setHover] = useState<string | null>(null);
  const pts = rows.filter((r) => r.spend > 0);
  const q = quadrants(pts, target);
  const height = 380;
  const pad = { l: 56, r: 16, t: 16, b: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const maxSpend = Math.max(1e-9, ...pts.map((p) => p.spend));
  const roasVals = pts.map((p) => p.roas ?? 0).sort((a, b) => a - b);
  const p95 = roasVals[Math.floor(roasVals.length * 0.95)] ?? 1;
  const maxRoas = Math.max(target * 2, Math.min(p95 * 1.15, target * 5), 0.5);
  const maxInst = Math.max(1, ...pts.map((p) => p.installs));
  // Trục X căn bậc hai: nước chi ít không dồn hết vào góc
  const x = (s: number) => pad.l + Math.sqrt(s / maxSpend) * w;
  const y = (r: number) => pad.t + h - (Math.min(r, maxRoas) / maxRoas) * h;
  const rad = (i: number) => 4 + Math.sqrt(i / maxInst) * 14;
  const hv = pts.find((p) => p.country === hover);
  const groups = (Object.keys(QUADRANT) as Quadrant[]).map((k) => ({ k, list: pts.filter((p) => q.of(p) === k).sort((a, b) => b.spend - a.spend) }));
  const xTicks = [0, 0.25, 0.5, 1].map((f) => f * f * maxSpend);

  if (!pts.length) return <Card className="p-6 text-center text-sm text-muted">Chưa có nước nào có chi phí trong kỳ.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Ma trận ROAS × chi phí</h2>
          <span className="text-xs text-muted">Mỗi bong bóng là một nước · to = nhiều cài · nhấp để xem chi tiết</span>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Ngưỡng ROAS
            <Input type="number" min={1} max={1000} step={5} className="h-7 w-20 text-right" value={Math.round(target * 100)}
              onChange={(e) => setTarget(Math.max(0.01, Number(e.target.value) / 100 || 1))} aria-label="Ngưỡng ROAS (%)" />
            %
          </label>
        </div>
        <div ref={ref} className="relative">
          <svg width={width} height={height} role="img" aria-label="Ma trận ROAS theo chi phí">
            {/* Nền 4 góc */}
            <rect x={x(q.mid)} y={pad.t} width={pad.l + w - x(q.mid)} height={y(target) - pad.t} className="fill-success/5" />
            <rect x={pad.l} y={pad.t} width={x(q.mid) - pad.l} height={y(target) - pad.t} className="fill-info/5" />
            <rect x={x(q.mid)} y={y(target)} width={pad.l + w - x(q.mid)} height={pad.t + h - y(target)} className="fill-danger/5" />
            <rect x={pad.l} y={y(target)} width={x(q.mid) - pad.l} height={pad.t + h - y(target)} className="fill-warning/5" />
            <line x1={pad.l} x2={pad.l + w} y1={y(target)} y2={y(target)} className="stroke-success" strokeDasharray="6 4" />
            <line x1={x(q.mid)} x2={x(q.mid)} y1={pad.t} y2={pad.t + h} className="stroke-muted/50" strokeDasharray="4 4" />
            <text x={pad.l + w - 4} y={pad.t + 14} textAnchor="end" className="fill-success text-[11px] font-semibold">{QUADRANT.star.label}</text>
            <text x={pad.l + 6} y={pad.t + 14} className="fill-info text-[11px] font-semibold">{QUADRANT.scale.label}</text>
            <text x={pad.l + w - 4} y={pad.t + h - 6} textAnchor="end" className="fill-danger text-[11px] font-semibold">{QUADRANT.cut.label}</text>
            <text x={pad.l + 6} y={pad.t + h - 6} className="fill-warning text-[11px] font-semibold">{QUADRANT.watch.label}</text>
            {[0, 0.5, 1, 1.5, 2].map((f) => f * target).filter((v) => v <= maxRoas).map((v) => (
              <text key={v} x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px] tabular-nums">{fmtPct(v, 0)}</text>
            ))}
            {xTicks.map((v) => (
              <text key={v} x={x(v)} y={height - 18} textAnchor="middle" className="fill-muted text-[10px] tabular-nums">{fmtMoney(v, currency).replace(/[,.]00(?=\D*$)/, '')}</text>
            ))}
            <text x={pad.l + w / 2} y={height - 3} textAnchor="middle" className="fill-muted text-[10px]">Chi phí trong kỳ →</text>
            {pts.map((p) => {
              const tone = QUADRANT[q.of(p)!].tone;
              return (
                <g key={p.country} onMouseEnter={() => setHover(p.country)} onMouseLeave={() => setHover(null)} onClick={() => onPick(p.country)} className="cursor-pointer">
                  <circle cx={x(p.spend)} cy={y(p.roas ?? 0)} r={rad(p.installs)} className={cx(TONE_FILL[tone], hover === p.country ? 'stroke-text' : 'stroke-surface')} strokeWidth={1.5} />
                  {rad(p.installs) >= 9 && <text x={x(p.spend)} y={y(p.roas ?? 0) + 3.5} textAnchor="middle" className="pointer-events-none fill-text text-[9px] font-semibold">{p.country}</text>}
                </g>
              );
            })}
          </svg>
          {hv && (
            <div className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: Math.min(x(hv.spend) + 12, width - 190), top: Math.max(0, y(hv.roas ?? 0) - 20) }}>
              <p className="font-medium">{flag(hv.country)} {getCountry(hv.country)?.name ?? hv.country}</p>
              <p>Chi phí <span className="num">{fmtMoney(hv.spend, currency)}</span> · ROAS <span className="num">{hv.roas == null ? '—' : fmtPct(hv.roas, 0)}</span></p>
              <p>Cài <span className="num">{fmtNumber(hv.installs)}</span> · CPI <span className="num">{hv.cpi == null ? '—' : fmtMoney(hv.cpi, currency)}</span></p>
            </div>
          )}
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map(({ k, list }) => (
          <Card key={k} className="p-3">
            <p className={cx('text-sm font-semibold', TONE_TEXT[QUADRANT[k].tone])}>{QUADRANT[k].label} <span className="num font-normal text-muted">· {list.length}</span></p>
            <p className="mb-2 text-xs text-muted">{QUADRANT[k].hint}</p>
            <ul className="flex flex-col gap-0.5 text-sm">
              {list.slice(0, 8).map((p) => (
                <li key={p.country}>
                  <button className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-2" onClick={() => onPick(p.country)}>
                    <span aria-hidden>{flag(p.country)}</span>
                    <span className="flex-1 truncate">{getCountry(p.country)?.name ?? p.country}</span>
                    <span className="num text-xs text-muted">{fmtMoney(p.spend, currency)}</span>
                    <span className="num w-12 text-right text-xs font-medium">{p.roas == null ? '—' : fmtPct(p.roas, 0)}</span>
                  </button>
                </li>
              ))}
              {list.length > 8 && <li className="px-1 text-xs text-muted">+{list.length - 8} nước khác</li>}
              {!list.length && <li className="px-1 text-xs text-muted">Không có</li>}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Bản đồ nhiệt quốc gia × ngày ─────────────────────────────────────────────
type HeatMetric = 'roas' | 'spend' | 'revenue' | 'installs' | 'profit';
const HEAT_LABEL: Record<HeatMetric, string> = { roas: 'ROAS', spend: 'Chi phí', revenue: 'Doanh thu QC', profit: 'Lợi nhuận', installs: 'Cài đặt' };

export function HeatmapView({ heat, currency, target, onPick }: { heat: Heatmap; currency: string; target: number | null; onPick: (c: string) => void }) {
  const [metric, setMetric] = useState<HeatMetric>('roas');
  const t = target ?? 1;
  // Kỳ dài: gộp theo tuần để ô không quá nhỏ
  const { dates, cells } = useMemo(() => {
    if (heat.dates.length <= 45) return heat;
    const keys: string[] = [];
    const idx: number[] = [];
    heat.dates.forEach((d, i) => {
      const [yy, mm, dd] = d.split('-').map(Number);
      const wd = (new Date(yy, mm - 1, dd).getDay() + 6) % 7;
      if (i === 0 || wd === 0) keys.push(d);
      idx.push(keys.length - 1);
    });
    return {
      dates: keys,
      cells: heat.cells.map((line) => {
        const out = keys.map(() => ({ spend: 0, revenue: 0, installs: 0 }));
        line.forEach((c, i) => {
          out[idx[i]].spend += c.spend;
          out[idx[i]].revenue += c.revenue;
          out[idx[i]].installs += c.installs;
        });
        return out;
      }),
    };
  }, [heat]);
  const weekly = dates.length !== heat.dates.length;
  const valueOf = (c: { spend: number; revenue: number; installs: number }) =>
    metric === 'roas' ? (c.spend > 0 ? c.revenue / c.spend : null) : metric === 'profit' ? c.revenue - c.spend : c[metric];
  const maxAbs = Math.max(1e-9, ...cells.flat().map((c) => Math.abs(valueOf(c) ?? 0)));
  const maxSpend = Math.max(1e-9, ...cells.flat().map((c) => c.spend));

  const style = (c: { spend: number; revenue: number; installs: number }) => {
    const v = valueOf(c);
    if (v == null || (metric !== 'roas' && v === 0)) return { className: 'bg-surface-2', style: undefined };
    if (metric === 'roas') {
      const tone = v >= t ? 'success' : v >= t * 0.5 ? 'warning' : 'danger';
      // Đậm theo chi phí của ô: ô chi ít mờ đi để không hoảng vì nhiễu
      const a = 0.25 + 0.75 * Math.sqrt(c.spend / maxSpend);
      return { className: '', style: { backgroundColor: `rgb(var(--${tone}) / ${a.toFixed(2)})` } };
    }
    const a = 0.12 + 0.88 * (Math.abs(v) / maxAbs);
    const tone = metric === 'profit' ? (v < 0 ? 'danger' : 'success') : metric === 'revenue' ? 'accent-2' : 'accent';
    return { className: '', style: { backgroundColor: `rgb(var(--${tone}) / ${a.toFixed(2)})` } };
  };
  const fmtV = (v: number | null) => (v == null ? '—' : metric === 'roas' ? fmtPct(v, 0) : metric === 'installs' ? fmtNumber(v) : fmtMoney(v, currency));

  if (!heat.countries.length) return <Card className="p-6 text-center text-sm text-muted">Chưa có dữ liệu trong kỳ.</Card>;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Theo ngày × quốc gia</h2>
        <span className="text-xs text-muted">Top {heat.countries.length} nước theo chi phí{weekly && ' · gộp theo tuần'}</span>
        <div className="flex-1" />
        <Select className="w-40" aria-label="Chỉ số bản đồ nhiệt" value={metric} onChange={(e) => setMetric(e.target.value as HeatMetric)}>
          {(Object.keys(HEAT_LABEL) as HeatMetric[]).map((m) => <option key={m} value={m}>{HEAT_LABEL[m]}</option>)}
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface" />
              {dates.map((d, i) => (
                <th key={d} className="min-w-7 px-0.5 font-normal text-muted tabular-nums">{i % Math.ceil(dates.length / 20) === 0 ? d.slice(5).replace('-', '/') : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.countries.map((c, ci) => (
              <tr key={c}>
                <th className="sticky left-0 bg-surface pr-2 text-left font-normal whitespace-nowrap">
                  <button className="hover:text-accent" onClick={() => onPick(c)}><span aria-hidden>{flag(c)}</span> {c}</button>
                </th>
                {cells[ci].map((cell, di) => {
                  const st = style(cell);
                  return (
                    <td key={di} className={cx('h-6 min-w-7 rounded-sm', st.className)} style={st.style}
                      title={`${c} · ${weekly ? `tuần từ ${dates[di]}` : dates[di]}\n${HEAT_LABEL[metric]}: ${fmtV(valueOf(cell))}\nChi phí ${fmtMoney(cell.spend, currency)} · Doanh thu ${fmtMoney(cell.revenue, currency)}`} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {metric === 'roas' && (
        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-success" aria-hidden /> ≥ {fmtPct(t, 0)}</span>
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-warning" aria-hidden /> {fmtPct(t * 0.5, 0)}–{fmtPct(t, 0)}</span>
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-danger" aria-hidden /> &lt; {fmtPct(t * 0.5, 0)}</span>
          <span className="flex items-center gap-1"><TrendingUp className="size-3" aria-hidden /> Ô càng đậm càng chi nhiều · ô xám = không chi</span>
        </p>
      )}
    </Card>
  );
}
