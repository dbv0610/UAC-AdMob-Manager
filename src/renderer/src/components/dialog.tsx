import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, cx } from './ui';

// Hộp thoại modal: Esc để đóng, focus vào phần tử đầu tiên, trả focus khi đóng.
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 'w-[640px]',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button:not([data-close]), select, textarea')?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => {
      window.removeEventListener('keydown', h, true);
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx('flex max-h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl', width)}
      >
        <div className="brand-gradient h-0.5" aria-hidden />
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <Button data-close size="sm" variant="ghost" icon={X} aria-label="Đóng" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
