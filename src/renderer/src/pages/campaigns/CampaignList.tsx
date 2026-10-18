import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { AlertTriangle, ArrowDown, ArrowUp, Building2, ChevronRight, ExternalLink, Megaphone, Pause, Play, Plus, RefreshCw, Search, Target, Wallet, Zap } from 'lucide-react';
import { GOALS, adsCampaignUrl } from '@shared/plan';
import { flag } from '@shared/geo';
import { rangeDays } from '@shared/analytics';
import { budgetPacing, campaignFlags, type HealthFlag } from '@shared/health';
import type { CampaignChange, CampaignRow } from '@shared/types';
import { api, parseError } from '@/lib/api';
import { useAdsCustomers, useCampaigns } from '@/lib/queries';
import { setState, useUi } from '@/lib/store';
import { fmtMoney, fmtNumber, fromMicros } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Input, SeverityPills, Skeleton, StatusBadge, cx } from '@/components/ui';
import { FilterChips, SummaryCard, flagCounts } from '@/components/kit';
import { DiffPreview } from '@/components/DiffPreview';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { CampaignDrawer } from './CampaignDrawer';
import { PacingCard } from './Pacing';

export const GOAL_SHORT = Object.fromEntries(Object.values(GOALS).map((g) => [g.goalType, g.short]));
type StatusFilter = 'all' | 'ENABLED' | 'PAUSED' | 'flagged';

// Bộ lọc được giữ khi mở lại app (chỉ là tiện ích trên máy này)
function loadFilter(): { q: string; status: StatusFilter } {
  try {
    return { q: '', status: 'all', ...JSON.parse(localStorage.getItem('campaigns.filter') ?? '{}') };
  } catch {
    return { q: '', status: 'all' };
  }
}
function saveFilter(f: { q: string; status: StatusFilter }) {
  try {
    localStorage.setItem('campaigns.filter', JSON.stringify(f));
  } catch {
    /* bỏ qua */
  }
}

// Thay đổi ngân sách theo %: làm tròn tới 0.01 đơn vị tiền tệ (micros bội số 10.000)
const scaleMicros = (micros: number, pct: number) => Math.max(10_000, Math.round((micros * (1 + pct / 100)) / 10_000) * 10_000);

// Dựng thay đổi cho một nhóm camp (dùng chung cho thanh chọn nhiều và ngăn chi tiết)
export const changesFor = {
  budget: (list: CampaignRow[], pct: number): CampaignChange[] => {
    const seen = new Set<string>(); // nhiều camp chung 1 ngân sách: chỉ đổi 1 lần
    return list
      .filter((c) => c.budgetResource && !seen.has(c.budgetResource) && seen.add(c.budgetResource))
      .map((c) => ({ campaignId: c.id, name: c.name, field: 'budget', before: c.budgetMicros, after: scaleMicros(c.budgetMicros, pct), budgetResource: c.budgetResource }));
  },
  status: (list: CampaignRow[], to: 'ENABLED' | 'PAUSED'): CampaignChange[] =>
    list.filter((c) => c.status !== to).map((c) => ({ campaignId: c.id, name: c.name, field: 'status', before: c.status, after: to })),
  target: (list: CampaignRow[], pct: number): CampaignChange[] =>
    list.flatMap((c): CampaignChange[] => {
      if (c.targetRoas != null) return [{ campaignId: c.id, name: c.name, field: 'targetRoas', before: c.targetRoas, after: Math.round(c.targetRoas * (1 + pct / 100) * 100) / 100 }];
      if (c.targetCpaMicros != null) return [{ campaignId: c.id, name: c.name, field: 'targetCpa', before: c.targetCpaMicros, after: scaleMicros(c.targetCpaMicros, pct) }];
      return [];
    }),
};

