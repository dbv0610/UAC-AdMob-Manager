import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, TrendingDown, TrendingUp, XCircle, type LucideIcon } from 'lucide-react';
import { fmtMoney, fmtPct } from '@/lib/format';

export const cx = clsx;

// ── Button ──────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110',
  secondary: 'bg-surface border border-border hover:bg-surface-2',
  ghost: 'hover:bg-surface-2 text-muted hover:text-text',
  danger: 'bg-danger text-white dark:text-slate-950 hover:brightness-110',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8 px-3 text-sm',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
});

// ── Input / Select / Field ─────────────────────────────────────────────────
// Mặc định rộng hết khung; truyền class w-… để đặt độ rộng riêng
const width = (className?: string) => (/(^|\s)w-/.test(className ?? '') ? undefined : 'w-full');
const inputBase =
  'h-8 rounded-sm border bg-surface px-2.5 text-sm text-text placeholder:text-muted/70 outline-none ' +
  'focus:border-accent focus-visible:outline-none focus:ring-2 focus:ring-accent/30';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(inputBase, width(className), invalid ? 'border-danger' : 'border-border', className)}
        {...rest}
      />
    );
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, width(className), 'border-border pr-7', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-xs text-danger">
          <XCircle className="size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

// ── Trạng thái: luôn có icon + chữ ─────────────────────────────────────────
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const TONE_ICON: Record<Tone, LucideIcon> = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info, neutral: Info };
const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-muted',
};
const TONE_BG: Record<Tone, string> = {
  success: 'bg-success/10 border-success/30',
  warning: 'bg-warning/10 border-warning/30',
  danger: 'bg-danger/10 border-danger/30',
  info: 'bg-info/10 border-info/30',
  neutral: 'bg-surface-2 border-border',
};

export function StatusBadge({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: LucideIcon }) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONE_BG[tone], TONE_TEXT[tone])}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

export function Banner({ tone, children, action }: { tone: Tone; children: ReactNode; action?: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex items-center gap-2 border-b px-4 py-2 text-sm', TONE_BG[tone])}>
      <Icon className={cx('size-4 shrink-0', TONE_TEXT[tone])} aria-hidden />
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-lg bg-surface-2 p-3">
        <Icon className="size-6 text-muted" aria-hidden />
      </div>
      <div>
        <p className="text-lg font-semibold">{title}</p>
        {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg border border-border bg-surface', className)}>{children}</div>;
}

export function PageHeader({ title, children, leading }: { title: string; children?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 pb-4">
      <h1 className="flex items-center gap-3 text-xl font-semibold">{leading}{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

// ── Số liệu ────────────────────────────────────────────────────────────────
export function MoneyCell({ value, currency }: { value: number | null; currency: string }) {
  return <span className="num block">{value == null ? '—' : fmtMoney(value, currency)}</span>;
}

// ▲▼ kèm %; goodWhenUp=false cho chỉ số như CPI (tăng là xấu)
export function DeltaBadge({ value, goodWhenUp = true }: { value: number | null; goodWhenUp?: boolean }) {
  if (value == null || !isFinite(value)) return <span className="num text-xs text-muted">—</span>;
  const up = value >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cx('num inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-success' : 'text-danger')}>
      <Icon className="size-3.5" aria-hidden />
      <span>{up ? '▲' : '▼'} {fmtPct(Math.abs(value))}</span>
    </span>
  );
}

// Nhãn đếm theo mức độ (cảnh báo, cờ): gọn hơn chữ dài trong bảng, chi tiết nằm ở tooltip/ngăn chi tiết
export function SeverityPills({ danger = 0, warning = 0, info = 0, title }: { danger?: number; warning?: number; info?: number; title?: string }) {
  if (!danger && !warning && !info) return <span className="text-xs text-muted/60">—</span>;
  const pill = 'inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold';
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {danger > 0 && <span className={cx(pill, 'bg-danger/12 text-danger ring-1 ring-danger/25')}><XCircle className="size-3" aria-hidden />{danger}</span>}
      {warning > 0 && <span className={cx(pill, 'bg-warning/12 text-warning ring-1 ring-warning/25')}><AlertTriangle className="size-3" aria-hidden />{warning}</span>}
      {info > 0 && <span className={cx(pill, 'bg-info/12 text-info ring-1 ring-info/25')}><Info className="size-3" aria-hidden />{info}</span>}
      <span className="sr-only">{[danger && `${danger} đỏ`, warning && `${warning} vàng`, info && `${info} gợi ý`].filter(Boolean).join(', ')}</span>
    </span>
  );
}
