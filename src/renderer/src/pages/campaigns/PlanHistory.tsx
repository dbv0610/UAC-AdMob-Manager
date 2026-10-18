import { useState } from 'react';
import { ChevronLeft, Copy, Eye, History } from 'lucide-react';
import type { PlanRecord } from '@shared/plan';
import { api } from '@/lib/api';
import { usePlans } from '@/lib/queries';
import { setState } from '@/lib/store';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, EmptyState, Skeleton, StatusBadge } from '@/components/ui';
import { toast } from '@/components/toast';
import { PlanResults } from './PlanWizard';
import { draftFromRecord } from './usePlanDraft';

function summary(p: PlanRecord) {
  const rs = Object.values(p.results);
  return {
    total: rs.length,
    ok: rs.filter((r) => r.state === 'done' || r.state === 'exists').length,
    failed: rs.filter((r) => r.state === 'failed').length,
    running: rs.some((r) => r.state === 'running' || r.state === 'pending'),
  };
}

export function PlanHistory() {
  const { data = [], isLoading } = usePlans();
  const [open, setOpen] = useState<PlanRecord | null>(null);

  async function duplicate(p: PlanRecord) {
    const cur = await api.plans.getDraft();
    if (cur?.rows.length && !window.confirm('Bản nháp hiện tại sẽ bị thay bằng bản nhân bản. Tiếp tục?')) return;
    await api.plans.saveDraft(draftFromRecord(p));
    setState({ campaignsTab: 'new' });
    toast({ tone: 'success', title: `Đã nhân bản kế hoạch ${p.appName} · ${p.rows.length} quốc gia`, detail: 'Tên camp mới sẽ có số thứ tự tiếp theo' });
  }

  if (open) {
    return (
      <div className="flex flex-col gap-3">
        <Button className="self-start" variant="ghost" icon={ChevronLeft} onClick={() => setOpen(null)}>Lịch sử</Button>
        <PlanResults initial={open} />
      </div>
    );
  }

  return (
    <Card>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : data.length === 0 ? (
        <EmptyState icon={History} title="Chưa có kế hoạch nào"
          action={<Button variant="primary" onClick={() => setState({ campaignsTab: 'new' })}>Tạo kế hoạch đầu tiên</Button>}>
          Mỗi lần bấm Tạo, kế hoạch được lưu ở đây để xem kết quả hoặc nhân bản sang lần sau.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((p) => {
            const s = summary(p);
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.appName} <span className="text-sm font-normal text-muted">· {p.rows.map((r) => r.countryCode).join(', ')}</span></p>
                  <p className="num text-left text-xs text-muted">{fmtDateTime(p.createdAt)} · tài khoản {p.customerId} · bản {p.version}</p>
                </div>
                {s.running ? (
                  <StatusBadge tone="info">Đang chạy</StatusBadge>
                ) : s.failed ? (
                  <StatusBadge tone="danger">{s.ok}/{s.total} thành công</StatusBadge>
                ) : (
                  <StatusBadge tone="success">{s.total}/{s.total} thành công</StatusBadge>
                )}
                <Button size="sm" variant="ghost" icon={Eye} onClick={() => setOpen(p)}>Kết quả</Button>
                <Button size="sm" icon={Copy} onClick={() => void duplicate(p)}>Nhân bản</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
