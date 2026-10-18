import { useEffect, useRef } from 'react';
import { CheckCircle2, Clock, Loader2, PauseCircle, X, XCircle, type LucideIcon } from 'lucide-react';
import type { Job, JobState } from '@shared/types';
import { useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { fmtTime } from '@/lib/format';
import { cx } from '../ui';

const STATE: Record<JobState, { icon: LucideIcon; label: string; cls: string }> = {
  queued: { icon: Clock, label: 'Chờ', cls: 'text-muted' },
  running: { icon: Loader2, label: 'Đang chạy', cls: 'text-info' },
  done: { icon: CheckCircle2, label: 'Xong', cls: 'text-success' },
  failed: { icon: XCircle, label: 'Lỗi', cls: 'text-danger' },
  paused: { icon: PauseCircle, label: 'Tạm dừng', cls: 'text-warning' },
};

export function JobProgress({ job }: { job: Job }) {
  const p = job.progress;
  if (!p || job.state === 'done') return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const text = p.unit === '%' ? `${pct}%` : `${p.done}/${p.total}`;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="num w-12 text-xs text-muted">{text}</span>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const s = STATE[job.state];
  return (
    <li className="border-b border-border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <s.icon className={cx('mt-0.5 size-4 shrink-0', s.cls, job.state === 'running' && 'animate-spin')} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={job.title}>{job.title}</p>
          <p className="text-xs text-muted">
            <span className={s.cls}>{s.label}</span> · {fmtTime(job.updatedAt)}
          </p>
          {job.error && <p className="mt-1 text-xs text-danger" data-selectable>{job.error.message}</p>}
          <JobProgress job={job} />
        </div>
      </div>
    </li>
  );
}

// Ngăn kéo bên phải: tự mở khi có job mới, tự ẩn khi mọi job tự-mở đã xong (nguyên tắc 4).
export function JobDrawer() {
  const open = useUi((s) => s.prefs?.jobDrawerOpen ?? false);
  const jobs = useUi((s) => s.jobs);
  const autoOpened = useRef(false);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(jobs.map((j) => j.id)); // bỏ qua job cũ lúc khởi động
      return;
    }
    const fresh = jobs.some((j) => !seen.current!.has(j.id));
    jobs.forEach((j) => seen.current!.add(j.id));
    if (fresh && !open) {
      autoOpened.current = true;
      void updatePrefs({ jobDrawerOpen: true });
    }
    const active = jobs.some((j) => j.state === 'queued' || j.state === 'running');
    const failed = jobs.some((j) => j.state === 'failed' && Date.now() - Date.parse(j.updatedAt) < 10_000);
    if (!active && !failed && autoOpened.current && open) {
      const h = setTimeout(() => {
        autoOpened.current = false;
        void updatePrefs({ jobDrawerOpen: false });
      }, 3000);
      return () => clearTimeout(h);
    }
  }, [jobs, open]);

  if (!open) return null;
  return (
    <aside aria-label="Hàng đợi job" className="flex w-72 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">Hàng đợi job</h2>
        <button aria-label="Đóng hàng đợi job" className="text-muted hover:text-text" onClick={() => updatePrefs({ jobDrawerOpen: false })}>
          <X className="size-4" />
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="p-4 text-sm text-muted">Chưa có job nào. Upload, tạo camp và đồng bộ sẽ hiện ở đây.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto">{jobs.map((j) => <JobRow key={j.id} job={j} />)}</ul>
      )}
    </aside>
  );
}
