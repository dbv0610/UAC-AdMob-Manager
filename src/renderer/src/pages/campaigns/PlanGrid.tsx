import { useState, type ClipboardEvent, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Film, Languages, Plus, Trash2, Wand2, X } from 'lucide-react';
import { TranslateDialog } from './TranslateDialog';
import { flag, getCountry, LANGUAGES } from '@shared/geo';
import { GOALS, type CountryRow, type Goal } from '@shared/plan';
import { adsLength, counterTone, DESCRIPTION_MAX, HEADLINE_MAX } from '@shared/textLength';
import { useConversionActions, useCreatives } from '@/lib/queries';
import { parseYoutubeIds, videosForCountry } from '@shared/creative';
import { VideoPickerDialog } from '@/pages/creatives/dialogs';
import { toast } from '@/components/toast';
import { Button, Field, Input, Select, cx } from '@/components/ui';

export type RowErrors = Record<number, Record<string, string>>; // dòng → "headlines.1" → message

const num = (s: string) => {
  const v = Number(s.replace(/\s/g, '').replace(',', '.'));
  return s.trim() === '' || !isFinite(v) ? null : v;
};

// Lỗi đầu tiên của một cột (vd cột "headlines" gom mọi lỗi headlines.N)
const colError = (errs: Record<string, string> | undefined, col: string) =>
  errs && Object.entries(errs).find(([k]) => k === col || k.startsWith(`${col}.`))?.[1];

const cellInput = (invalid?: string) =>
  cx(
    'h-7 w-full rounded-sm border bg-transparent px-1.5 text-right text-sm num outline-none focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30',
    invalid ? 'border-danger bg-danger/5' : 'border-transparent hover:border-border',
  );

