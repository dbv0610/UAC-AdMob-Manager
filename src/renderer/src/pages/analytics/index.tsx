import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, Download, FileSpreadsheet, Filter, RefreshCw, Settings2, Sparkles, X } from 'lucide-react';
import { describeChange } from '@shared/insights';
import { newRow, type PlanDraft } from '@shared/plan';
import { AiSummaryDrawer } from './AiSummary';
import {
  PRESET_LABEL,
  daysBetween,
  insightsOf,
  isoDate,
  resolveRange,
  type AnalyticsResult,
  type BreakRow,
  type CountryStat,
  type Dim,
} from '@shared/analytics';
import { flag, getCountry } from '@shared/geo';
import { api } from '@/lib/api';
import { navigate, setState, useUi } from '@/lib/store';
import { qk, useApps } from '@/lib/queries';
import { fmtMoney, fmtPct } from '@/lib/format';
import { Banner, Button, Card, EmptyState, SeverityPills, Skeleton, cx } from '@/components/ui';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import type { ChartMode } from './Chart';
import { RangePicker, useAnalyticsRange } from './RangePicker';
import { DataTable, type ExtraCol, type NumCol, type TableRow } from './DataTable';
import { HeatmapView, RoasMatrix } from './Visuals';
import { KpiCards, TrendCard } from './Overview';
import { AttentionPanel, DataHealth, RULE_LABEL, attentionItems } from './Attention';
import { AdUnitDrawer, unitExtras } from './AdUnits';
import { CampStatus, CampaignDrawer, CountryDrawer } from './Drawers';
import { useBreakdown, type DrawerNav } from './parts';

export function useSyncReports() {
  const onError = useErrorHandler();
  return async (days = 3) => {
    try {
      await api.analytics.sync(days);
      toast({ tone: 'info', title: `Đang đồng bộ báo cáo ${days} ngày gần nhất`, detail: 'Theo dõi tiến trình ở hàng đợi job (Ctrl/⌘ J)' });
    } catch (err) {
      onError(err);
    }
  };
}

type Tab = Dim | 'matrix' | 'heat';
const TAB_LABEL: Record<Tab, string> = {
  country: 'Quốc gia',
  campaign: 'Camp',
  app: 'App',
  adUnit: 'Ad unit',
  format: 'Định dạng QC',
  source: 'Nguồn QC',
  matrix: 'Ma trận ROAS',
  heat: 'Theo ngày × nước',
};

type Open = { kind: 'country' | 'campaign' | 'adUnit'; key: string; keys: string[] } | null;
const countryName = (c: string) => getCountry(c)?.name ?? c;

