import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Megaphone } from 'lucide-react';
import { FORMAT_LABEL, delta, type AnalyticsResult, type BreakRow, type DailyPoint } from '@shared/analytics';
import { flag, getCountry } from '@shared/geo';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { qk } from '@/lib/queries';
import { fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { SeverityPills, Skeleton, StatusBadge } from '@/components/ui';
import { Drawer } from '@/components/drawer';
import { toast } from '@/components/toast';
import { TrendChart, chartSeries, type ChartMode } from './Chart';
import { useAnalyticsRange } from './RangePicker';
import { Segmented } from './Overview';
import { CompactTable, DeltaSmall, FlagList, StatGrid, countFlags, pctOf, useBreakdown, type DrawerNav } from './parts';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = { ENABLED: 'success', PAUSED: 'warning' };
export const STATUS_LABEL: Record<string, string> = { ENABLED: 'Đang chạy', PAUSED: 'Tạm dừng', REMOVED: 'Đã xóa' };
export function CampStatus({ s }: { s: string | null | undefined }) {
  return s ? <StatusBadge tone={STATUS_TONE[s] ?? 'neutral'}>{STATUS_LABEL[s] ?? s}</StatusBadge> : null;
}

const roasTone = (v: number | null, target: number | null) => (v == null ? undefined : v >= (target ?? 1) ? 'success' : 'danger') as 'success' | 'danger' | undefined;

function DailyBlock({ daily, currency, target, modes }: { daily: DailyPoint[]; currency: string; target: number | null; modes: [ChartMode, string][] }) {
  const [mode, setMode] = useState<ChartMode>(modes[0][0]);
  const { series, kind } = chartSeries(mode, daily, null);
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">Theo ngày</h3>
        <Segmented size="xs" label="Biểu đồ" value={mode} onChange={(v) => setMode(v as ChartMode)} options={modes} />
      </div>
      <TrendChart dates={daily.map((p) => p.date)} series={series} kind={kind} currency={currency} height={200} ariaLabel="Theo ngày"
        refLine={mode === 'roas' && target != null ? { value: target, label: `Ngưỡng ${fmtPct(target, 0)}` } : undefined} />
    </section>
  );
}

