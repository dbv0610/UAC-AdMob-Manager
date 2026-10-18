import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import { diffTemplates, type RcFetched, type RcProject } from '@shared/remoteConfig';
import { api, parseError } from '@/lib/api';
import { useUi } from '@/lib/store';
import { fmtDateTime } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Skeleton, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { DiffTable } from './DiffTable';
import { rcKey } from '.';

const ORIGIN: Record<string, string> = { CONSOLE: 'Console', REST_API: 'REST API', ADMIN_SDK_NODE: 'Admin SDK', ADMIN_SDK_PYTHON: 'Admin SDK' };
const TYPE: Record<string, string> = { INCREMENTAL_UPDATE: 'Cập nhật', FORCED_UPDATE: 'Ghi đè', ROLLBACK: 'Khôi phục' };

export function History({ project, current, dirty }: { project: RcProject; current: RcFetched; dirty: boolean }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const onError = useErrorHandler();
  const versionsQ = useQuery({ queryKey: ['rc', 'versions', project.projectId], queryFn: () => api.rc.versions(project.accountId, project.projectId) });
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // So bản chọn với bản đang chạy (thấy rõ khôi phục sẽ đổi những gì)
  const selQ = useQuery({ queryKey: ['rc', 'version', project.projectId, sel], queryFn: () => api.rc.version(project.accountId, project.projectId, sel!), enabled: !!sel, staleTime: Infinity });
  const curNo = current.template.version?.versionNumber;
  const rows = selQ.data ? diffTemplates(current.template, selQ.data) : [];

  const rollback = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const f = await api.rc.rollback(project.accountId, project.projectId, sel);
      qc.setQueryData(rcKey(project.accountId, project.projectId), f);
      void versionsQ.refetch();
      toast({ tone: 'success', title: `Đã khôi phục về phiên bản ${sel}`, detail: `Tạo phiên bản mới ${f.template.version?.versionNumber ?? ''}` });
      setConfirm(false);
      setSel(null);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  if (versionsQ.isLoading) return <Skeleton className="h-64" />;
  if (versionsQ.isError) return <Card className="overflow-hidden"><Banner tone="danger" action={<Button size="sm" onClick={() => void versionsQ.refetch()}>Thử lại</Button>}>{parseError(versionsQ.error).message}</Banner></Card>;
  const versions = versionsQ.data ?? [];
  if (!versions.length) return <EmptyState icon={HistoryIcon} title="Chưa có phiên bản nào" />;

  return (
    <div className="grid grid-cols-[360px_1fr] items-start gap-4">
      <Card className="max-h-[calc(100vh-280px)] overflow-y-auto">
        <ul className="divide-y divide-border">
          {versions.map((v) => {
            const no = v.versionNumber ?? '';
            return (
              <li key={no}>
                <button onClick={() => setSel(no === curNo ? null : no)} aria-current={sel === no || undefined}
                  className={cx('flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm', sel === no ? 'bg-accent/10' : 'hover:bg-surface-2')}>
                  <span className="flex items-center gap-2">
                    <b className="num">#{no}</b>
                    {no === curNo && <span className="rounded-sm bg-success/15 px-1 text-[11px] text-success">đang chạy</span>}
                    <span className="text-xs text-muted">{TYPE[v.updateType ?? ''] ?? v.updateType}{v.rollbackSource ? ` từ #${v.rollbackSource}` : ''} · {ORIGIN[v.updateOrigin ?? ''] ?? v.updateOrigin}</span>
                  </span>
                  <span className="text-xs text-muted">{v.updateTime ? fmtDateTime(v.updateTime) : ''}{v.updateUser?.email ? ` · ${v.updateUser.email}` : ''}</span>
                  {v.description && <span className="text-xs">{v.description}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        {!sel ? (
          <p className="text-sm text-muted">Chọn một phiên bản cũ để xem khác gì so với bản đang chạy (#{curNo}) và khôi phục.</p>
        ) : selQ.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Khôi phục #{sel} sẽ đổi so với bản đang chạy #{curNo}</h3>
              <span className="flex-1" />
              <Button variant="primary" icon={RotateCcw} disabled={!online || !rows.length} onClick={() => setConfirm(true)}>Khôi phục #{sel}</Button>
            </div>
            <DiffTable rows={rows} />
          </>
        )}
      </Card>
      {confirm && sel && (
        <Dialog title={`Khôi phục Remote Config về #${sel}`} onClose={() => setConfirm(false)} width="w-[520px]"
          footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Hủy</Button><Button variant="primary" icon={RotateCcw} loading={busy} onClick={rollback}>Khôi phục</Button></>}>
          <div className="flex flex-col gap-2 text-sm">
            <p>Firebase tạo phiên bản mới có nội dung giống #{sel} ({rows.length} thay đổi so với bản đang chạy). Người dùng nhận giá trị cũ ở lần fetch tiếp theo.</p>
            {dirty && <p className="text-warning">Bản nháp chưa publish của project này sẽ bị bỏ.</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
