import { useState } from 'react';
import { Copy, FileArchive, ScrollText } from 'lucide-react';
import type { JobState } from '@shared/types';
import { useUi } from '@/lib/store';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, EmptyState, PageHeader, StatusBadge, type Tone } from '@/components/ui';
import { JobProgress } from '@/components/shell/JobDrawer';
import { toast } from '@/components/toast';
import { api } from '@/lib/api';
import { useErrorHandler } from '@/components/connect';



const TONE: Record<JobState, [Tone, string]> = {
  queued: ['neutral', 'Chờ'],
  running: ['info', 'Đang chạy'],
  done: ['success', 'Xong'],
  failed: ['danger', 'Lỗi'],
  paused: ['warning', 'Tạm dừng'],
};

export function Logs() {
  const all = useUi((s) => s.jobs);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const onError = useErrorHandler();
  const jobs = onlyErrors ? all.filter((j) => j.state === 'failed') : all;
  const exportBundle = async () => {
    setBusy(true);
    try {
      const p = await api.app.exportDiagnostics();
      if (p) toast({ tone: 'success', title: 'Đã xuất gói chẩn đoán', detail: p, action: { label: 'Mở thư mục', run: () => void api.app.revealDiagnostics(p) } });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Nhật ký">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Chỉ job lỗi
        </label>
        <Button icon={FileArchive} loading={busy} onClick={() => void exportBundle()} title="Log (đã che token), phiên bản, job và thay đổi gần đây — gửi kèm khi báo lỗi">
          Xuất gói chẩn đoán
        </Button>
      </PageHeader>
      <Card>
        {jobs.length === 0 ? (
          <EmptyState icon={ScrollText} title={onlyErrors ? 'Không có job lỗi' : 'Chưa có job nào'}>{onlyErrors ? 'Mọi job gần đây đều chạy xong.' : 'Đăng nhập tài khoản hoặc đồng bộ để thấy job ở đây.'}</EmptyState>
        ) : (
          <ol className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-start gap-3 px-4 py-3">
                <StatusBadge tone={TONE[j.state][0]}>{TONE[j.state][1]}</StatusBadge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{j.title}</p>
                  <p className="num text-left text-xs text-muted">{fmtDateTime(j.createdAt)}</p>
                  {j.error && (
                    <p className="mt-1 text-sm text-danger" data-selectable>
                      {j.error.message}
                      {j.error.code && <span className="ml-2 font-mono text-xs">{j.error.code}</span>}
                    </p>
                  )}
                  <JobProgress job={j} />
                </div>
                {j.error?.requestId && (
                  <Button size="sm" variant="ghost" icon={Copy}
                    onClick={() => navigator.clipboard.writeText(j.error!.requestId!).then(() => toast({ tone: 'success', title: 'Đã sao chép request_id' }))}>
                    request_id
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
