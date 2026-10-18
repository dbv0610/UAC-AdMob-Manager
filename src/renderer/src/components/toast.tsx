import { useEffect, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Button, StatusBadge, type Tone } from './ui';
import type { AppError } from '@shared/types';

// Toast có nút hành động; dùng cho "Hoàn tác" 10 giây và lỗi có cách sửa.
export interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

let toasts: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) {
  const item = { ttl: 6000, ...t, id: ++seq };
  toasts = [...toasts, item].slice(-4);
  emit();
  return item.id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const ACTION_LABEL: Record<NonNullable<AppError['action']>, string> = {
  retry: 'Thử lại',
  reauth: 'Đăng nhập lại',
  openSettings: 'Mở Cài đặt',
  fix: 'Sửa',
};

export function toastError(err: AppError, handlers: Partial<Record<NonNullable<AppError['action']>, () => void>> = {}) {
  const run = err.action ? handlers[err.action] : undefined;
  toast({
    tone: 'danger',
    title: err.message,
    detail: [err.code, err.field && `Ô: ${err.field}`, err.requestId && `request_id ${err.requestId}`].filter(Boolean).join(' · ') || undefined,
    action: run && err.action ? { label: ACTION_LABEL[err.action], run } : undefined,
    ttl: 10_000,
  });
}

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    const h = setTimeout(() => dismiss(t.id), t.ttl);
    return () => clearTimeout(h);
  }, [t.id, t.ttl]);
  return (
    <div role="status" className="pointer-events-auto flex w-96 items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg">
      <div className="flex-1 space-y-1">
        <StatusBadge tone={t.tone}>{t.tone === 'danger' ? 'Lỗi' : t.tone === 'warning' ? 'Cảnh báo' : t.tone === 'success' ? 'Xong' : 'Thông báo'}</StatusBadge>
        <p className="text-sm" data-selectable>{t.title}</p>
        {t.detail && <p className="font-mono text-xs text-muted" data-selectable>{t.detail}</p>}
      </div>
      {t.action && (
        <Button size="sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>
          {t.action.label}
        </Button>
      )}
      <button aria-label="Đóng thông báo" className="text-muted hover:text-text" onClick={() => dismiss(t.id)}>
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => toasts,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-10 z-50 flex flex-col gap-2">
      {list.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
