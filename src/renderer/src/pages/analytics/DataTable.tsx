import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronRight, Columns3, Search, X } from 'lucide-react';
import { delta, kpisFromTotals, type Kpis, type Metric } from '@shared/analytics';
import { fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { Button, Card, DeltaBadge, Input, cx } from '@/components/ui';

// Bảng số liệu dùng chung cho mọi chiều phân tích: sắp xếp, tìm, dòng tổng, chọn cột, Δ so kỳ trước.

export interface TableRow extends Kpis {
  key: string;
  label: string;
  prev: Kpis;
}

export type NumCol = Metric | 'showRate' | 'fillRate' | 'share' | 'adRequests' | 'adCtr';
export interface ExtraCol<T> {
  id: string;
  header: string;
  cell: (r: T) => ReactNode;
  sort?: (r: T) => number | string;
  numeric?: boolean;
  last?: boolean; // đặt sau các cột số (vd. cảnh báo, cờ)
}

const NUM: Record<NumCol, { header: string; kind: 'money' | 'pct' | 'count'; goodUp: boolean; hint?: string }> = {
  spend: { header: 'Chi phí', kind: 'money', goodUp: false },
  installs: { header: 'Cài đặt', kind: 'count', goodUp: true },
  cpi: { header: 'CPI', kind: 'money', goodUp: false },
  revenue: { header: 'Doanh thu QC', kind: 'money', goodUp: true },
  profit: { header: 'Lợi nhuận', kind: 'money', goodUp: true, hint: 'Doanh thu QC − chi phí' },
  roas: { header: 'ROAS', kind: 'pct', goodUp: true },
  ecpm: { header: 'eCPM', kind: 'money', goodUp: true },
  adImpressions: { header: 'Hiển thị QC', kind: 'count', goodUp: true, hint: 'Lượt hiển thị quảng cáo AdMob' },
  adsCtr: { header: 'CTR Ads', kind: 'pct', goodUp: true, hint: 'Click ÷ hiển thị trên Google Ads' },
  cvr: { header: 'Tỉ lệ cài', kind: 'pct', goodUp: true, hint: 'Cài ÷ click Google Ads' },
  showRate: { header: 'Show rate', kind: 'pct', goodUp: true, hint: 'AdMob: hiển thị ÷ matched' },
  fillRate: { header: 'Fill rate', kind: 'pct', goodUp: true, hint: 'AdMob: matched ÷ request' },
  adRequests: { header: 'Request', kind: 'count', goodUp: true, hint: 'AdMob: số lần app xin quảng cáo' },
  adCtr: { header: 'CTR QC', kind: 'pct', goodUp: false, hint: 'AdMob: click ÷ hiển thị (cao bất thường = nghi click không hợp lệ)' },
  share: { header: 'Tỉ trọng', kind: 'pct', goodUp: true, hint: 'Phần trăm trên tổng của cột chính (chi phí, hoặc doanh thu khi không có chi phí)' },
};

// Cột đang hiện lưu theo từng bảng (tiện cho người xem, mất cũng không sao)
function useVisible(storageKey: string, defaults: string[]) {
  const [v, setV] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`cols:${storageKey}`);
      return raw ? (JSON.parse(raw) as string[]) : defaults;
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`cols:${storageKey}`, JSON.stringify(v));
    } catch {
      /* bỏ qua */
    }
  }, [storageKey, v]);
  return [v, setV] as const;
}

