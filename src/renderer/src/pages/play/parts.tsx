import { Star } from 'lucide-react';
import { STATUS_LABEL, type PlayRelease, type PlayTrack, type ReleaseStatus, type VitalsLevel } from '@shared/playOps';
import { fmtPct } from '@/lib/format';
import { StatusBadge, cx, type Tone } from '@/components/ui';

// Mảnh giao diện dùng chung giữa các tab Google Play.

export const RELEASE_TONE: Record<ReleaseStatus, Tone> = { draft: 'neutral', inProgress: 'info', halted: 'warning', completed: 'success' };
export const VITALS_TONE: Record<VitalsLevel, Tone> = { good: 'success', warn: 'warning', bad: 'danger' };
export const VITALS_LABEL: Record<VitalsLevel, string> = { good: 'Tốt', warn: 'Gần ngưỡng', bad: 'Vượt ngưỡng' };

export const releaseName = (r: PlayRelease) => r.name || (r.versionCodes.length ? `#${r.versionCodes.join(', #')}` : 'Bản nháp');
export const fraction = (f: number | null) => (f == null ? '' : `${+(f * 100).toFixed(2)}%`);
export const ratePct = (v: number | null | undefined) => (v == null ? '—' : fmtPct(v, 2));

// Bản đang được chú ý nhất của track: đang rollout/tạm dừng trước, rồi bản hoàn tất
export function activeRelease(t: PlayTrack | undefined) {
  if (!t) return null;
  return t.releases.find((r) => r.status === 'inProgress' || r.status === 'halted') ?? t.releases.find((r) => r.status === 'completed') ?? t.releases[0] ?? null;
}

export function ReleaseBadge({ r }: { r: PlayRelease }) {
  return (
    <StatusBadge tone={RELEASE_TONE[r.status]}>
      {STATUS_LABEL[r.status]}{r.userFraction != null && r.status !== 'completed' ? ` ${fraction(r.userFraction)}` : ''}
    </StatusBadge>
  );
}

export function RolloutBar({ value, halted }: { value: number; halted?: boolean }) {
  return (
    <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Rollout ${fraction(value)}`}>
      <span className={cx('block h-full rounded-full', halted ? 'bg-warning' : 'bg-info')} style={{ width: `${Math.max(2, value * 100)}%` }} />
    </span>
  );
}

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'xs' }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} sao`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cx(size === 'sm' ? 'size-3.5' : 'size-3', i <= value ? (value <= 2 ? 'fill-danger text-danger' : 'fill-warning text-warning') : 'text-muted/40')} aria-hidden />
      ))}
    </span>
  );
}
