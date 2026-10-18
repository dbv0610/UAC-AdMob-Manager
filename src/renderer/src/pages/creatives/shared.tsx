import { useState } from 'react';
import { CheckCircle2, Clock, CloudUpload, Film, HardDrive, ImageIcon, Lock, Pause, XCircle, type LucideIcon } from 'lucide-react';
import { ASPECT_LABEL, type Creative, type CreativeStatus } from '@shared/creative';
import { StatusBadge, cx, type Tone } from '@/components/ui';
import { fmtNumber } from '@/lib/format';

export const STATUS: Record<CreativeStatus, { tone: Tone; label: string; icon: LucideIcon }> = {
  LOCAL: { tone: 'neutral', label: 'Trên máy', icon: HardDrive },
  QUEUED: { tone: 'info', label: 'Chờ upload', icon: Clock },
  UPLOADING: { tone: 'info', label: 'Đang upload', icon: CloudUpload },
  PAUSED: { tone: 'warning', label: 'Tạm dừng', icon: Pause },
  PROCESSING: { tone: 'info', label: 'YouTube đang xử lý', icon: Clock },
  READY: { tone: 'success', label: 'Sẵn sàng', icon: CheckCircle2 },
  LOCKED: { tone: 'danger', label: 'Bị khóa Private', icon: Lock },
  FAILED: { tone: 'danger', label: 'Lỗi', icon: XCircle },
};

export function CreativeStatusBadge({ c, pct }: { c: Creative; pct?: number }) {
  const s = STATUS[c.status];
  return (
    <StatusBadge tone={s.tone} icon={s.icon}>
      {s.label}
      {c.status === 'UPLOADING' && pct != null && <span className="num"> {pct}%</span>}
    </StatusBadge>
  );
}

export const fmtDuration = (s: number | null) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

export const fmtBytes = (b: number | null) =>
  b == null ? '—' : b >= 1 << 30 ? `${fmtNumber(b / (1 << 30), 1)} GB` : b >= 1 << 20 ? `${fmtNumber(b / (1 << 20), 1)} MB` : `${fmtNumber(Math.max(1, b / 1024))} KB`;

export const aspectLabel = (c: Creative) => (c.aspect ? ASPECT_LABEL[c.aspect] : 'Chưa rõ tỉ lệ');

export function thumbUrl(c: Creative) {
  if (c.source === 'file') return `uac-thumb://${c.id}`;
  return c.youtubeId ? `https://i.ytimg.com/vi/${c.youtubeId}/mqdefault.jpg` : null;
}

export function Thumb({ c, className }: { c: Creative; className?: string }) {
  const [broken, setBroken] = useState(false);
  const url = thumbUrl(c);
  const Icon = c.kind === 'image' ? ImageIcon : Film;
  return (
    <div className={cx('flex items-center justify-center overflow-hidden bg-surface-2', className)}>
      {url && !broken ? (
        <img src={url} alt="" loading="lazy" draggable={false} className="h-full w-full object-contain" onError={() => setBroken(true)} />
      ) : (
        <Icon className="size-6 text-muted" aria-hidden />
      )}
    </div>
  );
}

// Bộ lọc thư viện: giữ khi mở lại app (tiện ích trên máy này)
export type StatusFilter = 'all' | 'ready' | 'local' | 'active' | 'problem';
export interface LibFilter {
  q: string;
  status: StatusFilter;
  aspect: 'all' | 'landscape' | 'portrait' | 'square';
  country: string;
  scope: 'app' | 'all';
}
const DEFAULT_FILTER: LibFilter = { q: '', status: 'all', aspect: 'all', country: '', scope: 'app' };

export function loadFilter(): LibFilter {
  try {
    return { ...DEFAULT_FILTER, ...JSON.parse(localStorage.getItem('creatives.filter') ?? '{}') };
  } catch {
    return DEFAULT_FILTER;
  }
}
export function saveFilter(f: LibFilter) {
  try {
    localStorage.setItem('creatives.filter', JSON.stringify(f));
  } catch {
    /* bỏ qua */
  }
}
export const isDefaultFilter = (f: LibFilter) => f.q === '' && f.status === 'all' && f.aspect === 'all' && f.country === '';

export const STATUS_GROUP: Record<StatusFilter, CreativeStatus[] | null> = {
  all: null,
  ready: ['READY'],
  local: ['LOCAL'],
  active: ['QUEUED', 'UPLOADING', 'PAUSED', 'PROCESSING'],
  problem: ['FAILED', 'LOCKED'],
};

export function applyFilter(list: Creative[], f: LibFilter, appId: string | null) {
  const q = f.q.trim().toLowerCase();
  const group = STATUS_GROUP[f.status];
  return list.filter(
    (c) =>
      (f.scope === 'all' || !appId || c.appId === appId || c.appId == null) &&
      (!group || group.includes(c.status)) &&
      (f.aspect === 'all' || c.aspect === f.aspect) &&
      (!f.country || c.countries.includes(f.country) || (f.country === '*' && c.countries.length === 0)) &&
      (!q || c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q) || c.youtubeId?.toLowerCase() === q),
  );
}