export function DataTable<T extends TableRow>({
  rows,
  currency,
  storageKey,
  firstHeader,
  first,
  extras = [],
  numeric,
  defaults,
  compare,
  roasTarget,
  selected,
  onRowClick,
  totals,
  footer,
  shareBy = 'spend',
  emptyText = 'Không có dòng nào',
}: {
  rows: T[];
  currency: string;
  storageKey: string;
  firstHeader: string;
  first: (r: T) => ReactNode;
  extras?: ExtraCol<T>[];
  numeric: NumCol[];
  defaults: string[];
  compare: boolean;
  roasTarget: number | null;
  selected?: string | null;
  onRowClick?: (r: T, orderedKeys: string[]) => void; // thứ tự dòng đang hiển thị, để ngăn chi tiết chuyển trước/sau
  totals?: Kpis | null; // tổng chính xác (có show rate); không truyền thì tự cộng
  footer?: ReactNode;
  shareBy?: 'spend' | 'revenue';
  emptyText?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: shareBy === 'spend' ? 'spend' : 'revenue', desc: true }]);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useVisible(storageKey, defaults);
  const [picker, setPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picker) return;
    const close = (e: MouseEvent) => !pickerRef.current?.contains(e.target as Node) && setPicker(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [picker]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const sum = useMemo(() => {
    if (totals) return totals;
    const t = { spend: 0, installs: 0, revenue: 0, adImpressions: 0, adsImpressions: 0, adsClicks: 0, requests: 0, matched: 0, adClicks: 0 };
    for (const r of rows) {
      t.requests += r.adRequests;
      t.matched += r.fillRate != null ? r.adRequests * r.fillRate : 0; // matched = request × fill
      t.adClicks += r.adClicks;
      t.spend += r.spend;
      t.installs += r.installs;
      t.revenue += r.revenue;
      t.adImpressions += r.adImpressions;
      t.adsImpressions += r.adsImpressions;
      t.adsClicks += r.adsClicks;
    }
    return kpisFromTotals(t);
  }, [rows, totals]);
  const shareBase = shareBy === 'spend' ? sum.spend : sum.revenue;

  const fmt = (v: number | null, kind: 'money' | 'pct' | 'count') =>
    v == null || !isFinite(v) ? '—' : kind === 'money' ? fmtMoney(v, currency) : kind === 'pct' ? fmtPct(v, kind === 'pct' && v < 0.1 ? 1 : 0) : fmtNumber(v);

  const columns = useMemo<ColumnDef<T>[]>(() => {
    const cols: ColumnDef<T>[] = [{ id: 'label', header: firstHeader, accessorFn: (r) => r.label, cell: ({ row }) => first(row.original) }];
    const extraCols: ColumnDef<T>[] = [];
    const lastCols: ColumnDef<T>[] = [];
    for (const e of extras) {
      if (!visible.includes(e.id)) continue;
      (e.last ? lastCols : extraCols).push({ id: e.id, header: e.header, accessorFn: (r) => e.sort?.(r) ?? '', enableSorting: !!e.sort, cell: ({ row }) => e.cell(row.original), meta: { numeric: e.numeric } });
    }
    cols.push(...extraCols);
    for (const id of numeric) {
      if (!visible.includes(id)) continue;
      const m = NUM[id];
      cols.push({
        id,
        header: m.header,
        accessorFn: (r) => (id === 'share' ? r[shareBy] : (r[id] ?? -Infinity)),
        sortUndefined: 'last',
        meta: { numeric: true, hint: m.hint },
        cell: ({ row: { original: r } }) => {
          if (id === 'share') {
            const s = shareBase > 0 ? r[shareBy] / shareBase : null;
            return (
              <span className="flex items-center justify-end gap-1.5">
                <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2" aria-hidden><span className="block h-full bg-accent/70" style={{ width: `${Math.min(100, (s ?? 0) * 100)}%` }} /></span>
                <span className="num w-10">{s == null ? '—' : fmtPct(s, 0)}</span>
              </span>
            );
          }
          const v = r[id];
          const bad = id === 'roas' && roasTarget != null && v != null && v < roasTarget;
          const tone = id === 'roas' ? (bad ? 'text-danger' : v != null && v >= (roasTarget ?? 1) ? 'text-success' : '') : id === 'profit' ? (v != null && v < 0 ? 'text-danger' : v ? 'text-success' : '') : '';
          return (
            <span className="flex flex-col items-end py-0.5 leading-tight whitespace-nowrap">
              <span className={cx('num', (id === 'roas' || id === 'profit') && 'font-medium', tone)}>{fmt(v, m.kind)}</span>
              {/* Δ nằm dưới số để cột không phình ngang */}
              {compare && id !== 'profit' && <span className="text-[11px] [&_svg]:hidden"><DeltaBadge value={delta(v, r.prev[id])} goodWhenUp={m.goodUp} /></span>}
            </span>
          );
        },
      });
    }
    cols.push(...lastCols);
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, compare, currency, roasTarget, shareBase, extras, numeric]);

  const table = useReactTable({ data: filtered, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const allCols = [...extras.map((e) => ({ id: e.id, header: e.header })), ...numeric.map((id) => ({ id, header: NUM[id].header }))];

  return (
    <Card className="min-w-0 flex-1 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm…" aria-label="Tìm trong bảng" className="h-7 w-56 pl-7 text-sm" />
        </div>
        {query && <Button size="sm" variant="ghost" icon={X} onClick={() => setQuery('')}>Xóa</Button>}
        <span className="text-xs text-muted"><span className="num">{filtered.length}</span>{filtered.length !== rows.length && <>/{rows.length}</>} dòng</span>
        <div className="flex-1" />
        <div className="relative" ref={pickerRef}>
          <Button size="sm" variant="ghost" icon={Columns3} aria-expanded={picker} onClick={() => setPicker(!picker)}>Cột</Button>
          {picker && (
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-surface p-2 shadow-lg" role="dialog" aria-label="Chọn cột">
              {allCols.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={visible.includes(c.id)} onChange={() => setVisible(visible.includes(c.id) ? visible.filter((x) => x !== c.id) : [...visible, c.id])} />
                  {c.header}
                </label>
              ))}
              <button className="mt-1 w-full rounded-sm px-1.5 py-1 text-left text-xs text-accent hover:bg-surface-2" onClick={() => setVisible(defaults)}>Về mặc định</button>
            </div>
          )}
        </div>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h, hi) => {
                  const s = h.column.getIsSorted();
                  const meta = h.column.columnDef.meta as { numeric?: boolean; hint?: string } | undefined;
                  return (
                    <th key={h.id} title={meta?.hint} className={cx('h-row px-3 font-medium whitespace-nowrap', meta?.numeric ? 'text-right' : 'text-left', hi === 0 && 'sticky left-0 z-[2] bg-surface-2')}
                      aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : 'none'}>
                      {h.column.getCanSort() ? (
                        <button className="inline-flex items-center gap-0.5 hover:text-text" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {s === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : s === 'desc' ? <ArrowDown className="size-3" aria-hidden /> : null}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
                {onRowClick && <th className="w-6" aria-hidden />}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {table.getRowModel().rows.map((r) => {
              const sel = selected === r.original.key;
              const open = () => onRowClick?.(r.original, table.getRowModel().rows.map((x) => x.original.key));
              return (
                <tr key={r.id} tabIndex={onRowClick ? 0 : undefined} aria-selected={sel}
                  onClick={onRowClick && open}
                  onKeyDown={onRowClick && ((e) => {
                    const tr = e.currentTarget;
                    if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), open());
                    else if (e.key === 'ArrowDown') (e.preventDefault(), (tr.nextElementSibling as HTMLElement | null)?.focus());
                    else if (e.key === 'ArrowUp') (e.preventDefault(), (tr.previousElementSibling as HTMLElement | null)?.focus());
                  })}
                  className={cx('group h-row outline-none', onRowClick && 'cursor-pointer', sel ? 'bg-selected' : onRowClick && 'hover:bg-surface-2 focus-visible:bg-surface-2')}>
                  {r.getVisibleCells().map((c, ci) => (
                    <td key={c.id} className={cx('px-3 whitespace-nowrap', ci === 0 && 'sticky left-0 z-[1]', ci === 0 && (sel ? 'bg-selected' : onRowClick ? 'bg-surface group-hover:bg-surface-2 group-focus-visible:bg-surface-2' : 'bg-surface'))}>
                      {ci === 0 && sel && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                  {onRowClick && (
                    <td className="w-6 pr-2 text-muted">
                      <ChevronRight className={cx('size-4 transition-opacity', sel ? 'text-accent opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')} aria-hidden />
                    </td>
                  )}
                </tr>
              );
            })}
            {!filtered.length && (
              <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-sm text-muted">{emptyText}</td></tr>
            )}
          </tbody>
          {rows.length > 1 && !query && (
            <tfoot className="sticky bottom-0 bg-surface-2 text-sm font-semibold">
              <tr className="h-row border-t border-border">
                {columns.map((c) => {
                  if (c.id === 'label') return <td key="label" className="sticky left-0 bg-surface-2 px-3">Tổng</td>;
                  if (!numeric.includes(c.id as NumCol)) return <td key={c.id} />;
                  const id = c.id as NumCol;
                  const v = id === 'share' ? (shareBase > 0 ? 1 : null) : sum[id];
                  return <td key={id} className="num px-3 text-right whitespace-nowrap">{fmt(v, NUM[id].kind)}</td>;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {footer && <div className="border-t border-border px-3 py-2 text-xs text-muted">{footer}</div>}
    </Card>
  );
}