export function Analytics() {
  const prefs = useUi((s) => s.prefs)!;
  const sync = useUi((s) => s.reportSync);
  const online = useUi((s) => s.online);
  const { data: apps = [] } = useApps();
  const appId = prefs.currentAppId;
  const range = useAnalyticsRange();
  const q = useQuery({ queryKey: qk.analytics(appId, range), queryFn: () => api.analytics.get(appId, range), placeholderData: (prev) => prev });
  const camps = useBreakdown('campaign', null);
  const units = useBreakdown('adUnit', null);
  const runSync = useSyncReports();
  const onError = useErrorHandler();
  const [tab, setTab] = useState<Tab>('country');
  const [focus, setFocus] = useState<{ countries: string[]; title: string } | null>(null);
  const [compare, setCompare] = useState(true);
  const [mode, setMode] = useState<ChartMode>('combo');
  const [by, setBy] = useState<'day' | 'week'>('day');
  const [open, setOpen] = useState<Open>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const changesQ = useQuery({ queryKey: ['changes', appId, range], queryFn: () => api.analytics.changes(appId, range, null) });

  const d = q.data;
  const app = apps.find((a) => a.id === appId);
  const tabs: Tab[] = ['country', 'campaign', ...(!appId && apps.length > 1 ? (['app'] as const) : []), 'adUnit', 'format', 'source', 'matrix', 'heat'];
  const activeTab = tabs.includes(tab) ? tab : 'country';
  const needDays = d ? daysBetween(d.range.prevFrom, isoDate(new Date())) : 0;
  const missingHistory = !!d && !!sync?.at && (!d.dataFrom || d.dataFrom > d.range.prevFrom) && needDays > 3;

  const attention = useMemo(
    () => (d ? attentionItems(d.alerts, insightsOf(d.countries, d.kpis, { target: d.roasTarget ?? 1, minSpend: Math.max(d.kpis.spend * 0.02, 1e-9), fmtPct: (v) => fmtPct(v, 0), fmtMoney: (v) => fmtMoney(v, d.currency) })) : []),
    [d],
  );

  // Ghi chú trên biểu đồ: thay đổi Google Ads theo ngày
  const notes = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of changesQ.data ?? []) {
      (m[e.date] ??= []).push(`${e.campaignName ?? 'Tài khoản'}: ${describeChange(e, (v) => fmtMoney(v / 1e6, d?.currency ?? 'USD'), (v) => fmtPct(v, 0))}`);
    }
    return m;
  }, [changesQ.data, d?.currency]);

  // Nước có doanh thu nhưng chưa chạy camp → thêm vào bản nháp kế hoạch (không xóa dòng đang có)
  const planFor = async (countries: string[]) => {
    try {
      const cur = await api.plans.getDraft();
      const have = new Set(cur?.rows.map((r) => r.countryCode) ?? []);
      const spending = (d?.countries ?? []).filter((c) => c.spend > 0).map((c) => c.spend).sort((a, b) => a - b);
      const days = d ? daysBetween(d.range.from, d.range.to) : 7;
      const budget = spending.length ? Math.round((spending[Math.floor(spending.length / 2)] / days) * 100) / 100 : 0;
      const add = countries.filter((c) => !have.has(c)).map((c) => newRow(c, { dailyBudget: budget }));
      const draft: PlanDraft = {
        id: cur?.id ?? crypto.randomUUID(),
        appId: cur?.appId ?? appId ?? apps[0]?.id ?? null,
        customerId: cur?.customerId ?? app?.adsCustomerId ?? prefs.currentAdsCustomerId,
        rows: [...(cur?.rows ?? []), ...add],
        step: 1,
        updatedAt: new Date().toISOString(),
      };
      await api.plans.saveDraft(draft);
      setState({ campaignsTab: 'new' });
      navigate('/campaigns');
      toast({ tone: 'success', title: `Đã thêm ${add.length} nước vào kế hoạch`, detail: `Ngân sách gợi ý ${fmtMoney(budget, d?.currency ?? 'USD')}/ngày (trung vị các nước đang chạy) — kiểm tra lại trước khi tạo camp` });
    } catch (err) {
      onError(err);
    }
  };

  // Mở ngăn chi tiết; keys = thứ tự để chuyển trước/sau (mặc định theo bảng tương ứng)
  const openItem = (kind: NonNullable<Open>['kind'], key: string, keys?: string[]) => {
    const fallback = kind === 'country' ? (d?.countries.map((c) => c.country) ?? []) : kind === 'campaign' ? (camps.data?.rows.map((r) => r.key) ?? []) : (units.data?.rows.map((r) => r.key) ?? []);
    const list = keys ?? fallback;
    setOpen({ kind, key, keys: list.includes(key) ? list : [key, ...list] });
  };
  const nav: DrawerNav | null = open && {
    index: open.keys.indexOf(open.key),
    total: open.keys.length,
    prev: () => setOpen((o) => o && { ...o, key: o.keys[Math.max(0, o.keys.indexOf(o.key) - 1)] }),
    next: () => setOpen((o) => o && { ...o, key: o.keys[Math.min(o.keys.length - 1, o.keys.indexOf(o.key) + 1)] }),
  };
  // Đổi app/kỳ thì đóng ngăn để không hiện số cũ
  useEffect(() => setOpen(null), [appId, JSON.stringify(range)]);

  const doExport = async (format: 'csv' | 'xlsx') => {
    const dim: Dim = activeTab === 'matrix' || activeTab === 'heat' ? 'country' : activeTab;
    try {
      const path = await api.analytics.export(appId, range, format, dim);
      if (path) toast({ tone: 'success', title: 'Đã xuất báo cáo', detail: path, action: { label: 'Mở thư mục', run: () => void api.analytics.revealExport(path) } });
    } catch (err) {
      onError(err);
    }
  };

  const earliest = useUi((s) => s.reportSync?.earliest ?? null);
  const r = resolveRange(range, undefined, earliest);
  const rangeLabel = typeof range === 'string' ? PRESET_LABEL[range] : 'Tự chọn';
  const unitFlagged = (units.data?.rows ?? []).filter((x) => x.flags?.length).length;
  const tabBadge = (t: Tab) => {
    if (!d) return null;
    if (t === 'country') {
      const red = d.alerts.filter((a) => a.level === 'danger').length;
      return red ? <SeverityPills danger={red} /> : <Count n={d.countries.length} />;
    }
    if (t === 'campaign') return camps.data ? <Count n={camps.data.rows.length} /> : null;
    if (t === 'adUnit') return unitFlagged ? <SeverityPills warning={unitFlagged} /> : units.data ? <Count n={units.data.rows.length} /> : null;
    return null;
  };

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 pb-10">
      <header className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="mt-0.5 truncate text-sm text-muted" title={`${rangeLabel}: ${r.from} → ${r.to} · so với ${r.prevFrom} → ${r.prevTo}`}>
            <span className="font-medium text-text">{app?.name ?? 'Tất cả app'}</span> · so với kỳ trước <span className="num">{r.prevFrom.slice(5).split('-').reverse().join('/')} – {r.prevTo.slice(5).split('-').reverse().join('/')}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button icon={Sparkles} onClick={() => setAiOpen(true)} disabled={!d?.hasData} title="Claude tóm tắt số liệu kỳ đang xem">Tóm tắt AI</Button>
        <RangePicker />
          <Button icon={RefreshCw} disabled={!online} onClick={() => void runSync(sync?.at ? 3 : 30)} title="Ctrl/⌘ R">Đồng bộ</Button>
          <ExportMenu disabled={!d?.hasData} tabLabel={TAB_LABEL[activeTab]} onExport={(f) => void doExport(f)} />
        </div>
      </header>

      <DataHealth sync={sync} d={d} online={online} onSync={(n) => void runSync(n)} needDays={needDays} missingHistory={missingHistory} />

      {q.isLoading ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}</div>
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          <Skeleton className="h-80 rounded-lg" />
        </>
      ) : q.isError ? (
        <Banner tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>Không đọc được dữ liệu báo cáo trên máy.</Banner>
      ) : !apps.length ? (
        <Card>
          <EmptyState icon={Settings2} title="Chưa map app" action={<Button variant="primary" onClick={() => navigate('/settings')}>Mở Cài đặt → App</Button>}>
            ROAS cần nối package ↔ AdMob app ID ↔ tài khoản Google Ads cho từng app.
          </EmptyState>
        </Card>
      ) : !d?.hasData ? (
        <Card>
          <EmptyState icon={BarChart3} title="Chưa có dữ liệu trong kỳ" action={<Button variant="primary" icon={RefreshCw} disabled={!online} onClick={() => void runSync(Math.max(30, Math.min(400, needDays)))}>Đồng bộ {Math.max(30, Math.min(400, needDays))} ngày qua</Button>}>
            {app && !app.admobAppId ? `${app.name} chưa có AdMob app ID nên sẽ chỉ có chi phí.` : 'Kéo chi phí Google Ads và doanh thu AdMob theo quốc gia về máy; sau đó mở màn này không cần gọi API.'}
          </EmptyState>
        </Card>
      ) : (
        <>
          <KpiCards d={d} mode={mode} setMode={setMode} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <TrendCard d={d} mode={mode} setMode={setMode} by={by} setBy={setBy} compare={compare} setCompare={setCompare} notes={notes} />
            {/* Cao bằng biểu đồ, danh sách tự cuộn */}
            <div className="relative min-h-80">
              <div className="flex h-full flex-col xl:absolute xl:inset-0">
                <AttentionPanel items={attention} onOpenCountry={(c) => openItem('country', c)}
                  onFilter={(countries, title) => { setFocus({ countries, title }); setTab('country'); setOpen(null); }}
                  onPlan={(countries) => void planFor(countries)} />
              </div>
            </div>
          </div>

          <div role="tablist" className="sticky -top-6 z-20 -mx-6 flex gap-1 border-b border-border bg-bg/95 px-6 pt-2 backdrop-blur">
            {tabs.map((t) => (
              <button key={t} role="tab" aria-selected={activeTab === t} onClick={() => setTab(t)}
                className={cx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap', activeTab === t ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
                {TAB_LABEL[t]}
                {tabBadge(t)}
              </button>
            ))}
          </div>

          {activeTab === 'country' ? (
            <div className="flex flex-col gap-2">
              {focus && (
                <div className="flex items-center gap-2 rounded-md bg-accent/5 px-3 py-1.5 text-sm ring-1 ring-accent/20">
                  <Filter className="size-4 text-accent" aria-hidden />
                  Đang lọc: <span className="font-medium">{focus.title}</span>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setFocus(null)}>Bỏ lọc</Button>
                </div>
              )}
              <CountryTable d={d} compare={compare} selected={open?.kind === 'country' ? open.key : null} only={focus?.countries ?? null}
                onOpen={(c, keys) => openItem('country', c, keys)} />
            </div>
          ) : activeTab === 'matrix' ? (
            <RoasMatrix rows={d.countries} currency={d.currency} target={d.roasTarget} onPick={(c) => openItem('country', c)} />
          ) : activeTab === 'heat' ? (
            <HeatmapView heat={d.heat} currency={d.currency} target={d.roasTarget} onPick={(c) => openItem('country', c, d.heat.countries)} />
          ) : (
            <BreakdownTab dim={activeTab} d={d} compare={compare} selected={open && open.kind === activeTab ? open.key : null}
              onOpen={(key, keys) => activeTab === 'campaign' || activeTab === 'adUnit' ? openItem(activeTab, key, keys) : undefined}
              onOpenCountry={(c) => openItem('country', c)} />
          )}

          {aiOpen && <AiSummaryDrawer appId={appId} range={range} onClose={() => setAiOpen(false)} />}
          {open && nav && open.kind === 'country' && (
            <CountryDrawer key={`c:${open.key}`} country={open.key} d={d} nav={nav} onClose={() => setOpen(null)}
              onOpenCampaign={(id) => openItem('campaign', id)} onOpenUnit={(id) => openItem('adUnit', id)} />
          )}
          {open && nav && open.kind === 'campaign' && (() => {
            const row = camps.data?.rows.find((x) => x.key === open.key);
            return row ? (
              <CampaignDrawer key={`k:${open.key}`} row={row} currency={d.currency} target={d.roasTarget} nav={nav} onClose={() => setOpen(null)} onOpenCountry={(c) => openItem('country', c)} />
            ) : null;
          })()}
          {open && nav && open.kind === 'adUnit' && (() => {
            const row = units.data?.rows.find((x) => x.key === open.key);
            return row ? <AdUnitDrawer key={`u:${open.key}`} row={row} currency={d.currency} nav={nav} onClose={() => setOpen(null)} onOpenCountry={(c) => openItem('country', c)} /> : null;
          })()}
        </>
      )}
    </div>
  );
}

