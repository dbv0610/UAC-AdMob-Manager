import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button, cx } from './ui';

// Ngăn trượt bên phải để xem chi tiết một mục mà không rời bảng:
// không chặn nền (bấm dòng khác thì đổi mục), ←/→ chuyển mục trước/sau, Esc đóng.
export interface DrawerTab {
  id: string;
  label: string;
  badge?: ReactNode;
}

export function Drawer({
  title,
  subtitle,
  leading,
  onClose,
  nav,
  tabs,
  tab,
  onTab,
  actions,
  children,
  width = 'w-[600px]',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode; // cờ nước, icon…
  onClose: () => void;
  nav?: { index: number; total: number; prev: () => void; next: () => void };
  tabs?: DrawerTab[];
  tab?: string;
  onTab?: (id: string) => void;
  actions?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role=dialog][aria-modal=true]')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && navRef.current) {
        e.preventDefault();
        navRef.current.prev();
      } else if (e.key === 'ArrowRight' && navRef.current) {
        e.preventDefault();
        navRef.current.next();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <aside ref={ref} aria-label={typeof title === 'string' ? `Chi tiết ${title}` : 'Chi tiết'}
      className={cx('drawer-in fixed top-[84px] right-0 bottom-7 z-30 flex max-w-[calc(100vw-80px)] flex-col border-l border-border bg-surface shadow-[-12px_0_32px_-12px_rgb(15_23_42/0.25)]', width)}>
      <div className="brand-gradient h-0.5 shrink-0" aria-hidden />
      <header className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3">
        {leading && <div className="mt-0.5 shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg leading-tight font-semibold">{title}</h2>
          {subtitle && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{subtitle}</div>}
        </div>
        {nav && nav.total > 1 && (
          <div className="flex items-center gap-0.5">
            <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Mục trước (←)" title="Mục trước (←)" disabled={nav.index <= 0} onClick={nav.prev} />
            <span className="num w-12 text-center text-xs text-muted">{nav.index + 1}/{nav.total}</span>
            <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="Mục sau (→)" title="Mục sau (→)" disabled={nav.index >= nav.total - 1} onClick={nav.next} />
          </div>
        )}
        {actions}
        <Button size="sm" variant="ghost" icon={X} aria-label="Đóng (Esc)" title="Đóng (Esc)" onClick={onClose} />
      </header>
      {tabs && (
        <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-4">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onTab?.(t.id)}
              className={cx('-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm', tab === t.id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
              {t.label}
              {t.badge}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}
