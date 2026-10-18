import type { ReactNode } from 'react';
import { AlertTriangle, Info, XCircle, type LucideIcon } from 'lucide-react';
import { fmtPct } from '@/lib/format';
import { cx } from './ui';

// Bộ mảnh giao diện dùng chung cho các màn có bảng + ngăn chi tiết (Analytics, Campaigns, Creatives, Rules).

export function Segmented({ value, onChange, options, label, size = 'sm' }: { value: string; onChange: (v: string) => void; options: [string, ReactNode][]; label: string; size?: 'xs' | 'sm' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-surface-2 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cx('rounded-[5px] font-medium transition-colors', size === 'xs' ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
            value === v ? 'bg-surface text-accent shadow-sm ring-1 ring-border' : 'text-muted hover:text-text')}>
          {l}
        </button>
      ))}
    </div>
  );
}

// % so kỳ trước dạng viên thuốc: xanh = tốt, đỏ = xấu (theo chiều tốt của chỉ số)
export function DeltaPill({ value, goodUp, small }: { value: number | null; goodUp: boolean; small?: boolean }) {
  if (value == null || !isFinite(value)) return <span className="text-xs text-muted/60">—</span>;
  const flat = Math.abs(value) < 0.005;
  const good = flat ? null : value > 0 === goodUp;
  return (
    <span className={cx('num inline-flex items-center gap-0.5 rounded-full font-medium', small ? 'px-1.5 text-[11px]' : 'px-2 py-0.5 text-xs',
      good == null ? 'bg-surface-2 text-muted' : good ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
      {flat ? '±' : value > 0 ? '▲' : '▼'} {fmtPct(Math.abs(value), Math.abs(value) < 0.1 ? 1 : 0)}
    </span>
  );
}

// Chip lọc có số đếm (thay cho ô chọn): bấm để lọc nhanh, số giúp thấy ngay phân bố
export interface Chip<T extends string> {
  id: T;
  label: string;
  count?: number;
  tone?: 'danger' | 'warning' | 'success' | 'info';
}
const CHIP_TONE = { danger: 'bg-danger/10 text-danger ring-danger/40', warning: 'bg-warning/10 text-warning ring-warning/40', success: 'bg-success/10 text-success ring-success/40', info: 'bg-info/10 text-info ring-info/40' } as const;

export function FilterChips<T extends string>({ chips, value, onChange, label }: { chips: Chip<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const on = value === c.id;
        return (
          <button key={c.id} role="radio" aria-checked={on} onClick={() => onChange(c.id)}
            className={cx('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors',
              on ? (c.tone ? CHIP_TONE[c.tone] : 'bg-accent text-accent-fg ring-accent') : 'bg-surface text-muted ring-border hover:text-text')}>
            {c.label}
            {c.count != null && <span className={cx('num rounded-full px-1.5 text-[11px]', on ? 'bg-black/10' : 'bg-surface-2')}>{c.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Thẻ tóm tắt nhỏ đầu trang; có onClick thì là nút lọc nhanh
export function SummaryCard({ icon: Icon, label, value, sub, tone, onClick, active }: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'accent' | 'accent-2' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
  active?: boolean;
}) {
  const tint = { accent: 'bg-accent/10 text-accent', 'accent-2': 'bg-accent-2/10 text-accent-2', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger', info: 'bg-info/10 text-info' }[tone ?? 'accent'];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} aria-pressed={onClick ? !!active : undefined}
      className={cx('flex items-center gap-3 rounded-lg border bg-surface px-3.5 py-3 text-left', onClick && 'transition-colors hover:border-accent/50', active ? 'border-accent/70 ring-2 ring-accent/15' : 'border-border')}>
      <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg', tint)}><Icon className="size-4.5" aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted">{label}</span>
        <span className="num block text-left text-lg leading-tight font-semibold">{value}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
    </Tag>
  );
}

export type Flag = { level: 'danger' | 'warning' | 'info'; message: string };
export const flagCounts = (fl: Flag[] = []) => ({
  danger: fl.filter((f) => f.level === 'danger').length,
  warning: fl.filter((f) => f.level === 'warning').length,
  info: fl.filter((f) => f.level === 'info').length,
});

export function DeltaSmall({ v, goodUp = true }: { v: number | null; goodUp?: boolean }) {
  if (v == null || !isFinite(v) || Math.abs(v) < 0.005) return null;
  return <span className={cx('text-[11px]', v > 0 === goodUp ? 'text-success' : 'text-danger')}>{v > 0 ? '▲' : '▼'}{fmtPct(Math.abs(v), 0)}</span>;
}

export interface Stat {
  label: string;
  value: string;
  d?: number | null;
  goodUp?: boolean;
  tone?: 'success' | 'warning' | 'danger';
  hint?: string;
}
const TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;

export function StatGrid({ items, cols = 3 }: { items: Stat[]; cols?: 3 | 4 }) {
  return (
    <dl className={cx('grid gap-2', cols === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
      {items.map((s) => (
        <div key={s.label} className="rounded-md border border-border bg-surface-2/60 px-2.5 py-2" title={s.hint}>
          <dt className="truncate text-xs text-muted">{s.label}</dt>
          <dd className={cx('num mt-0.5 text-left text-base font-semibold', s.tone && TONE[s.tone])}>{s.value}</dd>
          {s.d !== undefined && <div className="mt-1"><DeltaPill value={s.d} goodUp={s.goodUp ?? true} small /></div>}
        </div>
      ))}
    </dl>
  );
}

const FLAG_BOX = { danger: 'border-danger/25 bg-danger/5', warning: 'border-warning/25 bg-warning/5', info: 'border-info/25 bg-info/5' } as const;

export function FlagList({ flags, compact }: { flags: Flag[]; compact?: boolean }) {
  if (!flags.length) return null;
  return (
    <ul className={cx('flex flex-col', compact ? 'gap-0.5' : 'gap-1.5')}>
      {flags.map((f, i) => {
        const Icon = f.level === 'danger' ? XCircle : f.level === 'warning' ? AlertTriangle : Info;
        const t = f.level === 'danger' ? 'danger' : f.level === 'warning' ? 'warning' : 'info';
        return (
          <li key={i} className={cx('flex items-start gap-2 text-sm', compact ? 'text-xs' : cx('rounded-md border px-3 py-2', FLAG_BOX[t]))}>
            <Icon className={cx('mt-0.5 size-4 shrink-0', `text-${t}`)} aria-label={t === 'danger' ? 'Đỏ' : t === 'warning' ? 'Vàng' : 'Thông tin'} />
            <span>{f.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Bảng nhỏ trong ngăn chi tiết; dòng có onClick thì bấm được (mở mục liên quan)
export function CompactTable({ head, rows, empty }: { head: string[]; rows: { key: string; cells: ReactNode[]; onClick?: () => void }[]; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>{head.map((h, i) => <th key={h} className={cx('px-3 py-1.5 font-medium', i ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key} tabIndex={r.onClick ? 0 : undefined} onClick={r.onClick} onKeyDown={r.onClick && ((e) => e.key === 'Enter' && r.onClick!())}
              className={cx(r.onClick && 'cursor-pointer outline-none hover:bg-surface-2 focus-visible:bg-surface-2')}>
              {r.cells.map((c, i) => <td key={i} className={cx('px-3 py-1.5', i ? 'num whitespace-nowrap' : 'max-w-56 truncate')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