const Count = ({ n }: { n: number }) => <span className="num rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-muted">{n}</span>;

function ExportMenu({ disabled, tabLabel, onExport }: { disabled: boolean; tabLabel: string; onExport: (f: 'csv' | 'xlsx') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'flex w-full items-start gap-2 rounded-sm px-2.5 py-2 text-left hover:bg-surface-2';
  return (
    <div className="relative" ref={ref}>
      <Button icon={Download} disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        Xuất <ChevronDown className="size-3.5" aria-hidden />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-lg">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onExport('xlsx'); }}>
            <FileSpreadsheet className="mt-0.5 size-4 text-success" aria-hidden />
            <span><span className="block text-sm font-medium">Excel (XLSX)</span><span className="text-xs text-muted">Mọi bảng: quốc gia, ngày, camp, ad unit, nguồn…</span></span>
          </button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onExport('csv'); }}>
            <Download className="mt-0.5 size-4 text-muted" aria-hidden />
            <span><span className="block text-sm font-medium">CSV</span><span className="text-xs text-muted">Chỉ bảng {tabLabel}</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Bảng quốc gia ───────────────────────────────────────────────────────────
type CountryRow = CountryStat & TableRow;

function CountryTable({ d, compare, selected, onOpen, only }: { d: AnalyticsResult; compare: boolean; selected: string | null; onOpen: (c: string, keys: string[]) => void; only: string[] | null }) {
  const rows = useMemo<CountryRow[]>(
    () => d.countries.filter((c) => !only || only.includes(c.country)).map((c) => ({ ...c, key: c.country, label: countryName(c.country) })),
    [d.countries, only],
  );
  const extras = useMemo<ExtraCol<CountryRow>[]>(
    () => [
      {
        id: 'alerts',
        header: 'Cảnh báo',
        last: true,
        sort: (r) => r.alerts.reduce((s, a) => s + (a.level === 'danger' ? 10 : 1), 0),
        cell: (r) => (
          <SeverityPills danger={r.alerts.filter((a) => a.level === 'danger').length} warning={r.alerts.filter((a) => a.level === 'warning').length}
            title={r.alerts.map((a) => `• ${RULE_LABEL[a.rule]}: ${a.message}`).join('\n')} />
        ),
      },
    ],
    [],
  );
  return (
    <DataTable
      rows={rows}
      currency={d.currency}
      storageKey="country"
      firstHeader="Quốc gia"
      first={(r) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-base leading-none" aria-hidden>{flag(r.country)}</span>
          <span className="font-medium">{r.label}</span>
          <span className="font-mono text-[11px] text-muted">{r.country}</span>
        </span>
      )}
      extras={extras}
      numeric={['spend', 'share', 'installs', 'cpi', 'revenue', 'profit', 'roas', 'ecpm', 'adImpressions', 'showRate', 'fillRate', 'adsCtr', 'cvr']}
      defaults={['spend', 'share', 'installs', 'cpi', 'revenue', 'profit', 'roas', 'ecpm', 'showRate', 'alerts']}
      compare={compare}
      roasTarget={d.roasTarget}
      selected={selected}
      onRowClick={(r, keys) => onOpen(r.country, keys)}
      totals={only ? null : d.kpis}
      footer={<>Bấm dòng (hoặc Enter) để xem chi tiết · ↑/↓ chuyển dòng · ←/→ chuyển mục trong ngăn chi tiết · ZZ = Google không xác định được vị trí</>}
    />
  );
}

