import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppMapping } from '@shared/types';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { getState } from '@/lib/store';
import { cx } from './ui';

// Màu nền chữ cái thay icon (chưa có icon / mất mạng / ảnh lỗi): cố định theo tên để dễ nhận
const TINTS = ['bg-accent/15 text-accent', 'bg-info/15 text-info', 'bg-success/15 text-success', 'bg-warning/15 text-warning', 'bg-accent-2/15 text-accent-2'];
const tintOf = (s: string) => TINTS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

export function AppIcon({ url, name, size = 'md' }: { url: string | null | undefined; name: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const box = { xs: 'size-4 rounded-[4px] text-[9px]', sm: 'size-6 rounded-md text-[11px]', md: 'size-8 rounded-lg text-sm', lg: 'size-10 rounded-xl text-base' }[size];
  if (url && !broken) {
    return <img src={url} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} className={cx(box, 'shrink-0 border border-border bg-surface-2 object-cover')} />;
  }
  return (
    <span aria-hidden className={cx(box, 'grid shrink-0 place-items-center font-semibold', tintOf(name))}>
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  );
}

// Lấy bù icon cho app đã map từ trước (mỗi phiên chạy một lần, chạy nền)
let backfilled = false;
export function useIconBackfill(apps: AppMapping[]) {
  const qc = useQueryClient();
  const missing = apps.some((a) => !a.iconUrl);
  useEffect(() => {
    if (!missing || backfilled || !getState().online) return;
    backfilled = true;
    api.apps
      .refreshIcons(false)
      .then((n) => {
        if (n) void qc.invalidateQueries({ queryKey: qk.apps });
      })
      .catch(() => (backfilled = false));
  }, [missing, qc]);
}
