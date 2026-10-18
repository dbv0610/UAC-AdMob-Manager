import { useQuery } from '@tanstack/react-query';
import { ImageOff, RotateCcw, Trash2, X } from 'lucide-react';
import { FIELD_LABEL, IMAGE_SPEC, IMAGE_TYPES, LISTING_MAX, languageName, playLength, type ImageSet, type ImageType, type ListingField, type ListingIssue, type ListingText } from '@shared/listing';
import { counterTone } from '@shared/textLength';
import { api, parseError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { Button, Card, Field, Input, Skeleton, StatusBadge, cx } from '@/components/ui';

const fmtKb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function TextField({ field, value, issues, onChange, reference }: { field: ListingField; value: string; issues: ListingIssue[]; onChange: (v: string) => void; reference?: { lang: string; text: string } }) {
  const len = playLength(value);
  const max = LISTING_MAX[field];
  const tone = counterTone(len, max);
  const mine = issues.filter((i) => i.field === field);
  const err = mine.find((i) => i.level === 'error');
  const id = `listing-${field}`;
  const cls = cx(
    'w-full rounded-sm border bg-surface px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
    err ? 'border-danger' : 'border-border',
  );
  return (
    <Field label={FIELD_LABEL[field]} htmlFor={id}>
      {field === 'fullDescription' ? (
        <textarea id={id} className={cx(cls, 'min-h-72 py-2 leading-relaxed')} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!err || undefined} />
      ) : (
        <input id={id} className={cx(cls, 'h-8')} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!err || undefined} />
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cx('num', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>{len}/{max}</span>
        {mine.filter((i) => !i.message.startsWith('Dài')).map((i) => (
          <span key={i.message} className={i.level === 'error' ? 'text-danger' : 'text-warning'}>{i.level === 'error' ? '✕' : '⚠'} {i.message}</span>
        ))}
      </div>
      {reference && (
        <details className="rounded-sm bg-surface-2/60 px-2 py-1 text-xs text-muted" open={field !== 'fullDescription'}>
          <summary className="cursor-pointer select-none">Bản {reference.lang} (mặc định)</summary>
          <p className="mt-1 whitespace-pre-wrap" data-selectable>{reference.text || '—'}</p>
        </details>
      )}
    </Field>
  );
}

export function LanguageEditor({ accountId, pkg, language, text, reference, onPlay, state, isDefault, issues, staged, onChange, onRemove, onRestore, onUnstage }: {
  accountId: string;
  pkg: string;
  language: string;
  text: ListingText | null; // null = đã đánh dấu xóa
  reference: ListingText | null; // bản ngôn ngữ mặc định để đối chiếu khi dịch
  onPlay: boolean; // ngôn ngữ đang có trên Play
  state: 'added' | 'changed' | 'removed' | 'same';
  isDefault: boolean;
  issues: ListingIssue[];
  staged: ImageSet[];
  onChange: (t: ListingText) => void;
  onRemove: () => void;
  onRestore: () => void;
  onUnstage: (type: ImageType) => void;
}) {
  const imagesQ = useQuery({
    queryKey: qk.playImages(accountId, pkg, language),
    queryFn: () => api.play.images(accountId, pkg, language),
    enabled: onPlay && !!text,
    staleTime: Infinity,
  });
  const set = (k: keyof ListingText, v: string) => text && onChange({ ...text, [k]: v });
  const videoIssue = issues.find((i) => i.field === 'video');

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{languageName(language)}</h2>
        <span className="font-mono text-sm text-muted">{language}</span>
        {isDefault && <StatusBadge tone="info">Ngôn ngữ mặc định</StatusBadge>}
        <span className="flex-1" />
        {(state === 'changed' || state === 'removed') && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRestore}>Khôi phục bản trên Play</Button>}
        {text && (
          <Button size="sm" variant="ghost" icon={Trash2} disabled={isDefault} onClick={onRemove}
            title={isDefault ? 'Không xóa được ngôn ngữ mặc định — đổi mặc định trên Play Console trước' : state === 'added' ? 'Bỏ ngôn ngữ vừa thêm' : 'Xóa bản dịch này khỏi Play khi đẩy'}>
            {state === 'added' ? 'Bỏ' : 'Xóa ngôn ngữ'}
          </Button>
        )}
      </div>

      {!text ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm">Bản dịch này sẽ bị <b>xóa khỏi Play</b> (cả ảnh riêng của ngôn ngữ) khi đẩy. Bấm Khôi phục nếu đổi ý.</p>
      ) : (
        <>
          <TextField field="title" value={text.title} issues={issues} onChange={(v) => set('title', v)} reference={reference ? { lang: reference.language, text: reference.title } : undefined} />
          <TextField field="shortDescription" value={text.shortDescription} issues={issues} onChange={(v) => set('shortDescription', v)} reference={reference ? { lang: reference.language, text: reference.shortDescription } : undefined} />
          <TextField field="fullDescription" value={text.fullDescription} issues={issues} onChange={(v) => set('fullDescription', v)} reference={reference ? { lang: reference.language, text: reference.fullDescription } : undefined} />
          <Field label={FIELD_LABEL.video} htmlFor="listing-video" error={videoIssue?.message} hint="Không bắt buộc. Để trống = không có video.">
            <Input id="listing-video" value={text.video} invalid={!!videoIssue} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => set('video', e.target.value)} />
          </Field>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Hình ảnh</h3>
            {!onPlay && !staged.length && <p className="text-sm text-muted">Ngôn ngữ mới: chưa có ảnh riêng — Play dùng ảnh của ngôn ngữ mặc định. Chọn thư mục ảnh để thêm.</p>}
            {imagesQ.isError && <p className="text-sm text-danger">{parseError(imagesQ.error).message}</p>}
            {IMAGE_TYPES.map((type) => {
              const remote = imagesQ.data?.[type] ?? [];
              const local = staged.find((s) => s.type === type);
              if (!remote.length && !local) return null;
              return (
                <div key={type} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{IMAGE_SPEC[type].label}</span>
                    {local && <StatusBadge tone="warning">Sẽ thay bằng {local.files.length} ảnh mới</StatusBadge>}
                    {local && <Button size="sm" variant="ghost" icon={X} onClick={() => onUnstage(type)}>Bỏ</Button>}
                  </div>
                  {remote.length > 0 && (
                    <div className={cx('flex gap-2 overflow-x-auto pb-1', local && 'opacity-40')}>
                      {remote.map((img) => (
                        <img key={img.id} src={`${img.url}=h160`} alt="" loading="lazy" className="h-20 shrink-0 rounded-sm border border-border bg-surface-2 object-contain" />
                      ))}
                    </div>
                  )}
                  {local && (
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {local.files.map((f) => (
                        <li key={f.path} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono" data-selectable>{f.name}</span>
                          <span className="num text-muted">{f.width}×{f.height} · {fmtKb(f.sizeBytes)}</span>
                          {f.issues.map((x) => <span key={x} className="text-danger">✕ {x}</span>)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {imagesQ.isLoading && <Skeleton className="h-20" />}
            {onPlay && imagesQ.isSuccess && !Object.keys(imagesQ.data).length && !staged.length && (
              <p className="flex items-center gap-1.5 text-sm text-muted"><ImageOff className="size-4" aria-hidden /> Chưa có ảnh riêng cho ngôn ngữ này.</p>
            )}
          </section>
        </>
      )}
    </Card>
  );
}