// ── Tab theo chiều khác ─────────────────────────────────────────────────────
function campaignExtras(currency: string, onOpenCountry: (c: string) => void): ExtraCol<BreakRow>[] {
  return [
    { id: 'status', header: 'Trạng thái', sort: (r) => r.status ?? '', cell: (r) => <CampStatus s={r.status} /> },
    {
      id: 'mainCountry',
      header: 'Nước chính',
      sort: (r) => r.country ?? '',
      cell: (r) =>
        r.country ? (
          <button className="rounded-sm px-1 hover:bg-surface-2 hover:text-accent" title="Mở chi tiết nước" onClick={(e) => { e.stopPropagation(); onOpenCountry(r.country!); }}>
            <span aria-hidden>{flag(r.country)}</span> {r.country}
          </button>
        ) : null,
    },
    { id: 'budget', header: 'Ngân sách/ngày', numeric: true, sort: (r) => r.budget ?? -1, cell: (r) => <span className="num block">{r.budget == null ? '—' : fmtMoney(r.budget, currency)}</span> },
    {
      id: 'target',
      header: 'Mục tiêu',
      numeric: true,
      sort: (r) => r.targetCpa ?? r.targetRoas ?? -1,
      cell: (r) => <span className="num block text-xs">{r.targetCpa != null ? `tCPI ${fmtMoney(r.targetCpa, currency)}` : r.targetRoas != null ? `tROAS ${fmtPct(r.targetRoas, 0)}` : '—'}</span>,
    },
  ];
}

