import { Maximize2, Plus } from 'lucide-react';
import { LISTING_MAX, languageName, playLength, type ImageSet, type ListingField, type ListingIssue, type ListingText, type PlayLanguage } from '@shared/listing';
import { counterTone } from '@shared/textLength';
import { Button, Card, Select, StatusBadge, cx, type Tone } from '@/components/ui';

export type RowState = 'added' | 'changed' | 'removed' | 'same';
export const ROW_BADGE: Record<Exclude<RowState, 'same'>, [Tone, string]> = { added: ['info', 'Mới'], changed: ['warning', 'Đã sửa'], removed: ['danger', 'Xóa'] };

function Cell({ field, value, issues, onChange, label }: { field: ListingField; value: string; issues: ListingIssue[]; onChange: (v: string) => void; label: string }) {
  const len = playLength(value);
  const max = LISTING_MAX[field];
  const tone = counterTone(len, max);
  const mine = issues.filter((i) => i.field === field);
  const err = mine.some((i) => i.level === 'error');
  const warn = mine.filter((i) => i.level === 'warning');
  return (
    <div className="flex flex-col gap-0.5">
      <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} aria-invalid={err || undefined} title={warn.map((w) => w.message).join('\n') || undefined}
        className={cx('h-8 w-full rounded-sm border bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30', err ? 'border-danger' : warn.length ? 'border-warning' : 'border-border')} />
      <span className={cx('num text-[11px]', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>
        {len}/{max}{warn.length > 0 && <span className="ml-1 text-warning">⚠ {warn[0].message}</span>}
      </span>
    </div>
  );
}

// Mọi ngôn ngữ trên một bảng: sửa tên + mô tả ngắn tại chỗ, ngôn ngữ mặc định ghim đầu để đối chiếu.
// Mô tả đầy đủ dài nên mở sang chế độ Từng ngôn ngữ.
export function ListingTable({ rows, texts, defaultLang, issues, stateOf, staged, missing, onChange, onAdd, onOpen }: {
  rows: string[];
  texts: ListingText[];
  defaultLang: string;
  issues: Map<string, ListingIssue[]>;
  stateOf: (lang: string) => RowState;
  staged: ImageSet[];
  missing: PlayLanguage[];
  onChange: (t: ListingText) => void;
  onAdd: (code: string) => void;
  onOpen: (lang: string) => void;
}) {
  const byLang = new Map(texts.map((t) => [t.language, t]));
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-border bg-surface-2 text-left text-xs text-muted">
          <tr>
            <th className="w-48 px-3 py-2 font-medium">Ngôn ngữ</th>
            <th className="w-64 px-3 py-2 font-medium">Tên ứng dụng (30)</th>
            <th className="px-3 py-2 font-medium">Mô tả ngắn (80)</th>
            <th className="w-72 px-3 py-2 font-medium">Mô tả đầy đủ (4000)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((lang) => {
            const t = byLang.get(lang);
            const st = stateOf(lang);
            const iss = issues.get(lang) ?? [];
            const errs = iss.filter((i) => i.level === 'error').length;
            const imgs = staged.filter((s) => s.language === lang).reduce((n, s) => n + s.files.length, 0);
            const fullLen = t ? playLength(t.fullDescription) : 0;
            return (
              <tr key={lang} className={cx('align-top', lang === defaultLang && 'bg-accent/5')}>
                <td className="px-3 py-2">
                  <button className="text-left hover:text-accent" onClick={() => onOpen(lang)}>
                    <span className={cx('block font-medium', st === 'removed' && 'text-muted line-through')}>{languageName(lang)}</span>
                    <span className="font-mono text-xs text-muted">{lang}{lang === defaultLang && ' · mặc định'}{imgs > 0 && ` · ${imgs} ảnh`}</span>
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {st !== 'same' && <StatusBadge tone={ROW_BADGE[st][0]}>{ROW_BADGE[st][1]}</StatusBadge>}
                    {errs > 0 && st !== 'removed' && <StatusBadge tone="danger">{errs} lỗi</StatusBadge>}
                  </div>
                </td>
                {t ? (
                  <>
                    <td className="px-3 py-2"><Cell field="title" label={`Tên ứng dụng ${lang}`} value={t.title} issues={iss} onChange={(v) => onChange({ ...t, title: v })} /></td>
                    <td className="px-3 py-2"><Cell field="shortDescription" label={`Mô tả ngắn ${lang}`} value={t.shortDescription} issues={iss} onChange={(v) => onChange({ ...t, shortDescription: v })} /></td>
                    <td className="px-3 py-2">
                      <button onClick={() => onOpen(lang)} className="group flex w-full items-start gap-1.5 text-left" title="Mở để sửa mô tả đầy đủ">
                        <span className={cx('line-clamp-2 flex-1 text-xs', t.fullDescription ? 'text-muted' : 'text-danger')}>{t.fullDescription || 'Đang trống'}</span>
                        <Maximize2 className="mt-0.5 size-3.5 shrink-0 text-muted group-hover:text-accent" aria-hidden />
                      </button>
                      <span className={cx('num text-[11px]', fullLen > LISTING_MAX.fullDescription ? 'text-danger' : 'text-muted')}>{fullLen}/{LISTING_MAX.fullDescription}</span>
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-3 py-2 text-xs text-muted">{st === 'removed' ? 'Sẽ xóa khỏi Play khi đẩy — mở để khôi phục' : 'Chỉ có ảnh, chưa có text'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 border-t border-border p-2">
        <Plus className="size-4 shrink-0 text-muted" aria-hidden />
        <Select className="w-72" aria-label="Thêm ngôn ngữ" value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
          <option value="">Thêm ngôn ngữ… ({missing.length})</option>
          {missing.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.code}</option>)}
        </Select>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => onOpen(defaultLang)}>Mở chế độ từng ngôn ngữ →</Button>
      </div>
    </Card>
  );
}