export function CampaignList() {
  const prefs = useUi((s) => s.prefs)!;
  const online = useUi((s) => s.online);
  const cid = prefs.currentAdsCustomerId;
  const { data: customers = [] } = useAdsCustomers();
  const currency = customers.find((c) => c.customerId === cid)?.currency ?? 'USD';
  const q = useCampaigns(cid, prefs.range);
  const pendingQ = useQuery({ queryKey: ['suggestions', 'pending'], queryFn: () => api.rules.suggestions('pending') });
  const onError = useErrorHandler();
  const days = rangeDays(prefs.range); // null = từ trước đến nay
  // Chi phí/ngày: theo số ngày của kỳ; “từ trước đến nay” thì theo số ngày chạy của từng camp
  const daysOf = (c: CampaignRow) => days ?? c.activeDays ?? 1;
  const periodLabel = days ? `${days} ngày` : 'từ trước đến nay';
  const money = (m: number) => fmtMoney(fromMicros(m), currency);

  const [filter, setFilterState] = useState(loadFilter);
  const setFilter = (f: typeof filter) => {
    setFilterState(f);
    saveFilter(f);
  };
  const [sorting, setSorting] = useState<SortingState>([{ id: 'cost', desc: true }]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [preview, setPreview] = useState<CampaignChange[] | null>(null);
  const [previewRows, setPreviewRows] = useState<CampaignRow[]>([]);
  const [applying, setApplying] = useState(false);
  const [customPct, setCustomPct] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of pendingQ.data ?? []) m.set(s.campaignId, (m.get(s.campaignId) ?? 0) + 1);
    return m;
  }, [pendingQ.data]);
  const flagsOf = useMemo(() => {
    const m = new Map<string, HealthFlag[]>();
    for (const c of q.data ?? []) m.set(c.id, campaignFlags(c, daysOf(c), pendingBy.get(c.id) ?? 0, money));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, days, pendingBy, currency]);
  const isFlagged = (c: CampaignRow) => (flagsOf.get(c.id) ?? []).some((f) => f.level !== 'info');

  const all = q.data ?? [];
  const data = useMemo(
    () => all.filter((c) => filter.status === 'all' || (filter.status === 'flagged' ? isFlagged(c) : c.status === filter.status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, filter.status, flagsOf],
  );

  const columns = useMemo<ColumnDef<CampaignRow>[]>(
    () => [
      {
        id: 'select',
        size: 32,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Chọn tất cả"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input type="checkbox" aria-label={`Chọn ${row.original.name}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Camp',
        cell: ({ row: { original: r } }) => (
          <span className="flex min-w-0 items-center gap-2">
            {r.country && <span className="text-base leading-none" aria-hidden>{flag(r.country)}</span>}
            <span className="min-w-0">
              <span className="block max-w-80 truncate font-medium" title={r.name}>{r.name}</span>
              <span className="block text-[11px] text-muted">{r.goalType ? (GOAL_SHORT[r.goalType] ?? r.goalType) : 'App campaign'}{r.country && ` · ${r.country}`}</span>
            </span>
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Trạng thái',
        cell: ({ getValue }) =>
          getValue() === 'ENABLED' ? (
            <StatusBadge tone="success" icon={Play}>Đang chạy</StatusBadge>
          ) : (
            <StatusBadge tone="neutral" icon={Pause}>Tạm dừng</StatusBadge>
          ),
      },
      {
        id: 'flags',
        accessorFn: (r) => (flagsOf.get(r.id) ?? []).reduce((s, f) => s + (f.level === 'danger' ? 100 : f.level === 'warning' ? 10 : 1), 0),
        header: 'Cảnh báo',
        cell: ({ row: { original: r } }) => {
          const fl = flagsOf.get(r.id) ?? [];
          return <SeverityPills {...flagCounts(fl)} title={fl.map((f) => `• ${f.message}`).join('\n')} />;
        },
      },
      {
        id: 'budget',
        accessorKey: 'budgetMicros',
        header: 'Ngân sách/ngày',
        meta: { num: true },
        cell: ({ row: { original: r } }) => {
          const p = budgetPacing(r, daysOf(r));
          return (
            <span className="flex flex-col items-end gap-1" title={p != null ? `Tiêu trung bình ${fmtNumber(p * 100)}% ngân sách mỗi ngày` : undefined}>
              <span className="num">
                {money(r.budgetMicros)}
                {r.budgetShared && <span className="ml-1 text-xs text-warning">chung</span>}
              </span>
              {p != null && (
                <span className="h-1 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span className={cx('block h-full rounded-full', p >= 0.95 ? 'bg-warning' : 'bg-accent/70')} style={{ width: `${Math.min(100, p * 100)}%` }} />
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'target',
        accessorFn: (r) => r.targetRoas ?? r.targetCpaMicros ?? -1,
        header: 'Giá thầu',
        meta: { num: true },
        cell: ({ row: { original: r } }) => (
          <span className="num block">
            {r.targetRoas != null ? `tROAS ${fmtNumber(r.targetRoas * 100)}%` : r.targetCpaMicros != null ? money(r.targetCpaMicros) : '—'}
          </span>
        ),
      },
      { id: 'cost', accessorKey: 'costMicros', header: 'Chi phí', meta: { num: true }, cell: ({ getValue }) => <span className="num block">{money(getValue<number>())}</span> },
      { id: 'conv', accessorKey: 'conversions', header: 'Chuyển đổi', meta: { num: true }, cell: ({ getValue }) => <span className="num block">{fmtNumber(getValue<number>(), 1)}</span> },
      {
        id: 'cpa',
        accessorFn: (r) => (r.conversions > 0 ? r.costMicros / r.conversions : Infinity),
        header: 'CPA',
        meta: { num: true },
        cell: ({ row: { original: r }, getValue }) => {
          const v = getValue<number>();
          const over = isFinite(v) && r.targetCpaMicros != null && v > r.targetCpaMicros * 1.3;
          return <span className={cx('num block', over && 'font-medium text-warning')}>{isFinite(v) ? money(v) : '—'}</span>;
        },
      },
      {
        id: 'open',
        size: 64,
        header: () => <span className="sr-only">Mở</span>,
        cell: ({ row: { original: r } }) => (
          <span className="flex items-center justify-end gap-0.5">
            <Button size="sm" variant="ghost" icon={ExternalLink} aria-label={`Mở ${r.name} trên Google Ads`} title="Mở trên Google Ads"
              onClick={(e) => { e.stopPropagation(); void api.app.openExternal(adsCampaignUrl(r.customerId, r.id)); }} />
            <ChevronRight className={cx('size-4 text-muted', openId === r.id ? 'text-accent opacity-100' : 'opacity-0 group-hover:opacity-100')} aria-hidden />
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, days, flagsOf, openId],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection: selection, globalFilter: filter.q },
    getRowId: (r) => r.id,
    onSortingChange: setSorting,
    onRowSelectionChange: setSelection,
    onGlobalFilterChange: (v: string) => setFilter({ ...filter, q: v }),
    globalFilterFn: (row, _id, value: string) => {
      const s = value.toLowerCase();
      return row.original.name.toLowerCase().includes(s) || (row.original.country ?? '').toLowerCase() === s;
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const visible = table.getRowModel().rows.map((r) => r.original);

  const open = (changes: CampaignChange[], rows: CampaignRow[]) => {
    if (!changes.length) return toast({ tone: 'info', title: 'Không có gì thay đổi với các camp đã chọn' });
    setPreviewRows(rows);
    setPreview(changes);
  };

  async function apply(changes: CampaignChange[], isUndo = false) {
    setApplying(true);
    try {
      const res = await api.ads.applyChanges({ customerId: cid!, changes });
      setPreview(null);
      setSelection({});
      void q.refetch();
      if (isUndo) return toast({ tone: 'success', title: `Đã hoàn tác ${res.applied} thay đổi` });
      // Undo 10 giây: giữ giá trị cũ để gọi mutate ngược
      const reverse = changes.map((c) => ({ ...c, before: c.after, after: c.before }));
      toast({
        tone: 'success',
        title: `Đã áp dụng ${res.applied} thay đổi`,
        detail: `${res.operations} operation`,
        ttl: 10_000,
        action: { label: 'Hoàn tác', run: () => void apply(reverse, true) },
      });
    } catch (err) {
      onError(err, () => void apply(changes, isUndo));
    } finally {
      setApplying(false);
    }
  }

  // ── Trạng thái màn ──────────────────────────────────────────────────────
  if (!cid) {
    return (
      <Card>
        <EmptyState icon={Building2} title="Chọn tài khoản Google Ads">
          Chọn tài khoản ở thanh trên cùng để xem camp. Chưa có tài khoản? Kết nối trong Cài đặt → Tài khoản.
        </EmptyState>
      </Card>
    );
  }

  const sharedNames = preview
    ? [...new Set(previewRows.filter((c) => c.budgetShared && preview.some((p) => p.field === 'budget' && p.campaignId === c.id)).map((c) => c.name))]
    : [];
  const enabled = all.filter((c) => c.status === 'ENABLED');
  const totalCost = all.reduce((s, c) => s + c.costMicros, 0);
  const totalConv = all.reduce((s, c) => s + c.conversions, 0);
  const flaggedN = all.filter(isFlagged).length;
  const openRow = openId ? all.find((c) => c.id === openId) : null;
  const openIdx = openRow ? visible.findIndex((c) => c.id === openRow.id) : -1;

  return (
    <div className="flex flex-col gap-3">
      {all.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
          <SummaryCard icon={Play} tone="success" label="Đang chạy" value={<>{enabled.length}<span className="text-sm font-normal text-muted">/{all.length}</span></>}
            sub={`${all.length - enabled.length} tạm dừng`} onClick={() => setFilter({ ...filter, status: filter.status === 'ENABLED' ? 'all' : 'ENABLED' })} active={filter.status === 'ENABLED'} />
          <SummaryCard icon={Wallet} label="Ngân sách/ngày" value={money(enabled.reduce((s, c) => s + c.budgetMicros, 0))} sub={`đang tiêu ${money(enabled.reduce((s, c) => s + c.costMicros / daysOf(c), 0))}/ngày`} />
          <SummaryCard icon={Zap} tone="accent-2" label="Chi phí" value={money(totalCost)} sub={`${periodLabel} · ${fmtNumber(totalConv)} chuyển đổi`} />
          <SummaryCard icon={Target} tone="info" label="CPA TB" value={totalConv > 0 ? money(totalCost / totalConv) : '—'} sub="chi phí ÷ chuyển đổi" />
          <SummaryCard icon={AlertTriangle} tone={flaggedN ? 'warning' : 'success'} label="Cần chú ý" value={flaggedN} sub={flaggedN ? 'bấm để lọc' : 'không có camp nào'}
            onClick={() => setFilter({ ...filter, status: filter.status === 'flagged' ? 'all' : 'flagged' })} active={filter.status === 'flagged'} />
          <PacingCard customerId={cid} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Tìm theo tên hoặc mã quốc gia" value={filter.q} onChange={(e) => table.setGlobalFilter(e.target.value)} aria-label="Tìm camp" />
        </div>
        <FilterChips label="Lọc trạng thái" value={filter.status} onChange={(v) => setFilter({ ...filter, status: v })}
          chips={[
            { id: 'all', label: 'Tất cả', count: all.length },
            { id: 'ENABLED', label: 'Đang chạy', count: enabled.length, tone: 'success' },
            { id: 'PAUSED', label: 'Tạm dừng', count: all.length - enabled.length },
            { id: 'flagged', label: 'Có cảnh báo', count: flaggedN, tone: 'warning' },
          ]} />
        <div className="flex-1" />
        <span className="num text-xs text-muted">{table.getFilteredRowModel().rows.length} camp · số liệu {periodLabel}</span>
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={q.isFetching} onClick={() => void q.refetch()}>
          Tải lại
        </Button>
      </div>

      {selected.length > 0 && (
        <div className="sticky -top-6 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-surface px-3 py-2 shadow-sm ring-4 ring-accent/5" role="toolbar" aria-label="Thao tác hàng loạt">
          <span className="text-sm font-medium">
            Đã chọn <span className="num">{selected.length}</span>
          </span>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Button size="sm" icon={Pause} disabled={!online} onClick={() => open(changesFor.status(selected, 'PAUSED'), selected)}>Tạm dừng</Button>
          <Button size="sm" icon={Play} disabled={!online} onClick={() => open(changesFor.status(selected, 'ENABLED'), selected)}>Bật</Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <span className="text-xs text-muted">Ngân sách</span>
          {[-20, -10, 10, 20].map((p) => (
            <Button key={p} size="sm" disabled={!online} onClick={() => open(changesFor.budget(selected, p), selected)} className="num">
              {p > 0 ? `+${p}` : p}%
            </Button>
          ))}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const p = Number(customPct.replace(',', '.'));
              if (!isFinite(p) || p === 0 || p <= -100) return toast({ tone: 'warning', title: 'Nhập % khác 0 và lớn hơn -100' });
              open(changesFor.budget(selected, p), selected);
            }}
          >
            <Input className="h-7 w-20" placeholder="±%" value={customPct} onChange={(e) => setCustomPct(e.target.value)} aria-label="Đổi ngân sách theo %" />
            <Button size="sm" type="submit" disabled={!online}>Áp</Button>
          </form>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <span className="text-xs text-muted">Giá thầu</span>
          <Button size="sm" icon={ArrowDown} disabled={!online} onClick={() => open(changesFor.target(selected, -10), selected)}>10%</Button>
          <Button size="sm" icon={ArrowUp} disabled={!online} onClick={() => open(changesFor.target(selected, 10), selected)}>10%</Button>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelection({})}>Bỏ chọn</Button>
        </div>
      )}

      {q.error && (
        <div className="overflow-hidden rounded-lg border border-danger/30">
          <Banner tone="danger" action={<Button size="sm" onClick={() => onError(q.error, () => void q.refetch())}>Chi tiết</Button>}>
            Không tải được camp: {parseError(q.error).message}
          </Banner>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const num = (h.column.columnDef.meta as { num?: boolean } | undefined)?.num;
                    const sorted = h.column.getIsSorted();
                    return (
                      <th key={h.id} className={cx('h-row border-b border-border px-3 font-medium whitespace-nowrap', num ? 'text-right' : 'text-left')}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
                        {h.column.getCanSort() && h.id !== 'select' && h.id !== 'open' ? (
                          <button className="inline-flex items-center gap-1 hover:text-text" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {sorted === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : sorted === 'desc' ? <ArrowDown className="size-3" aria-hidden /> : null}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {q.isLoading
                ? Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="border-b border-border/60">
                      {columns.map((c, j) => (
                        <td key={j} className="h-row px-3"><Skeleton className="h-3.5 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : table.getRowModel().rows.map((row) => {
                    const isOpen = openId === row.id;
                    return (
                      <tr key={row.id} tabIndex={0} aria-selected={isOpen}
                        onClick={() => setOpenId(row.id)}
                        onKeyDown={(e) => {
                          if ((e.target as HTMLElement).closest('input, button')) return;
                          const tr = e.currentTarget;
                          if (e.key === 'Enter') (e.preventDefault(), setOpenId(row.id));
                          else if (e.key === ' ') (e.preventDefault(), row.toggleSelected());
                          else if (e.key === 'ArrowDown') (e.preventDefault(), (tr.nextElementSibling as HTMLElement | null)?.focus());
                          else if (e.key === 'ArrowUp') (e.preventDefault(), (tr.previousElementSibling as HTMLElement | null)?.focus());
                        }}
                        className={cx('group relative cursor-pointer border-b border-border/60 outline-none', isOpen ? 'bg-selected' : row.getIsSelected() ? 'bg-accent/5' : 'hover:bg-surface-2/70 focus-visible:bg-surface-2/70')}>
                        {row.getVisibleCells().map((cell, i) => (
                          <td key={cell.id} className={cx('px-3 py-1.5', i === 0 && 'relative')}>
                            {i === 0 && isOpen && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {!q.isLoading && !q.error && table.getRowModel().rows.length === 0 && (
          <EmptyState
            icon={Megaphone}
            title={q.data?.length ? 'Không có camp khớp bộ lọc' : 'Chưa có App campaign'}
            action={
              q.data?.length ? (
                <Button onClick={() => setFilter({ q: '', status: 'all' })}>Xóa bộ lọc</Button>
              ) : (
                <Button variant="primary" icon={Plus} onClick={() => setState({ campaignsTab: 'new' })}>Tạo kế hoạch</Button>
              )
            }
          >
            {q.data?.length ? undefined : 'Tài khoản này chưa có App campaign nào đang chạy hoặc tạm dừng.'}
          </EmptyState>
        )}
        {!q.isLoading && visible.length > 0 && (
          <p className="border-t border-border px-3 py-2 text-xs text-muted">Bấm dòng (hoặc Enter) để xem chi tiết · Space chọn dòng · ↑/↓ chuyển dòng · ←/→ chuyển camp trong ngăn chi tiết</p>
        )}
      </Card>

      {openRow && (
        <CampaignDrawer
          key={openRow.id}
          c={openRow}
          currency={currency}
          days={daysOf(openRow)}
          periodLabel={periodLabel}
          flags={flagsOf.get(openRow.id) ?? []}
          online={online}
          nav={{
            index: Math.max(0, openIdx),
            total: Math.max(visible.length, 1),
            prev: () => openIdx > 0 && setOpenId(visible[openIdx - 1].id),
            next: () => openIdx >= 0 && openIdx < visible.length - 1 && setOpenId(visible[openIdx + 1].id),
          }}
          onClose={() => setOpenId(null)}
          onChange={(changes) => open(changes, [openRow])}
        />
      )}

      {preview && (
        <DiffPreview
          changes={preview}
          currency={currency}
          sharedBudgetNames={sharedNames}
          pending={applying}
          onCancel={() => setPreview(null)}
          onConfirm={() => void apply(preview)}
        />
      )}
    </div>
  );
}
