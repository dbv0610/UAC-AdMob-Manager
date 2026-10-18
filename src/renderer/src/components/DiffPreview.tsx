import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check } from 'lucide-react';
import type { CampaignChange, CampaignField } from '@shared/types';
import { fmtMoney, fmtPct, fromMicros } from '@/lib/format';
import { Dialog } from './dialog';
import { Banner, Button, Input, cx } from './ui';

const FIELD_LABEL: Record<CampaignField, string> = {
  budget: 'Ngân sách/ngày',
  status: 'Trạng thái',
  targetCpa: 'tCPI / tCPA',
  targetRoas: 'tROAS',
};
const STATUS_LABEL: Record<string, string> = { ENABLED: 'Đang chạy', PAUSED: 'Tạm dừng' };

export function fmtChangeValue(field: CampaignField, v: number | string, currency: string) {
  if (field === 'status') return STATUS_LABEL[String(v)] ?? String(v);
  if (field === 'targetRoas') return fmtPct(Number(v), 0);
  return fmtMoney(fromMicros(Number(v)), currency);
}

// Mức rủi ro: ≥ 10 camp hoặc bật ENABLED hàng loạt → phải gõ số lượng camp để xác nhận.
export function isRisky(changes: CampaignChange[]) {
  const camps = new Set(changes.map((c) => c.campaignId)).size;
  const enabling = changes.filter((c) => c.field === 'status' && c.after === 'ENABLED').length;
  return camps >= 10 || enabling > 1;
}

// Nguyên tắc 1: xem trước rồi mới ghi. Mọi mutate từ danh sách camp đi qua đây.
export function DiffPreview({
  changes,
  currency,
  sharedBudgetNames,
  onCancel,
  onConfirm,
  pending,
}: {
  changes: CampaignChange[];
  currency: string;
  sharedBudgetNames: string[];
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const camps = new Set(changes.map((c) => c.campaignId)).size;
  const risky = isRisky(changes);
  const [typed, setTyped] = useState('');
  const budgets = changes.filter((c) => c.field === 'budget');
  const before = budgets.reduce((s, c) => s + Number(c.before), 0);
  const after = budgets.reduce((s, c) => s + Number(c.after), 0);
  const ok = !risky || typed.trim() === String(camps);

  return (
    <Dialog
      title={`Xem trước thay đổi · ${camps} camp`}
      onClose={onCancel}
      width="w-[760px]"
      footer={
        <>
          {risky && (
            <label className="mr-auto flex items-center gap-2 text-sm">
              Gõ <b className="num">{camps}</b> để xác nhận
              <Input className="w-20" value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" aria-label="Số camp để xác nhận" />
            </label>
          )}
          <Button variant="ghost" onClick={onCancel}>
            Hủy
          </Button>
          <Button variant="primary" icon={Check} disabled={!ok} loading={pending} onClick={onConfirm}>
            Áp dụng {changes.length} thay đổi
          </Button>
        </>
      }
    >
      {budgets.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-sm bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted">Tổng ngân sách/ngày</span>
          <span className="num font-medium">{fmtMoney(fromMicros(before), currency)}</span>
          <ArrowRight className="size-4 text-muted" aria-hidden />
          <span className={cx('num font-semibold', after > before ? 'text-warning' : 'text-success')}>{fmtMoney(fromMicros(after), currency)}</span>
          {before > 0 && <span className="num text-xs text-muted">({after >= before ? '+' : ''}{fmtPct((after - before) / before)})</span>}
        </div>
      )}
      {sharedBudgetNames.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-sm border border-warning/30">
          <Banner tone="warning">
            Ngân sách dùng chung — đổi sẽ ảnh hưởng cả camp khác dùng cùng ngân sách: {sharedBudgetNames.join(', ')}
          </Banner>
        </div>
      )}
      {risky && (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-warning">
          <AlertTriangle className="size-4" aria-hidden /> Thay đổi lớn: kiểm tra kỹ danh sách bên dưới trước khi áp dụng.
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border text-left">
            <th className="py-1.5 font-medium">Camp</th>
            <th className="py-1.5 font-medium">Trường</th>
            <th className="py-1.5 text-right font-medium">Trước</th>
            <th className="w-6" />
            <th className="py-1.5 text-right font-medium">Sau</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={`${c.campaignId}:${c.field}`} className="border-b border-border/60">
              <td className="max-w-72 truncate py-1.5 pr-2" title={c.name}>
                {c.name}
              </td>
              <td className="py-1.5 text-muted">{FIELD_LABEL[c.field]}</td>
              <td className="num py-1.5 text-right text-muted line-through decoration-muted/50">{fmtChangeValue(c.field, c.before, currency)}</td>
              <td className="text-center text-muted">→</td>
              <td className="num py-1.5 text-right font-medium">{fmtChangeValue(c.field, c.after, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
