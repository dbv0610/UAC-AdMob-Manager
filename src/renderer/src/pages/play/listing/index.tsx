import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FileUp, Globe, Images, Plus, RefreshCw, Upload } from 'lucide-react';
import { PLAY_LANGUAGES, checkListing, diffListings, languageName, type ImageSet, type ListingText } from '@shared/listing';
import { api, parseError } from '@/lib/api';
import { useUi } from '@/lib/store';
import { qk } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Select, Skeleton, StatusBadge, cx, type Tone } from '@/components/ui';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { LanguageEditor } from './LanguageEditor';
import { PushDialog } from './PushDialog';
import { ListingTable, ROW_BADGE, type RowState } from './ListingTable';
import { Segmented } from '@/components/kit';

const BLANK = (language: string): ListingText => ({ language, title: '', shortDescription: '', fullDescription: '', video: '' });


// Tab Store listing: bản nháp theo từng ngôn ngữ, đẩy lên Play trong một edit.
export function ListingTab({ accountId, pkg }: { accountId: string; pkg: string }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const onError = useErrorHandler();
  const q = useQuery({ queryKey: qk.playListing(accountId, pkg), queryFn: () => api.play.pull(accountId, pkg), staleTime: Infinity });
  const [draft, setDraft] = useState<ListingText[] | null>(null);
  const [staged, setStaged] = useState<ImageSet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ tone: Tone; lines: string[] } | null>(null);
  const [busy, setBusy] = useState<'import' | 'export' | 'images' | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [view, setView] = useState<'table' | 'language'>('table');

  // Mỗi lần tải từ Play: bản nháp = dữ liệu thật
  useEffect(() => {
    if (!q.data) return;
    setDraft(q.data.listings);
    setSelected((s) => s ?? q.data.defaultLanguage);
  }, [q.data]);

  const original = useMemo(() => q.data?.listings ?? [], [q.data]);
  const texts = useMemo(() => draft ?? original, [draft, original]);
  const defaultLang = q.data?.defaultLanguage ?? 'en-US';
  const diff = useMemo(() => diffListings(original, texts), [original, texts]);
  const issues = useMemo(() => new Map(texts.map((t) => [t.language, checkListing(t)])), [texts]);

  const pushing = [...diff.added, ...diff.changed];
  const textErrors = pushing.filter((l) => issues.get(l)!.some((i) => i.level === 'error'));
  const orphanImages = staged.filter((s) => !texts.some((t) => t.language === s.language));
  const badImages = staged.filter((s) => s.files.some((f) => f.issues.length));
  const dirty = pushing.length + diff.removed.length + staged.length > 0;
  const blocked = textErrors.length + orphanImages.length + badImages.length > 0;

  const stateOf = (lang: string): RowState =>
    diff.removed.includes(lang) ? 'removed' : diff.added.includes(lang) ? 'added' : diff.changed.includes(lang) ? 'changed' : 'same';
  const rows = [...new Set([...original, ...texts].map((t) => t.language).concat(staged.map((s) => s.language)))].sort((a, b) =>
    a === defaultLang ? -1 : b === defaultLang ? 1 : a.localeCompare(b),
  );
  const missing = PLAY_LANGUAGES.filter((l) => !texts.some((t) => t.language === l.code));

  const update = (t: ListingText) => setDraft(texts.map((x) => (x.language === t.language ? t : x)));
  const addLanguage = (code: string) => {
    setDraft([...texts, BLANK(code)]);
    setSelected(code);
  };
  const removeLanguage = (code: string) => {
    setDraft(texts.filter((t) => t.language !== code));
    setStaged(staged.filter((s) => s.language !== code));
  };
  const restore = (code: string) => {
    const o = original.find((t) => t.language === code);
    if (!o) return removeLanguage(code);
    setDraft(texts.some((t) => t.language === code) ? texts.map((t) => (t.language === code ? o : t)) : [...texts, o]);
  };

  const reload = () => {
    if (dirty && !window.confirm('Bỏ mọi sửa đổi chưa đẩy và tải lại từ Play?')) return;
    setStaged([]);
    setNotes(null);
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ['play', 'images', accountId, pkg] });
  };

  const importXlsx = async () => {
    setBusy('import');
    try {
      const res = await api.play.importXlsx();
      if (!res) return;
      const next = new Map(texts.map((t) => [t.language, t]));
      let added = 0;
      for (const t of res.texts) {
        if (!next.has(t.language)) added++;
        next.set(t.language, t);
      }
      setDraft([...next.values()]);
      setNotes(res.errors.length ? { tone: 'warning', lines: res.errors } : null);
      toast({ tone: res.texts.length ? 'success' : 'warning', title: `Đã nhập ${res.texts.length} ngôn ngữ (${added} mới)`, detail: res.errors.length ? `${res.errors.length} dòng bị bỏ qua` : res.file });
    } catch (err) {
      onError(err, () => void importXlsx());
    } finally {
      setBusy(null);
    }
  };

  const exportXlsx = async () => {
    setBusy('export');
    try {
      const p = await api.play.exportXlsx(pkg, texts);
      if (p) toast({ tone: 'success', title: 'Đã xuất file Excel', detail: p, action: { label: 'Mở thư mục', run: () => void api.play.revealExport(p) } });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const pickImages = async () => {
    setBusy('images');
    try {
      const res = await api.play.pickImages();
      if (!res) return;
      setStaged(res.sets);
      const files = res.sets.reduce((n, s) => n + s.files.length, 0);
      setNotes(res.skipped.length ? { tone: 'info', lines: [`Bỏ qua ${res.skipped.length} ảnh không đúng cấu trúc <ngôn ngữ>/<loại>/: ${res.skipped.slice(0, 5).join(', ')}${res.skipped.length > 5 ? '…' : ''}`] } : null);
      toast({ tone: files ? 'success' : 'warning', title: `Đã chọn ${files} ảnh · ${new Set(res.sets.map((s) => s.language)).size} ngôn ngữ`, detail: res.root });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const push = async (sendForReview: boolean) => {
    try {
      const res = await api.play.push({
        accountId,
        packageName: pkg,
        upsert: texts.filter((t) => pushing.includes(t.language)),
        remove: diff.removed,
        images: staged.map((s) => ({ language: s.language, type: s.type, paths: s.files.map((f) => f.path) })),
        sendForReview,
      });
      toast({
        tone: 'success',
        title: `Đã đẩy lên Play: ${res.languages} ngôn ngữ${res.removed ? `, xóa ${res.removed}` : ''}${res.images ? `, ${res.images} ảnh` : ''}`,
        detail: res.sentForReview ? 'Đã gửi duyệt — thường vài giờ đến vài ngày' : 'Chưa gửi duyệt: vào Play Console → Tổng quan về việc xuất bản để gửi',
      });
      setPushOpen(false);
      setStaged([]);
      void q.refetch();
      void qc.invalidateQueries({ queryKey: ['play', 'images', accountId, pkg] });
    } catch (err) {
      onError(err, () => void push(sendForReview));
    }
  };

  const sel = selected && rows.includes(selected) ? selected : (rows[0] ?? null);
  const selText = texts.find((t) => t.language === sel) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={RefreshCw} loading={q.isFetching} onClick={reload} title={q.data ? `Tải lúc ${fmtDateTime(q.data.fetchedAt)}` : undefined}>Tải lại từ Play</Button>
        <Button icon={FileUp} loading={busy === 'import'} disabled={!q.data} onClick={importXlsx} title="Cột: language, title, shortDescription, fullDescription, video">Nhập Excel</Button>
        <Button icon={FileDown} loading={busy === 'export'} disabled={!q.data} onClick={exportXlsx}>Xuất Excel</Button>
        <Button icon={Images} loading={busy === 'images'} disabled={!q.data} onClick={pickImages} title="Thư mục dạng ja-JP/phoneScreenshots/01.png, ja-JP/icon.png">Chọn thư mục ảnh</Button>
        <Segmented label="Kiểu xem" value={view} onChange={(v) => setView(v as 'table' | 'language')} options={[['table', 'Bảng mọi ngôn ngữ'], ['language', 'Từng ngôn ngữ']]} />
        <span className="flex-1" />
        <Button variant="primary" icon={Upload} disabled={!dirty || blocked || !online} onClick={() => setPushOpen(true)}
          title={!online ? 'Đang mất mạng' : blocked ? 'Sửa các lỗi đỏ trước khi đẩy' : undefined}>
          Đẩy lên Play{dirty ? ` (${pushing.length + diff.removed.length} ngôn ngữ${staged.length ? ` · ${staged.length} nhóm ảnh` : ''})` : ''}
        </Button>
      </div>

      {notes && (
        <Card className="overflow-hidden">
          <Banner tone={notes.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotes(null)}>Ẩn</Button>}>
            <ul className="list-disc pl-4">{notes.lines.slice(0, 10).map((l) => <li key={l}>{l}</li>)}</ul>
            {notes.lines.length > 10 && <p className="text-muted">…và {notes.lines.length - 10} dòng khác</p>}
          </Banner>
        </Card>
      )}
      {orphanImages.length > 0 && (
        <Card className="overflow-hidden">
          <Banner tone="danger">Có ảnh cho ngôn ngữ chưa có text: {orphanImages.map((s) => s.language).filter((v, i, a) => a.indexOf(v) === i).join(', ')} — thêm ngôn ngữ đó hoặc bỏ thư mục ảnh.</Banner>
        </Card>
      )}

      {q.isLoading ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <Card className="overflow-hidden">
          <Banner tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>{parseError(q.error).message}</Banner>
        </Card>
      ) : view === 'table' ? (
        <ListingTable
          rows={rows}
          texts={texts}
          defaultLang={defaultLang}
          issues={issues}
          stateOf={stateOf}
          staged={staged}
          missing={missing}
          onChange={update}
          onAdd={addLanguage}
          onOpen={(lang) => {
            setSelected(lang);
            setView('language');
          }}
        />
      ) : (
        <div className="grid grid-cols-[260px_1fr] items-start gap-4">
          <Card className="flex flex-col overflow-hidden">
            <ul className="max-h-[calc(100vh-300px)] divide-y divide-border overflow-y-auto">
              {rows.map((lang) => {
                const st = stateOf(lang);
                const errs = (issues.get(lang) ?? []).filter((i) => i.level === 'error').length;
                const imgs = staged.filter((s) => s.language === lang).reduce((n, s) => n + s.files.length, 0);
                return (
                  <li key={lang}>
                    <button onClick={() => setSelected(lang)} aria-current={sel === lang || undefined}
                      className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', sel === lang ? 'bg-accent/10' : 'hover:bg-surface-2')}>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block truncate font-medium', st === 'removed' && 'text-muted line-through')}>{languageName(lang)}</span>
                        <span className="font-mono text-xs text-muted">{lang}{lang === defaultLang && ' · mặc định'}{imgs > 0 && ` · ${imgs} ảnh`}</span>
                      </span>
                      {errs > 0 && st !== 'removed' && <StatusBadge tone="danger">{errs}</StatusBadge>}
                      {st !== 'same' && <StatusBadge tone={ROW_BADGE[st][0]}>{ROW_BADGE[st][1]}</StatusBadge>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-1.5 border-t border-border p-2">
              <Plus className="size-4 shrink-0 text-muted" aria-hidden />
              <Select aria-label="Thêm ngôn ngữ" value="" onChange={(e) => e.target.value && addLanguage(e.target.value)}>
                <option value="">Thêm ngôn ngữ… ({missing.length})</option>
                {missing.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.code}</option>)}
              </Select>
            </div>
          </Card>

          {sel ? (
            <LanguageEditor
              key={sel}
              accountId={accountId}
              pkg={pkg}
              language={sel}
              text={selText}
              reference={sel !== defaultLang ? (texts.find((t) => t.language === defaultLang) ?? null) : null}
              onPlay={original.some((t) => t.language === sel)}
              state={stateOf(sel)}
              isDefault={sel === defaultLang}
              issues={issues.get(sel) ?? []}
              staged={staged.filter((s) => s.language === sel)}
              onChange={update}
              onRemove={() => removeLanguage(sel)}
              onRestore={() => restore(sel)}
              onUnstage={(type) => setStaged(staged.filter((s) => !(s.language === sel && s.type === type)))}
            />
          ) : (
            <EmptyState icon={Globe} title="Chưa có ngôn ngữ nào">Thêm ngôn ngữ ở cột bên trái hoặc nhập file Excel.</EmptyState>
          )}
        </div>
      )}

      {pushOpen && <PushDialog diff={diff} texts={texts} issues={issues} staged={staged} pkg={pkg} onClose={() => setPushOpen(false)} onConfirm={push} />}
    </div>
  );
}