const DIM_SETUP: Record<Exclude<Dim, 'country'>, { first: string; numeric: NumCol[]; defaults: string[]; shareBy: 'spend' | 'revenue' }> = {
  adUnit: {
    first: 'Ad unit',
    numeric: ['revenue', 'share', 'adImpressions', 'ecpm', 'adRequests', 'fillRate', 'showRate', 'adCtr'],
    defaults: ['format', 'unitApp', 'revenue', 'share', 'adImpressions', 'ecpm', 'adRequests', 'fillRate', 'showRate', 'adCtr', 'flags'],
    shareBy: 'revenue',
  },
  campaign: {
    first: 'Camp',
    numeric: ['spend', 'share', 'installs', 'cpi', 'revenue', 'profit', 'roas', 'adsCtr', 'cvr', 'ecpm', 'adImpressions'],
    defaults: ['status', 'mainCountry', 'budget', 'target', 'spend', 'installs', 'cpi', 'revenue', 'roas', 'adsCtr', 'cvr'],
    shareBy: 'spend',
  },
  app: {
    first: 'App',
    numeric: ['spend', 'share', 'installs', 'cpi', 'revenue', 'profit', 'roas', 'ecpm', 'adImpressions', 'showRate', 'fillRate', 'adsCtr', 'cvr'],
    defaults: ['spend', 'share', 'installs', 'cpi', 'revenue', 'profit', 'roas', 'ecpm'],
    shareBy: 'spend',
  },
  format: {
    first: 'Định dạng',
    numeric: ['revenue', 'share', 'adImpressions', 'ecpm', 'fillRate', 'showRate'],
    defaults: ['revenue', 'share', 'adImpressions', 'ecpm', 'fillRate', 'showRate'],
    shareBy: 'revenue',
  },
  source: {
    first: 'Nguồn quảng cáo',
    numeric: ['revenue', 'share', 'adImpressions', 'ecpm', 'fillRate', 'showRate'],
    defaults: ['revenue', 'share', 'adImpressions', 'ecpm', 'fillRate', 'showRate'],
    shareBy: 'revenue',
  },
};

