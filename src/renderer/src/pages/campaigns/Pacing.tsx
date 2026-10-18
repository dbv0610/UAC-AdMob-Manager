import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtMoney, fmtPct } from '@/lib/format';
import { Button, Field, Input, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';

// Ngân sách tháng: đã chi từ đầu tháng (số đồng bộ), dự báo cuối tháng theo tốc độ 7 ngày gần nhất, gợi ý mức tiêu/ngày.

const TONE = { none: 'text-muted', under: 'text-warning', on: 'text-success', over: 'text-danger' } as const;
const STATUS = { none: 'Chưa đặt hạn mức', under: 'Tiêu chậm hơn kế hoạch', on: 'Đúng nhịp', over: 'Sẽ vượt hạn mức' } as const;

export function PacingCard({ customerId }: { customerId: string }) {
  const q = useQuery({ queryKey: ['pacing', customerId], queryFn: () => api.analytics.pacing(customerId) });
  const [edit, setEdit] = useState(false);
  const p = q.data;
  if (!p) return <div className="h-[74px] rounded-lg border border-border bg-surface skeleton" />;
  const money = (v: number) => fmtMoney(v, p.currency);
  const bar = p.budget ? Math.min(1, p.spent / p.budget) : 0;
  const proj = p.budget ? Math.min(1, p.projected / p.budget) : 0;
  return (
    <>
      <button onClick={() => setEdit(true)} title="Bấm để đặt hạn mức tháng"
        className="flex flex-col justify-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-accent/50 sm:col-span-2">
        <span className="flex items-center gap-2 text-xs text-muted">
          <CalendarRange className="size-4 text-accent" aria-hidden /> Ngân sách tháng {p.month.slice(5)}/{p.month.slice(0, 4)}
          <span className={cx('ml-auto font-medium', TONE[p.status])}>{STATUS[p.status]}</span>
        </span>
        {p.budget ? (
          <>
            <span className="num text-left text-sm"><b className="text-lg">{money(p.spent)}</b> / {money(p.budget)} · dự kiến <b className={TONE[p.status]}>{money(p.projected)}</b></span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className={cx('absolute inset-y-0 left-0 rounded-full opacity-30', p.status === 'over' ? 'bg-danger' : 'bg-accent')} style={{ width: `${proj * 100}%` }} />
              <span className={cx('absolute inset-y-0 left-0 rounded-full', p.status === 'over' ? 'bg-danger' : 'brand-gradient')} style={{ width: `${bar * 100}%` }} />
              <span className="absolute inset-y-0 w-0.5 bg-text/60" style={{ left: `${p.elapsed * 100}%` }} title="Hôm nay" />
            </span>
          </>
        ) : (
          <span className="text-sm">Đã chi <b className="num">{money(p.spent)}</b> · dự kiến <b className="num">{money(p.projected)}</b> <span className="text-accent">· đặt hạn mức</span></span>
        )}
      </button>
      {edit && <BudgetDialog customerId={customerId} p={p} onClose={() => setEdit(false)} />}
    </>
  );
}

function BudgetDialog({ customerId, p, onClose }: { customerId: string; p: NonNullable<Awaited<ReturnType<typeof api.analytics.pacing>>>; onClose: () => void }) {
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const [text, setText] = useState(p.budget ? String(p.budget) : '');
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  const valid = !text.trim() || (Number.isFinite(n) && n > 0);
  const money = (v: number) => fmtMoney(v, p.currency);
  const save = async (amount: number | null) => {
    try {
      await api.analytics.setMonthlyBudget(customerId, amount);
      await qc.invalidateQueries({ queryKey: ['pacing', customerId] });
      toast({ tone: 'success', title: amount ? `Hạn mức tháng ${money(amount)}` : 'Đã bỏ hạn mức tháng' });
      onClose();
    } catch (err) {
      onError(err);
    }
  };
  const suggested = valid && n > 0 ? Math.max(0, (n - p.spent) / p.daysLeft) : null;
  return (
    <Dialog title="Hạn mức chi tháng này" onClose={onClose} width="w-[520px]"
      footer={
        <>
          {p.budget != null && <Button variant="ghost" className="mr-auto" onClick={() => void save(null)}>Bỏ hạn mức</Button>}
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" icon={Save} disabled={!valid || !text.trim()} onClick={() => void save(n)}>Lưu</Button>
        </>
      }>
      <div className="flex flex-col gap-4 text-sm">
        <Field label={`Tổng chi tối đa trong tháng (${p.currency})`} htmlFor="mb" error={valid ? undefined : 'Nhập số lớn hơn 0'}>
          <Input id="mb" inputMode="decimal" value={text} invalid={!valid} onChange={(e) => setText(e.target.value)} placeholder="Ví dụ 3000" autoFocus />
        </Field>
        <dl className="grid grid-cols-2 gap-2">
          {[
            ['Đã chi tới hôm qua', money(p.spent)],
            ['Tiêu TB 7 ngày', `${money(p.avg7)}/ngày`],
            ['Tổng ngân sách/ngày camp đang chạy', money(p.dailyBudgets)],
            ['Còn lại trong tháng', `${p.daysLeft} ngày`],
            ['Dự kiến theo nhịp hiện tại', money(p.projected)],
            ['Nếu camp tiêu hết ngân sách', money(p.projectedByBudget)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-surface-2/60 px-2.5 py-1.5"><dt className="text-xs text-muted">{k}</dt><dd className="num text-left font-medium">{v}</dd></div>
          ))}
        </dl>
        {suggested != null && (
          <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2">
            Để vừa hết hạn mức: tiêu khoảng <b className="num">{money(suggested)}/ngày</b> từ hôm nay
            {p.dailyBudgets > 0 && <> ({fmtPct(suggested / p.dailyBudgets - 1, 0).replace(/^(?!-)/, '+')} so với tổng ngân sách/ngày hiện tại)</>}.
          </p>
        )}
        <p className="text-xs text-muted">Số chi lấy từ báo cáo đã đồng bộ (Analytics). Bản tin Telegram mỗi sáng có dòng ngân sách tháng nếu bạn đặt hạn mức.</p>
      </div>
    </Dialog>
  );
}
