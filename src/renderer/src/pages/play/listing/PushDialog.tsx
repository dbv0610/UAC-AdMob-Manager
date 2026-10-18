import { useState } from 'react';
import { Upload } from 'lucide-react';
import { FIELD_LABEL, IMAGE_SPEC, type ImageSet, type ListingDiff, type ListingIssue, type ListingText } from '@shared/listing';
import { useUi } from '@/lib/store';
import { Dialog } from '@/components/dialog';
import { Button, StatusBadge, type Tone } from '@/components/ui';

function Group({ label, tone, langs }: { label: string; tone: Tone; langs: string[] }) {
  if (!langs.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label} <span className="num text-muted">({langs.length})</span></p>
      <div className="flex flex-wrap gap-1">{langs.map((l) => <StatusBadge key={l} tone={tone}>{l}</StatusBadge>)}</div>
    </div>
  );
}

// Xác nhận trước khi ghi lên Play: liệt kê đúng những gì sẽ đổi (nguyên tắc xem trước khi ghi).
export function PushDialog({ diff, texts, issues, staged, pkg, onClose, onConfirm }: {
  diff: ListingDiff;
  texts: ListingText[];
  issues: Map<string, ListingIssue[]>;
  staged: ImageSet[];
  pkg: string;
  onClose: () => void;
  onConfirm: (sendForReview: boolean) => Promise<void>;
}) {
  const online = useUi((s) => s.online);
  const [sendForReview, setSendForReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const pushing = [...diff.added, ...diff.changed];
  const warnings = pushing.flatMap((l) => (issues.get(l) ?? []).filter((i) => i.level === 'warning').map((i) => `${l} · ${FIELD_LABEL[i.field]}: ${i.message}`));
  const files = staged.reduce((n, s) => n + s.files.length, 0);
  const missingImgLang = staged.find((s) => !texts.some((t) => t.language === s.language));

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(sendForReview);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Đẩy trang thông tin lên Play · ${pkg}`} onClose={onClose} width="w-[600px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" icon={Upload} loading={busy} disabled={!online || !!missingImgLang} onClick={confirm}>Đẩy lên Play</Button>
        </>
      }>
      <div className="flex flex-col gap-4">
        <Group label="Thêm bản dịch mới" tone="info" langs={diff.added} />
        <Group label="Cập nhật text" tone="warning" langs={diff.changed} />
        <Group label="Xóa bản dịch (kèm ảnh riêng)" tone="danger" langs={diff.removed} />
        {staged.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Thay ảnh <span className="num text-muted">({files} ảnh · {staged.length} nhóm)</span></p>
            <ul className="text-sm text-muted">
              {staged.map((s) => <li key={`${s.language}|${s.type}`}><span className="font-mono">{s.language}</span> · {IMAGE_SPEC[s.type].label}: {s.files.length} ảnh (xóa ảnh cũ cùng loại)</li>)}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
            <p className="font-medium text-warning">{warnings.length} cảnh báo chính sách metadata — Play có thể từ chối khi duyệt</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-muted">{warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={sendForReview} onChange={(e) => setSendForReview(e.target.checked)} />
          <span>
            <b>Gửi duyệt ngay</b>
            <span className="block text-xs text-muted">Bỏ chọn nếu app đang bật Xuất bản có quản lý hoặc có bản bị từ chối: thay đổi được lưu trên Play Console, bạn tự gửi duyệt sau.</span>
          </span>
        </label>
        <p className="text-xs text-muted">Mọi thay đổi nằm trong một phiên sửa (edit) và chỉ được ghi khi tất cả bước thành công. Đừng sửa trang thông tin trên Play Console trong lúc đang đẩy.</p>
      </div>
    </Dialog>
  );
}
