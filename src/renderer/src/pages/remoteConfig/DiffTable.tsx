import type { RcDiffRow } from '@shared/remoteConfig';
import { StatusBadge, cx, type Tone } from '@/components/ui';
import { JsonView, isJsonLike } from './Json';

const KIND: Record<RcDiffRow['kind'], [Tone, string]> = { added: ['info', 'Thêm'], changed: ['warning', 'Sửa'], removed: ['danger', 'Xóa'] };
const WHAT: Record<RcDiffRow['what'], string> = { value: 'Giá trị', parameter: 'Tham số', condition: 'Điều kiện' };

// Giá trị dài (JSON) cắt bớt, rê chuột xem đủ
function Val({ v, strike }: { v: string | null; strike?: boolean }) {
  if (v == null) return <span className="text-muted">—</span>;
  if (isJsonLike(v)) return <JsonView value={v} lines={6} className={strike ? 'opacity-60' : undefined} />;
  return (
    <span title={v} className={cx('line-clamp-3 font-mono text-xs break-all whitespace-pre-wrap', strike && 'text-muted line-through decoration-muted/40')} data-selectable>
      {v === '' ? '(chuỗi rỗng)' : v}
    </span>
  );
}

export function DiffTable({ rows, max = 300 }: { rows: RcDiffRow[]; max?: number }) {
  if (!rows.length) return <p className="text-sm text-muted">Không có khác biệt.</p>;
  return (
    <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
          <tr>
            <th className="w-20 px-2 py-1.5 font-medium" />
            <th className="px-2 py-1.5 font-medium">Mục</th>
            <th className="px-2 py-1.5 font-medium">Trước</th>
            <th className="px-2 py-1.5 font-medium">Sau</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="align-top">
              <td className="px-2 py-1.5"><StatusBadge tone={KIND[r.kind][0]}>{KIND[r.kind][1]}</StatusBadge></td>
              <td className="px-2 py-1.5">
                <span className="block text-xs text-muted">{WHAT[r.what]}{r.group ? ` · nhóm ${r.group}` : ''}</span>
                <span className="font-mono text-xs font-medium" data-selectable>{r.key}</span>
                {r.slot && <span className="block text-xs text-muted">{r.slot === 'default' ? 'mặc định' : `điều kiện: ${r.slot}`}</span>}
              </td>
              <td className="max-w-80 px-2 py-1.5"><Val v={r.before} strike={r.kind === 'changed'} /></td>
              <td className="max-w-80 px-2 py-1.5"><Val v={r.after} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="px-2 py-1.5 text-xs text-muted">…và {rows.length - max} thay đổi khác</p>}
    </div>
  );
}