// ── Bảng cấu hình kiểu spreadsheet ─────────────────────────────────────────
export function PlanGrid({
  rows,
  onRows,
  errors,
  currency,
  customerId,
  appId,
}: {
  rows: CountryRow[];
  onRows: (rows: CountryRow[]) => void;
  errors: RowErrors;
  currency: string;
  customerId: string | null;
  appId: string | null;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [translating, setTranslating] = useState<number[] | null>(null);
  // Bản dịch theo ngôn ngữ → mọi dòng đích có ngôn ngữ chính đó
  const applyTranslations = (targets: number[], byLang: Record<string, { headlines: string[]; descriptions: string[] }>) =>
    patchRows(targets, (r) => byLang[r.languages[0]] ?? {});
  const [focus, setFocus] = useState(0);
  const [bulk, setBulk] = useState<{ budget: string; goal: '' | Goal; target: string }>({ budget: '', goal: '', target: '' });

  const patchRows = (idx: number[], patch: (r: CountryRow) => Partial<CountryRow>) =>
    onRows(rows.map((r, i) => (idx.includes(i) ? ({ ...r, ...patch(r) } as CountryRow) : r)));

  // Dán từ Excel: nhiều dòng → điền xuống; nhiều cột (tab) → ngân sách rồi mục tiêu
  const onPaste = (start: number, col: 'dailyBudget' | 'target') => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').trim().split('\n');
    const cols: ('dailyBudget' | 'target')[] = col === 'dailyBudget' ? ['dailyBudget', 'target'] : ['target'];
    onRows(
      rows.map((r, i) => {
        const line = lines[i - start];
        if (i < start || line == null) return r;
        const cells = line.split('\t');
        const next = { ...r };
        cols.forEach((c, k) => {
          if (cells[k] != null) next[c] = num(cells[k]) as never;
        });
        return next;
      }),
    );
  };

  const target = [...selected].length ? [...selected] : [focus];
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const bulkIdx = [...selected];

  const library = useCreatives().data ?? [];
  const autofillVideos = () => {
    let empty = 0;
    patchRows(bulkIdx, (r) => {
      const ids = videosForCountry(library, r.countryCode);
      if (!ids.length) empty++;
      return ids.length ? { videoIds: ids } : {};
    });
    if (empty) toast({ tone: 'warning', title: `${empty} dòng chưa có video Sẵn sàng trong thư viện`, detail: 'Xem ma trận ở màn Creatives để biết nước nào thiếu' });
  };

  const applyBulk = () => {
    patchRows(bulkIdx, (r) => {
      const goal = bulk.goal || r.goal;
      return {
        ...(num(bulk.budget) != null ? { dailyBudget: num(bulk.budget)! } : {}),
        goal,
        ...(num(bulk.target) != null ? { target: num(bulk.target) } : GOALS[goal].target ? {} : { target: null }),
      };
    });
    setBulk({ budget: '', goal: '', target: '' });
  };

  return (
    <div className="flex min-h-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2" role="toolbar" aria-label="Sửa hàng loạt">
            <span className="self-center text-sm font-medium">
              Sửa <span className="num">{selected.size}</span> dòng:
            </span>
            <Input className="w-32" placeholder={`Ngân sách (${currency})`} value={bulk.budget} onChange={(e) => setBulk({ ...bulk, budget: e.target.value })} aria-label="Ngân sách cho các dòng chọn" />
            <Select className="w-52" value={bulk.goal} onChange={(e) => setBulk({ ...bulk, goal: e.target.value as Goal | '' })} aria-label="Mục tiêu cho các dòng chọn">
              <option value="">Giữ mục tiêu</option>
              {Object.entries(GOALS).map(([k, g]) => (
                <option key={k} value={k}>{g.label}</option>
              ))}
            </Select>
            <Input className="w-28" placeholder="tCPI / tROAS" value={bulk.target} onChange={(e) => setBulk({ ...bulk, target: e.target.value })} aria-label="Target cho các dòng chọn" />
            <Button size="sm" variant="primary" onClick={applyBulk}>Áp dụng</Button>
            <Button size="sm" icon={Languages} onClick={() => setTranslating(bulkIdx)} title="Dịch tiêu đề/mô tả sang ngôn ngữ của từng dòng">
              Dịch text bằng AI
            </Button>
            <Button size="sm" icon={Wand2} onClick={autofillVideos} title="Mỗi dòng lấy video Sẵn sàng gán đúng quốc gia đó + video dùng chung (tối đa 20)">
              Tự điền video từ thư viện
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => {
              onRows(rows.filter((_, i) => !selected.has(i)));
              setSelected(new Set());
              setFocus(0);
            }}>
              Bỏ khỏi kế hoạch
            </Button>
          </div>
        )}

        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-muted">
              <tr className="text-left">
                <th className="h-row w-8 border-b border-border px-2">
                  <input type="checkbox" aria-label="Chọn tất cả dòng" checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((_, i) => i)))} />
                </th>
                <th className="border-b border-border px-2 font-medium">Quốc gia</th>
                <th className="border-b border-border px-2 font-medium">Ngôn ngữ</th>
                <th className="w-32 border-b border-border px-2 text-right font-medium">Ngân sách/ngày</th>
                <th className="w-48 border-b border-border px-2 font-medium">Mục tiêu</th>
                <th className="w-28 border-b border-border px-2 text-right font-medium">tCPI · tROAS</th>
                <th className="border-b border-border px-2 font-medium">Text</th>
                <th className="border-b border-border px-2 font-medium">Video</th>
                <th className="w-10 border-b border-border px-2 font-medium"><span className="sr-only">Trạng thái</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const e = errors[i];
                const nErr = e ? Object.keys(e).length : 0;
                const g = GOALS[r.goal];
                const textErr = colError(e, 'headlines') ?? colError(e, 'descriptions');
                return (
                  <tr key={r.countryCode} onFocus={() => setFocus(i)} onClick={() => setFocus(i)}
                    className={cx('border-b border-border/60', focus === i && selected.size === 0 ? 'bg-accent/5' : selected.has(i) && 'bg-accent/5')}>
                    <td className="px-2">
                      <input type="checkbox" aria-label={`Chọn ${r.countryCode}`} checked={selected.has(i)}
                        onChange={() => {
                          const s = new Set(selected);
                          if (s.has(i)) s.delete(i); else s.add(i);
                          setSelected(s);
                        }} />
                    </td>
                    <td className="px-2 whitespace-nowrap">
                      <span aria-hidden>{flag(r.countryCode)}</span> <span className="font-mono text-xs">{r.countryCode}</span>{' '}
                      <span className="text-muted">{getCountry(r.countryCode)?.name}</span>
                    </td>
                    <td className={cx('px-2 text-xs whitespace-nowrap', colError(e, 'languages') && 'text-danger')} title={colError(e, 'languages')}>
                      {r.languages.join(', ') || '—'}
                    </td>
                    <td className="px-1">
                      <input className={cellInput(colError(e, 'dailyBudget'))} title={colError(e, 'dailyBudget')} aria-label={`Ngân sách ${r.countryCode}`}
                        aria-invalid={!!colError(e, 'dailyBudget') || undefined} inputMode="decimal"
                        value={r.dailyBudget || ''} placeholder={currency}
                        onPaste={onPaste(i, 'dailyBudget')}
                        onChange={(ev) => patchRows([i], () => ({ dailyBudget: num(ev.target.value) ?? 0 }))} />
                    </td>
                    <td className="px-1">
                      <select className={cx(cellInput(colError(e, 'goal')), 'text-left')} value={r.goal} aria-label={`Mục tiêu ${r.countryCode}`}
                        onChange={(ev) => patchRows([i], () => ({ goal: ev.target.value as Goal, ...(GOALS[ev.target.value as Goal].target ? {} : { target: null }) }))}>
                        {Object.entries(GOALS).map(([k, gg]) => (
                          <option key={k} value={k}>{gg.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1">
                      {g.target ? (
                        <input className={cellInput(colError(e, 'target'))} title={colError(e, 'target')} aria-label={`Target ${r.countryCode}`}
                          aria-invalid={!!colError(e, 'target') || undefined} inputMode="decimal"
                          value={r.target ?? ''} placeholder={g.target === 'ratio' ? '1.2 = 120%' : currency}
                          onPaste={onPaste(i, 'target')}
                          onChange={(ev) => patchRows([i], () => ({ target: num(ev.target.value) }))} />
                      ) : (
                        <span className="block text-right text-xs text-muted">không cần</span>
                      )}
                    </td>
                    <td className={cx('px-2 text-xs whitespace-nowrap', textErr ? 'text-danger' : 'text-muted')} title={textErr}>
                      <span className="num">{r.headlines.filter(Boolean).length}</span> tiêu đề · <span className="num">{r.descriptions.filter(Boolean).length}</span> mô tả
                    </td>
                    <td className={cx('px-2 text-xs whitespace-nowrap', colError(e, 'videoIds') ? 'text-danger' : 'text-muted')} title={colError(e, 'videoIds')}>
                      <span className="num">{r.videoIds.length}</span> video
                    </td>
                    <td className="px-2">
                      {nErr ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-danger" title={Object.values(e!).join('\n')}>
                          <AlertCircle className="size-4" aria-hidden /> <span className="num">{nErr}</span>
                          <span className="sr-only">lỗi</span>
                        </span>
                      ) : (
                        <CheckCircle2 className="size-4 text-success" aria-label="Hợp lệ" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Mẹo: dán một cột (hoặc 2 cột ngân sách + target) từ Excel vào ô ngân sách để điền xuống nhiều dòng. Chọn nhiều dòng để sửa hàng loạt; panel bên phải sửa text/video cho dòng đang chọn.
        </p>
      </div>

      {rows.length > 0 && (
        <RowPanel
          key={target.join(',')}
          rows={target.map((i) => rows[i]).filter(Boolean)}
          errors={errors[target[0]]}
          customerId={customerId}
          onPatch={(patch) => patchRows(target, () => patch)}
          onTranslate={() => setTranslating(target)}
        />
      )}
      {translating && (
        <TranslateDialog rows={rows} targets={translating} appId={appId}
          onApply={(byLang) => applyTranslations(translating, byLang)} onClose={() => setTranslating(null)} />
      )}
    </div>
  );
}

// ── Panel chi tiết: ngôn ngữ, conversion, text, video cho 1 hoặc nhiều dòng ──
function RowPanel({
  rows,
  errors,
  customerId,
  onPatch,
  onTranslate,
}: {
  rows: CountryRow[];
  errors?: Record<string, string>;
  customerId: string | null;
  onPatch: (p: Partial<CountryRow>) => void;
  onTranslate: () => void;
}) {
  const r = rows[0];
  const many = rows.length > 1;
  const conv = useConversionActions(GOALS[r.goal].conversions ? customerId : null);
  const [videoText, setVideoText] = useState(r.videoIds.join('\n'));
  const [picking, setPicking] = useState(false);
  const library = useCreatives().data ?? [];
  const known = new Map(library.filter((c) => c.youtubeId).map((c) => [c.youtubeId!, c]));
  const notReady = r.videoIds.filter((id) => known.has(id) && known.get(id)!.status !== 'READY');
  const setVideos = (ids: string[]) => {
    setVideoText(ids.join('\n'));
    onPatch({ videoIds: ids });
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-4" aria-label="Chi tiết dòng">
      <div>
        <p className="text-sm font-semibold">
          {many ? (
            <>Áp cho <span className="num">{rows.length}</span> dòng đã chọn</>
          ) : (
            <><span aria-hidden>{flag(r.countryCode)}</span> {getCountry(r.countryCode)?.name}</>
          )}
        </p>
        {many && <p className="text-xs text-muted">Đang hiện giá trị của {r.countryCode}; sửa sẽ ghi đè cho mọi dòng chọn.</p>}
      </div>

      <Field label="Ngôn ngữ" error={colError(errors, 'languages')}>
        <div className="flex flex-wrap gap-1">
          {r.languages.map((l) => (
            <span key={l} className="inline-flex items-center gap-1 rounded-sm bg-surface-2 py-0.5 pr-0.5 pl-1.5 text-xs">
              {LANGUAGES.find((x) => x.code === l)?.name ?? l}
              <button className="rounded-sm p-0.5 hover:bg-border" aria-label={`Bỏ ${l}`} onClick={() => onPatch({ languages: r.languages.filter((x) => x !== l) })}>
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <select className="h-6 rounded-sm border border-border bg-surface px-1 text-xs" value="" aria-label="Thêm ngôn ngữ"
            onChange={(e) => e.target.value && onPatch({ languages: [...r.languages, e.target.value] })}>
            <option value="">+ Thêm</option>
            {LANGUAGES.filter((l) => !r.languages.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
      </Field>

      {GOALS[r.goal].conversions && (
        <Field label="Conversion action" error={colError(errors, 'conversionActions')}
          hint={conv.isError ? 'Không đọc được danh sách — nhập ID cách nhau bởi dấu phẩy' : undefined}>
          {conv.data?.length ? (
            <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto rounded-sm border border-border p-1.5">
              {conv.data.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={r.conversionActions.includes(c.id)}
                    onChange={(e) => onPatch({ conversionActions: e.target.checked ? [...r.conversionActions, c.id] : r.conversionActions.filter((x) => x !== c.id) })} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-muted">{c.category}</span>
                </label>
              ))}
            </div>
          ) : (
            <Input value={r.conversionActions.join(', ')} placeholder="123456789, …"
              onChange={(e) => onPatch({ conversionActions: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
          )}
        </Field>
      )}

      <Button size="sm" icon={Languages} className="self-start" onClick={onTranslate} title="Dịch từ dòng có sẵn text (thường là tiếng Anh) sang ngôn ngữ của dòng này">
        Dịch text bằng AI
      </Button>
      <TextList label="Tiêu đề" max={HEADLINE_MAX} items={r.headlines} errors={errors} field="headlines" onChange={(headlines) => onPatch({ headlines })} />
      <TextList label="Mô tả" max={DESCRIPTION_MAX} items={r.descriptions} errors={errors} field="descriptions" onChange={(descriptions) => onPatch({ descriptions })} multiline />

      <Field label="Video YouTube (mỗi dòng 1 ID hoặc link)" error={colError(errors, 'videoIds')}
        hint={`${r.videoIds.length}/20 video · asset tạo một lần, dùng chung cho mọi quốc gia`}>
        <textarea
          className="min-h-20 w-full rounded-sm border border-border bg-surface p-2 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          value={videoText}
          onChange={(e) => {
            setVideoText(e.target.value);
            onPatch({ videoIds: parseVideoIds(e.target.value) });
          }}
          placeholder="https://youtu.be/dQw4w9WgXcQ"
        />
      </Field>
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Film} onClick={() => setPicking(true)}>Chọn từ thư viện</Button>
        {!many && (
          <Button size="sm" variant="ghost" icon={Wand2} onClick={() => {
            const ids = videosForCountry(library, r.countryCode);
            if (ids.length) setVideos(ids);
            else toast({ tone: 'warning', title: `Chưa có video Sẵn sàng cho ${r.countryCode}` });
          }}>Tự điền</Button>
        )}
      </div>
      {notReady.length > 0 && (
        <p className="-mt-2 flex items-center gap-1 text-xs text-warning"><AlertCircle className="size-3.5 shrink-0" aria-hidden /> {notReady.length} video chưa Sẵn sàng (đang xử lý / bị khóa) — Google có thể từ chối</p>
      )}
      {picking && (
        <VideoPickerDialog library={library} country={many ? null : r.countryCode} value={r.videoIds} onChange={setVideos} onClose={() => setPicking(false)} />
      )}
    </aside>
  );
}

// Giữ cả chuỗi chưa hợp lệ để Google báo lỗi đúng ô (videoIds.N)
export function parseVideoIds(text: string) {
  const parts = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => parseYoutubeIds(p).ids[0] ?? p);
}

function TextList({
  label,
  max,
  items,
  errors,
  field,
  onChange,
  multiline,
}: {
  label: string;
  max: number;
  items: string[];
  errors?: Record<string, string>;
  field: string;
  onChange: (v: string[]) => void;
  multiline?: boolean;
}): ReactNode {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-medium text-muted">
        {label} <span className="num">({items.length}/5)</span>
      </legend>
      {items.map((t, k) => {
        const len = adsLength(t);
        const tone = counterTone(len, max);
        const err = errors?.[`${field}.${k}`];
        const Tag = multiline ? 'textarea' : 'input';
        return (
          <div key={k} className="flex flex-col gap-0.5">
            <div className="flex items-start gap-1">
              <Tag
                className={cx(
                  'w-full rounded-sm border bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
                  multiline ? 'min-h-14 py-1.5' : 'h-8',
                  err ? 'border-danger' : 'border-border',
                )}
                aria-label={`${label} ${k + 1}`}
                aria-invalid={!!err || undefined}
                value={t}
                onChange={(e) => onChange(items.map((x, j) => (j === k ? e.target.value : x)))}
              />
              <Button size="sm" variant="ghost" icon={X} aria-label={`Xóa ${label.toLowerCase()} ${k + 1}`} disabled={items.length === 1}
                onClick={() => onChange(items.filter((_, j) => j !== k))} />
            </div>
            <div className="flex justify-between pr-9 text-xs">
              <span className="text-danger">{err && err !== `Dài ${len}/${max}` ? err : ''}</span>
              <span className={cx('num', tone === 'danger' ? 'font-medium text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>
                {len}/{max}
              </span>
            </div>
          </div>
        );
      })}
      {items.length < 5 && (
        <Button size="sm" variant="ghost" icon={Plus} className="self-start" onClick={() => onChange([...items, ''])}>
          Thêm {label.toLowerCase()}
        </Button>
      )}
    </fieldset>
  );
}