// ── Quốc gia ────────────────────────────────────────────────────────────────
export function CountryDrawer({ country, d, nav, onClose, onOpenCampaign, onOpenUnit }: {
  country: string;
  d: AnalyticsResult;
  nav: DrawerNav;
  onClose: () => void;
  onOpenCampaign: (id: string) => void;
  onOpenUnit: (id: string) => void;
}) {
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const range = useAnalyticsRange();
  const [tab, setTab] = useState('overview');
  const stat = d.countries.find((c) => c.country === country);
  const q = useQuery({ queryKey: qk.analyticsCountry(appId, range, country), queryFn: () => api.analytics.country(appId, range, country) });
  const camps = useBreakdown('campaign', country);
  const units = useBreakdown('adUnit', country);
  const formats = useBreakdown('format', country);
  const money = (v: number | null) => (v == null ? '—' : fmtMoney(v, d.currency));
  const share = stat && d.kpis.spend > 0 ? stat.spend / d.kpis.spend : null;
  const alerts = stat?.alerts ?? [];

  return (
    <Drawer
      title={getCountry(country)?.name ?? country}
      leading={<span className="grid size-9 place-items-center rounded-lg bg-surface-2 text-2xl leading-none" aria-hidden>{flag(country)}</span>}
      subtitle={
        <>
          <span className="font-mono">{country}</span>
          {share != null && <span>· {fmtPct(share, 0)} chi phí</span>}
          {stat && stat.revenue > 0 && d.kpis.revenue > 0 && <span>· {fmtPct(stat.revenue / d.kpis.revenue, 0)} doanh thu</span>}
        </>
      }
      nav={nav}
      onClose={onClose}
      tabs={[
        { id: 'overview', label: 'Tổng quan', badge: alerts.length ? <SeverityPills {...countFlags(alerts)} /> : undefined },
        { id: 'campaigns', label: 'Camp', badge: camps.data?.rows.length ? <span className="num text-xs text-muted">{camps.data.rows.length}</span> : undefined },
        { id: 'monetization', label: 'Kiếm tiền' },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {stat ? (
            <StatGrid items={[
              { label: 'Chi phí', value: money(stat.spend), d: delta(stat.spend, stat.prev.spend), goodUp: false },
              { label: 'Doanh thu QC', value: money(stat.revenue), d: delta(stat.revenue, stat.prev.revenue) },
              { label: 'ROAS', value: stat.roas == null ? '—' : fmtPct(stat.roas, 0), d: delta(stat.roas, stat.prev.roas), tone: roasTone(stat.roas, d.roasTarget) },
              { label: 'Cài đặt', value: fmtNumber(stat.installs), d: delta(stat.installs, stat.prev.installs) },
              { label: 'CPI', value: money(stat.cpi), d: delta(stat.cpi, stat.prev.cpi), goodUp: false },
              { label: 'Lợi nhuận', value: money(stat.profit), tone: stat.profit < 0 ? 'danger' : stat.profit > 0 ? 'success' : undefined },
              { label: 'eCPM', value: money(stat.ecpm), d: delta(stat.ecpm, stat.prev.ecpm) },
              { label: 'Show rate', value: pctOf(stat.showRate), d: delta(stat.showRate, stat.prev.showRate) },
              { label: 'CTR QC', value: pctOf(stat.ctr), tone: stat.ctr != null && stat.ctr > 0.08 ? 'danger' : undefined },
            ]} />
          ) : (
            <p className="text-sm text-muted">Không có số trong kỳ.</p>
          )}
          <FlagList flags={alerts} />
          {q.isLoading ? <Skeleton className="h-52" /> : q.data && (
            <DailyBlock daily={q.data.daily} currency={d.currency} target={d.roasTarget} modes={[['combo', 'Chi & thu'], ['roas', 'ROAS'], ['cpi', 'CPI'], ['installs', 'Cài'], ['cumulative', 'Lũy kế']]} />
          )}
        </div>
      )}
      {tab === 'campaigns' && (camps.isLoading ? <Skeleton className="h-40" /> : (
        <>
          <CompactTable
            empty="Không có camp nào chi tiêu ở nước này trong kỳ."
            head={['Camp', 'Chi phí', 'Cài', 'CPI', 'ROAS']}
            rows={(camps.data?.rows ?? []).map((r) => ({
              key: r.key,
              onClick: () => onOpenCampaign(r.key),
              cells: [
                <span key="n" className="flex min-w-0 items-center gap-1.5"><span className="truncate" title={r.label}>{r.label}</span>{r.status === 'PAUSED' && <span className="shrink-0 text-[11px] text-warning">tạm dừng</span>}</span>,
                money(r.spend),
                fmtNumber(r.installs),
                money(r.cpi),
                <span key="r" className={r.roas != null && d.roasTarget != null ? (r.roas >= d.roasTarget ? 'text-success' : 'text-danger') : ''}>{r.roas == null ? '—' : fmtPct(r.roas, 0)}</span>,
              ],
            }))}
          />
          <p className="mt-2 text-xs text-muted">Số của camp chỉ tính phần chi tiêu ở {country}. Bấm camp để xem toàn bộ camp.</p>
        </>
      ))}
      {tab === 'monetization' && (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Ad unit</h3>
            {units.isLoading ? <Skeleton className="h-24" /> : (
              <CompactTable
                empty="Chưa có số theo ad unit cho nước này."
                head={['Ad unit', 'Doanh thu', 'eCPM', 'Fill', 'Show']}
                rows={(units.data?.rows ?? []).map((r) => ({
                  key: r.key,
                  onClick: () => onOpenUnit(r.key),
                  cells: [r.label, money(r.revenue), <span key="e">{money(r.ecpm)} <DeltaSmall v={delta(r.ecpm, r.prev.ecpm)} /></span>, pctOf(r.fillRate), pctOf(r.showRate)],
                }))}
              />
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Định dạng</h3>
            <CompactTable
              empty="Chưa có doanh thu AdMob cho nước này."
              head={['Định dạng', 'Doanh thu', 'eCPM', 'Show']}
              rows={(formats.data?.rows ?? []).map((r) => ({ key: r.key, cells: [FORMAT_LABEL[r.key] ?? r.label, money(r.revenue), money(r.ecpm), pctOf(r.showRate)] }))}
            />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Nguồn mediation</h3>
            <CompactTable
              empty="Chưa có doanh thu AdMob cho nước này."
              head={['Nguồn', 'Doanh thu', 'eCPM', 'Match']}
              rows={(q.data?.sources ?? []).map((s) => ({ key: s.adSource, cells: [s.adSource, money(s.revenue), money(s.ecpm), pctOf(s.matchRate)] }))}
            />
          </section>
        </div>
      )}
    </Drawer>
  );
}

// ── Camp ────────────────────────────────────────────────────────────────────
export function CampaignDrawer({ row, currency, target, nav, onClose, onOpenCountry }: {
  row: BreakRow;
  currency: string;
  target: number | null;
  nav: DrawerNav;
  onClose: () => void;
  onOpenCountry: (c: string) => void;
}) {
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const range = useAnalyticsRange();
  const [tab, setTab] = useState('overview');
  const q = useQuery({ queryKey: ['analytics', 'campaign', appId, range, row.key], queryFn: () => api.analytics.campaign(appId, range, row.key) });
  const money = (v: number | null) => (v == null ? '—' : fmtMoney(v, currency));

  return (
    <Drawer
      title={row.label}
      leading={<span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent"><Megaphone className="size-5" aria-hidden /></span>}
      subtitle={
        <>
          <CampStatus s={row.status} />
          {row.country && <span><span aria-hidden>{flag(row.country)}</span> {row.country}</span>}
          {row.budget != null && <span>· Ngân sách {money(row.budget)}/ngày</span>}
          {row.targetCpa != null && <span>· tCPI {money(row.targetCpa)}</span>}
          {row.targetRoas != null && <span>· tROAS {fmtPct(row.targetRoas, 0)}</span>}
          <span className="font-mono">#{row.key}</span>
          <button className="rounded-sm p-0.5 hover:bg-surface-2 hover:text-text" aria-label="Sao chép ID camp" title="Sao chép ID"
            onClick={() => void navigator.clipboard.writeText(row.key).then(() => toast({ tone: 'success', title: 'Đã sao chép ID camp' }))}>
            <Copy className="size-3.5" aria-hidden />
          </button>
        </>
      }
      nav={nav}
      onClose={onClose}
      tabs={[{ id: 'overview', label: 'Tổng quan' }, { id: 'countries', label: 'Quốc gia', badge: q.data?.countries.length ? <span className="num text-xs text-muted">{q.data.countries.length}</span> : undefined }]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <StatGrid items={[
            { label: 'Chi phí', value: money(row.spend), d: delta(row.spend, row.prev.spend), goodUp: false },
            { label: 'Cài đặt', value: fmtNumber(row.installs), d: delta(row.installs, row.prev.installs) },
            { label: 'CPI', value: money(row.cpi), d: delta(row.cpi, row.prev.cpi), goodUp: false, tone: row.targetCpa != null && row.cpi != null && row.cpi > row.targetCpa * 1.3 ? 'warning' : undefined },
            { label: 'Doanh thu (ước tính)', value: money(row.revenue), d: delta(row.revenue, row.prev.revenue), hint: 'Doanh thu của (ngày, app, nước) chia theo tỉ lệ chi phí của camp' },
            { label: 'ROAS (ước tính)', value: row.roas == null ? '—' : fmtPct(row.roas, 0), d: delta(row.roas, row.prev.roas), tone: roasTone(row.roas, target) },
            { label: 'Lợi nhuận', value: money(row.profit), tone: row.profit < 0 ? 'danger' : row.profit > 0 ? 'success' : undefined },
            { label: 'CTR Ads', value: pctOf(row.adsCtr), d: delta(row.adsCtr, row.prev.adsCtr) },
            { label: 'Tỉ lệ cài', value: pctOf(row.cvr), d: delta(row.cvr, row.prev.cvr) },
            { label: 'Hiển thị Ads', value: fmtNumber(row.adsImpressions), d: delta(row.adsImpressions, row.prev.adsImpressions) },
          ]} />
          {q.isLoading ? <Skeleton className="h-52" /> : q.data && (
            <DailyBlock daily={q.data.daily} currency={currency} target={target} modes={[['combo', 'Chi & thu'], ['installs', 'Cài'], ['cpi', 'CPI'], ['roas', 'ROAS'], ['cumulative', 'Lũy kế']]} />
          )}
          <p className="text-xs text-muted">Doanh thu và ROAS của camp là ước lượng: AdMob không biết người dùng đến từ camp nào.</p>
        </div>
      )}
      {tab === 'countries' && (q.isLoading ? <Skeleton className="h-40" /> : (
        <CompactTable
          empty="Chưa có số trong kỳ."
          head={['Nước', 'Chi phí', 'Cài', 'CPI', 'ROAS']}
          rows={(q.data?.countries ?? []).map((c) => ({
            key: c.key,
            onClick: () => onOpenCountry(c.key),
            cells: [
              <span key="c"><span aria-hidden>{flag(c.key)}</span> {c.label}</span>,
              money(c.spend),
              fmtNumber(c.installs),
              <span key="p">{money(c.cpi)} <DeltaSmall v={delta(c.cpi, c.prev.cpi)} goodUp={false} /></span>,
              <span key="r" className={roasTone(c.roas, target) === 'danger' ? 'text-danger' : roasTone(c.roas, target) === 'success' ? 'text-success' : ''}>{c.roas == null ? '—' : fmtPct(c.roas, 0)}</span>,
            ],
          }))}
        />
      ))}
    </Drawer>
  );
}
