import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Copy, LayoutGrid, XCircle } from 'lucide-react';
import { FORMAT_LABEL, delta, type BreakRow, type DailyPoint, type MetricKind, type UnitFlag } from '@shared/analytics';
import { flag } from '@shared/geo';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { qk } from '@/lib/queries';
import { fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { SeverityPills, Skeleton, cx } from '@/components/ui';
import { Drawer } from '@/components/drawer';
import { toast } from '@/components/toast';
import { TrendChart, type Series } from './Chart';
import { useAnalyticsRange } from './RangePicker';
import { Segmented } from './Overview';
import { CompactTable, DeltaSmall, FlagList, StatGrid, countFlags, pctOf, type DrawerNav } from './parts';
import type { ExtraCol } from './DataTable';

// Phân tích theo ad unit: doanh thu, eCPM, fill, show rate, CTR — số AdMob; tách thêm theo nguồn mediation.

const SOURCE_COLORS = ['accent', 'accent-2', 'success', 'warning', 'info'] as const;

export function FlagIcon({ f }: { f: UnitFlag }) {
  const Icon = f.level === 'danger' ? XCircle : AlertTriangle;
  return <Icon className={cx('size-4 shrink-0', f.level === 'danger' ? 'text-danger' : 'text-warning')} aria-label={f.level === 'danger' ? 'Cờ đỏ' : 'Cờ vàng'} />;
}


export const unitExtras: ExtraCol<BreakRow>[] = [
  {
    id: 'format',
    header: 'Định dạng',
    sort: (r) => r.format ?? '',
    cell: (r) => <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs">{FORMAT_LABEL[r.format ?? ''] ?? (r.format || '—')}</span>,
  },
  { id: 'unitApp', header: 'App', sort: (r) => r.appName ?? '', cell: (r) => (r.appName ? <span className="block max-w-40 truncate text-xs">{r.appName}</span> : null) },
  {
    id: 'flags',
    header: 'Cờ',
    last: true,
    sort: (r) => (r.flags ?? []).reduce((s, f) => s + (f.level === 'danger' ? 10 : 1), 0),
    cell: (r) => <SeverityPills {...countFlags(r.flags)} title={(r.flags ?? []).map((f) => `• ${f.message}`).join('\n')} />,
  },
];

type UnitMetric = 'revenue' | 'ecpm' | 'adImpressions' | 'fill' | 'show' | 'ctr';
const UNIT_METRIC: Record<UnitMetric, { label: string; kind: MetricKind; get: (p: DailyPoint) => number | null; bar?: boolean }> = {
  revenue: { label: 'Doanh thu', kind: 'money', get: (p) => p.revenue, bar: true },
  ecpm: { label: 'eCPM', kind: 'money', get: (p) => (p.adImpressions ? (p.revenue * 1000) / p.adImpressions : null) },
  adImpressions: { label: 'Hiển thị', kind: 'count', get: (p) => p.adImpressions, bar: true },
  fill: { label: 'Fill', kind: 'pct', get: (p) => (p.requests ? p.matched / p.requests : null) },
  show: { label: 'Show', kind: 'pct', get: (p) => (p.matched ? p.adImpressions / p.matched : null) },
  ctr: { label: 'CTR', kind: 'pct', get: (p) => (p.adImpressions ? p.adClicks / p.adImpressions : null) },
};


export function AdUnitDrawer({ row, currency, nav, onClose, onOpenCountry }: { row: BreakRow; currency: string; nav: DrawerNav; onClose: () => void; onOpenCountry: (c: string) => void }) {
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const range = useAnalyticsRange();
  const q = useQuery({ queryKey: qk.analyticsUnit(appId, range, row.key), queryFn: () => api.analytics.adUnit(appId, range, row.key) });
  const [tab, setTab] = useState('overview');
  const [metric, setMetric] = useState<UnitMetric>('revenue');
  const [bySource, setBySource] = useState(false);
  const money = (v: number | null) => (v == null ? '—' : fmtMoney(v, currency));
  const m = UNIT_METRIC[metric];
  const sourceFlagCount = (q.data?.sources ?? []).filter((s) => s.flags?.length).length;
  const series: Series[] = !q.data
    ? []
    : bySource
      ? q.data.sourceDaily.map((x, i) => ({ label: x.source, values: x.points.map(m.get), kind: 'line' as const, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }))
      : [{ label: m.label, values: q.data.daily.map(m.get), kind: m.bar ? 'bar' : 'line', color: metric === 'revenue' ? 'accent-2' : 'accent' }];

  return (
    <Drawer
      title={row.label}
      leading={<span className="grid size-9 place-items-center rounded-lg bg-accent-2/10 text-accent-2"><LayoutGrid className="size-5" aria-hidden /></span>}
      subtitle={
        <>
          <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-medium text-text">{FORMAT_LABEL[row.format ?? ''] ?? row.format}</span>
          {row.appName && <span>{row.appName}</span>}
          <span className="font-mono">{row.key}</span>
          <button className="rounded-sm p-0.5 hover:bg-surface-2 hover:text-text" aria-label="Sao chép ad unit ID" title="Sao chép ID"
            onClick={() => void navigator.clipboard.writeText(row.key).then(() => toast({ tone: 'success', title: 'Đã sao chép ad unit ID' }))}>
            <Copy className="size-3.5" aria-hidden />
          </button>
        </>
      }
      nav={nav}
      onClose={onClose}
      tabs={[
        { id: 'overview', label: 'Tổng quan', badge: row.flags?.length ? <SeverityPills {...countFlags(row.flags)} /> : undefined },
        { id: 'sources', label: 'Nguồn mediation', badge: sourceFlagCount ? <span className="num rounded-full bg-warning/12 px-1.5 text-[11px] font-semibold text-warning">{sourceFlagCount}</span> : undefined },
        { id: 'countries', label: 'Quốc gia' },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <StatGrid cols={4} items={[
            { label: 'Doanh thu', value: money(row.revenue), d: delta(row.revenue, row.prev.revenue) },
            { label: 'eCPM', value: money(row.ecpm), d: delta(row.ecpm, row.prev.ecpm) },
            { label: 'Hiển thị', value: fmtNumber(row.adImpressions), d: delta(row.adImpressions, row.prev.adImpressions) },
            { label: 'Request', value: fmtNumber(row.adRequests), d: delta(row.adRequests, row.prev.adRequests) },
            { label: 'Fill rate', value: pctOf(row.fillRate), d: delta(row.fillRate, row.prev.fillRate), tone: row.fillRate != null && row.fillRate < 0.5 ? 'warning' : undefined },
            { label: 'Show rate', value: pctOf(row.showRate), d: delta(row.showRate, row.prev.showRate), tone: row.showRate != null && row.showRate < 0.4 ? 'warning' : undefined },
            { label: 'CTR QC', value: pctOf(row.adCtr), d: delta(row.adCtr, row.prev.adCtr), goodUp: false, tone: row.adCtr != null && row.adCtr > 0.08 ? 'danger' : undefined },
            { label: 'Thu / 1k request', value: money(row.adRequests ? (row.revenue * 1000) / row.adRequests : null) },
          ]} />
          <FlagList flags={row.flags ?? []} />
          {q.isLoading ? <Skeleton className="h-52" /> : q.data && (
            <section>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold">Theo ngày</h3>
                <Segmented size="xs" label="Chỉ số ad unit" value={metric} onChange={(v) => setMetric(v as UnitMetric)} options={(Object.keys(UNIT_METRIC) as UnitMetric[]).map((k) => [k, UNIT_METRIC[k].label])} />
              </div>
              <label className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={bySource} disabled={!q.data.sourceDaily.length} onChange={(e) => setBySource(e.target.checked)} />
                Tách theo nguồn (top {q.data.sourceDaily.length || 5})
              </label>
              <TrendChart dates={q.data.daily.map((p) => p.date)} series={series} kind={m.kind} currency={currency} height={200} ariaLabel={`${row.label} theo ngày`} />
            </section>
          )}
        </div>
      )}
      {tab === 'sources' && (q.isLoading ? <Skeleton className="h-52" /> : q.data && <SourceTable rows={q.data.sources} unitRevenue={row.revenue} currency={currency} />)}
      {tab === 'countries' && (q.isLoading ? <Skeleton className="h-52" /> : q.data && (
        <CompactTable
          empty="Chưa có số trong kỳ."
          head={['Nước', 'Doanh thu', 'eCPM', 'Fill', 'Show']}
          rows={q.data.countries.map((c) => ({
            key: c.key,
            onClick: () => onOpenCountry(c.key),
            cells: [
              <span key="c"><span aria-hidden>{flag(c.key)}</span> {c.label}</span>,
              money(c.revenue),
              <span key="e" className="whitespace-nowrap">{money(c.ecpm)} <DeltaSmall v={delta(c.ecpm, c.prev.ecpm)} /></span>,
              <span key="f" className={cx(c.fillRate != null && c.fillRate < 0.5 && 'text-warning')}>{pctOf(c.fillRate)}</span>,
              <span key="s" className={cx(c.showRate != null && c.showRate < 0.4 && 'text-warning')}>{pctOf(c.showRate)}</span>,
            ],
          }))}
        />
      ))}
    </Drawer>
  );
}

// Nguồn mediation trong unit: xếp theo doanh thu (đóng góp) hoặc eCPM (giống thứ tự waterfall)
export function SourceTable({ rows, unitRevenue, currency }: { rows: BreakRow[]; unitRevenue: number; currency: string }) {
  const [order, setOrder] = useState<'revenue' | 'ecpm'>('revenue');
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => [...rows].sort((a, b) => (order === 'revenue' ? b.revenue - a.revenue : (b.ecpm ?? -1) - (a.ecpm ?? -1))), [rows, order]);
  const money = (v: number | null) => (v == null ? '—' : fmtMoney(v, currency));
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">Chưa có số theo nguồn — bấm Đồng bộ để kéo báo cáo ad unit × nguồn.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="mr-auto text-xs text-muted">Bấm nguồn có cờ để xem lý do</p>
        <Segmented size="xs" label="Xếp nguồn theo" value={order} onChange={(v) => setOrder(v as 'revenue' | 'ecpm')} options={[['revenue', 'Doanh thu'], ['ecpm', 'eCPM']]} />
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Nguồn</th>
              <th className="px-2 text-right font-medium">Doanh thu</th>
              <th className="px-2 text-right font-medium">eCPM</th>
              <th className="px-2 text-right font-medium" title="Matched ÷ request gửi tới nguồn">Fill</th>
              <th className="px-2 text-right font-medium" title="Hiển thị ÷ matched">Show</th>
              <th className="w-14 pr-3 text-right font-medium">Cờ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r) => {
              const share = unitRevenue > 0 ? r.revenue / unitRevenue : 0;
              const fl = r.flags ?? [];
              const isOpen = open === r.key;
              return (
                <Fragment key={r.key}>
                  <tr className={cx(fl.length > 0 && 'cursor-pointer hover:bg-surface-2', isOpen && 'bg-surface-2')} onClick={() => fl.length && setOpen(isOpen ? null : r.key)} aria-expanded={fl.length ? isOpen : undefined}>
                    <td className="max-w-48 px-3 py-2">
                      <span className="block truncate font-medium" title={r.label}>{r.label}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden><span className="block h-full rounded-full bg-accent-2/70" style={{ width: `${Math.min(100, share * 100)}%` }} /></span>
                        {fmtPct(share, 0)} doanh thu
                      </span>
                    </td>
                    <td className="num px-2">{money(r.revenue)}</td>
                    <td className="num px-2 whitespace-nowrap">{money(r.ecpm)}<br /><DeltaSmall v={delta(r.ecpm, r.prev.ecpm)} /></td>
                    <td className={cx('num px-2', r.fillRate != null && r.adRequests >= 5000 && r.fillRate < 0.05 && 'text-warning')}>{pctOf(r.fillRate)}</td>
                    <td className={cx('num px-2', r.showRate != null && r.showRate < 0.5 && 'text-warning')}>{pctOf(r.showRate)}</td>
                    <td className="pr-3 text-right"><SeverityPills {...countFlags(fl)} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-surface-2">
                      <td colSpan={6} className="px-3 pb-2"><FlagList flags={fl} compact /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Fill của nguồn đấu giá (bidding) thường thấp vì chỉ thắng một phần phiên — so sánh eCPM và tỉ trọng là chính.</p>
    </div>
  );
}