function BreakdownTab({ dim, d, compare, selected, onOpen, onOpenCountry }: {
  dim: Exclude<Dim, 'country'>;
  d: AnalyticsResult;
  compare: boolean;
  selected: string | null;
  onOpen: (key: string, keys: string[]) => void;
  onOpenCountry: (c: string) => void;
}) {
  const q = useBreakdown(dim, null);
  const setup = DIM_SETUP[dim];
  const multiApp = !!q.data?.rows.some((r) => r.appName);
  const extras = useMemo(
    () => (dim === 'campaign' ? campaignExtras(d.currency, onOpenCountry) : dim === 'adUnit' ? unitExtras.filter((e) => e.id !== 'unitApp' || multiApp) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dim, d.currency, multiApp],
  );
  if (q.isLoading) return <Skeleton className="h-80 rounded-lg" />;
  if (q.isError || !q.data) return <Banner tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>Không đọc được số liệu theo {TAB_LABEL[dim].toLowerCase()}.</Banner>;
  const clickable = dim === 'campaign' || dim === 'adUnit';
  return (
    <DataTable
      key={dim}
      rows={q.data.rows}
      currency={q.data.currency}
      storageKey={dim}
      firstHeader={setup.first}
      first={(r) => <span className="block max-w-80 truncate font-medium" title={dim === 'adUnit' ? `${r.label}\n${r.key}` : r.label}>{r.label}</span>}
      extras={extras}
      numeric={setup.numeric}
      defaults={setup.defaults}
      compare={compare}
      roasTarget={d.roasTarget}
      shareBy={setup.shareBy}
      totals={dim === 'app' ? d.kpis : null}
      emptyText={dim === 'format' || dim === 'source' || dim === 'adUnit' ? 'Chưa có doanh thu AdMob trong kỳ' : 'Chưa có chi phí trong kỳ'}
      footer={q.data.note}
      selected={selected}
      onRowClick={clickable ? (r, keys) => onOpen(r.key, keys) : undefined}
    />
  );
}

