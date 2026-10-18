import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon, Ban, CheckCircle2, CloudUpload, Film, FolderOpen, FolderPlus, Globe2, HardDrive, Link2, Loader, MapPin, Megaphone, Pause, Plus, Search, Trash2, CirclePlay } from 'lucide-react';
import { ASPECTS, ASPECT_LABEL, isUsable, type Aspect, type Creative } from '@shared/creative';
import { COUNTRIES, flag } from '@shared/geo';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { useCreatives } from '@/lib/queries';
import { Banner, Button, Card, EmptyState, Input, Select, SeverityPills, Skeleton, StatusBadge, cx } from '@/components/ui';
import { SummaryCard, flagCounts } from '@/components/kit';
import { creativeFlags } from '@shared/health';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { AttachDialog, CountriesDialog, ManualIdsDialog, UploadDialog } from './dialogs';
import { CreativeStatusBadge, STATUS_GROUP, Thumb, applyFilter, aspectLabel, fmtBytes, fmtDuration, isDefaultFilter, loadFilter, saveFilter, type LibFilter } from './shared';
import { CreativeDrawer } from './CreativeDrawer';

type DialogKind = 'upload' | 'countries' | 'manual' | 'attach' | 'remove' | null;

export function useImport() {
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const onError = useErrorHandler();
  const [busy, setBusy] = useState(false);
  const report = (r: { added: number; duplicates: number; skipped: string[] } | null) => {
    if (!r) return;
    const detail = [r.duplicates && `${r.duplicates} file trùng (đã có, dùng lại)`, r.skipped.length && `${r.skipped.length} file bỏ qua (không phải video/ảnh hoặc đọc lỗi)`].filter(Boolean).join(' · ');
    toast({ tone: r.added ? 'success' : 'info', title: r.added ? `Đã nhập ${r.added} creative` : 'Không có creative mới', detail: detail || undefined });
  };
  const run = async (fn: () => Promise<{ added: number; duplicates: number; skipped: string[] } | null>) => {
    setBusy(true);
    try {
      report(await fn());
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    pick: (mode: 'files' | 'folder') => run(() => api.creatives.pick(mode, appId)),
    paths: (paths: string[]) => run(() => api.creatives.importPaths({ paths, appId })),
  };
}

export function Library() {
  const q = useCreatives();
  const prefs = useUi((s) => s.prefs)!;
  const pct = useUi((s) => s.uploadPct);
  const online = useUi((s) => s.online);
  const imp = useImport();
  const onError = useErrorHandler();

  const [filter, setFilterState] = useState(loadFilter);
  const setFilter = (f: Partial<LibFilter>) => {
    const next = { ...filter, ...f };
    setFilterState(next);
    saveFilter(next);
  };
  const all = q.data ?? [];
  const list = useMemo(
    () => applyFilter(all, filter, prefs.currentAppId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [all, filter, prefs.currentAppId],
  );

  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = all.filter((c) => sel.has(c.id));

  // Bỏ id đã bị xóa khỏi thư viện
  useEffect(() => {
    if ([...sel].some((id) => !all.some((c) => c.id === id))) setSel(new Set([...sel].filter((id) => all.some((c) => c.id === id))));
  }, [all, sel]);

  // Esc bỏ chọn, Ctrl/⌘ A chọn hết danh sách đang lọc
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (dialog || openId || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') setSel(new Set());
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSel(new Set(list.map((c) => c.id)));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [list, dialog, openId]);

  // Bấm thẻ = xem chi tiết; ô tick, ⌘/Ctrl hoặc Shift + bấm = chọn (đang chọn thì bấm tiếp cũng là chọn)
  const activate = (i: number, e: React.MouseEvent | React.KeyboardEvent, viaCheckbox = false) => {
    if (viaCheckbox || e.shiftKey || e.metaKey || e.ctrlKey || sel.size > 0) return click(i, e);
    setOpenId(list[i].id);
  };
  const click = (i: number, e: React.MouseEvent | React.KeyboardEvent) => {
    const id = list[i].id;
    const next = new Set(sel);
    if (e.shiftKey && anchor.current != null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      for (let k = a; k <= b; k++) next.add(list[k].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = i;
    setSel(next);
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ tone: 'success', title: ok });
    } catch (err) {
      onError(err);
    }
  };

  const ids = selected.map((c) => c.id);
  const uploadable = selected.filter((c) => c.kind === 'video' && c.source === 'file' && ['LOCAL', 'FAILED', 'PAUSED'].includes(c.status));
  const pausable = selected.filter((c) => c.status === 'QUEUED' || c.status === 'UPLOADING');
  const cancellable = selected.filter((c) => c.source === 'file' && ['QUEUED', 'UPLOADING', 'PAUSED', 'FAILED'].includes(c.status));
  const usable = selected.filter(isUsable);
  const usedCountries = [...new Set(all.flatMap((c) => c.countries))].sort();

  const scoped = applyFilter(all, { ...filter, status: 'all', q: '', aspect: 'all', country: '' }, prefs.currentAppId);
  const countOf = (g: LibFilter['status']) => scoped.filter((c) => !STATUS_GROUP[g] || STATUS_GROUP[g]!.includes(c.status)).length;
  const toggleStatus = (g: LibFilter['status']) => setFilter({ status: filter.status === g ? 'all' : g });
  const openIdx = openId ? list.findIndex((c) => c.id === openId) : -1;
  const openC = openIdx >= 0 ? list[openIdx] : null;

  return (
    <div className="flex flex-col gap-3">
      {scoped.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <SummaryCard icon={Film} label="Tất cả" value={scoped.length} sub={`${scoped.filter((c) => c.kind === 'video').length} video`} onClick={() => setFilter({ status: 'all' })} active={filter.status === 'all'} />
          <SummaryCard icon={CheckCircle2} tone="success" label="Sẵn sàng" value={countOf('ready')} sub={`${scoped.filter((c) => c.status === 'READY' && c.linkedCustomers > 0).length} đã gắn camp`} onClick={() => toggleStatus('ready')} active={filter.status === 'ready'} />
          <SummaryCard icon={HardDrive} tone="info" label="Chưa upload" value={countOf('local')} sub="trên máy" onClick={() => toggleStatus('local')} active={filter.status === 'local'} />
          <SummaryCard icon={Loader} tone="accent-2" label="Đang upload / xử lý" value={countOf('active')} sub="YouTube / Google Ads" onClick={() => toggleStatus('active')} active={filter.status === 'active'} />
          <SummaryCard icon={AlertOctagon} tone={countOf('problem') ? 'danger' : 'success'} label="Lỗi / bị khóa" value={countOf('problem')} sub={countOf('problem') ? 'bấm để xem' : 'không có'} onClick={() => toggleStatus('problem')} active={filter.status === 'problem'} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Tìm tên file, ID YouTube…" value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} aria-label="Tìm creative" />
        </div>
        <Select className="w-32" value={filter.aspect} onChange={(e) => setFilter({ aspect: e.target.value as LibFilter['aspect'] })} aria-label="Lọc tỉ lệ">
          <option value="all">Mọi tỉ lệ</option>
          {ASPECTS.map((a) => <option key={a} value={a}>{ASPECT_LABEL[a]}</option>)}
        </Select>
        <Select className="w-40" value={filter.country} onChange={(e) => setFilter({ country: e.target.value })} aria-label="Lọc quốc gia">
          <option value="">Mọi quốc gia</option>
          <option value="*">Dùng chung</option>
          {usedCountries.map((c) => <option key={c} value={c}>{flag(c)} {COUNTRIES.find((x) => x.code === c)?.name ?? c}</option>)}
        </Select>
        {prefs.currentAppId && (
          <Select className="w-44" value={filter.scope} onChange={(e) => setFilter({ scope: e.target.value as LibFilter['scope'] })} aria-label="Phạm vi app">
            <option value="app">App đang chọn</option>
            <option value="all">Mọi app</option>
          </Select>
        )}
        <div className="flex-1" />
        <Button icon={Link2} onClick={() => setDialog('manual')}>Nhập ID YouTube</Button>
        <Button icon={FolderPlus} loading={imp.busy} onClick={() => void imp.pick('folder')}>Thêm thư mục</Button>
        <Button variant="primary" icon={Plus} loading={imp.busy} onClick={() => void imp.pick('files')}>Thêm file</Button>
      </div>

      {selected.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm" role="toolbar" aria-label="Thao tác với creative đã chọn">
          <span className="font-medium">Đã chọn <span className="num">{selected.length}</span></span>
          <span className="h-5 w-px bg-border" aria-hidden />
          <Button size="sm" variant="primary" icon={CloudUpload} disabled={!uploadable.length || !online} onClick={() => setDialog('upload')}>
            Upload video{uploadable.length ? ` (${uploadable.length})` : ''}
          </Button>
          {pausable.length > 0 && <Button size="sm" icon={Pause} onClick={() => void act(() => api.creatives.pause(pausable.map((c) => c.id)), `Đã tạm dừng ${pausable.length} video`)}>Tạm dừng</Button>}
          {cancellable.length > 0 && <Button size="sm" icon={Ban} onClick={() => void act(() => api.creatives.cancel(cancellable.map((c) => c.id)), `Đã hủy upload ${cancellable.length} video`)}>Hủy upload</Button>}
          <Button size="sm" icon={MapPin} onClick={() => setDialog('countries')}>Gán quốc gia</Button>
          <Select className="h-7 w-32" value="" aria-label="Đặt tỉ lệ khung hình"
            onChange={(e) => e.target.value && void act(() => api.creatives.patch({ ids, aspect: e.target.value as Aspect }), 'Đã đặt tỉ lệ')}>
            <option value="">Đặt tỉ lệ…</option>
            {ASPECTS.map((a) => <option key={a} value={a}>{ASPECT_LABEL[a]}</option>)}
          </Select>
          <Button size="sm" icon={Megaphone} disabled={!usable.length || !online} title={usable.length ? undefined : 'Chỉ video Sẵn sàng mới gắn được vào camp'} onClick={() => setDialog('attach')}>
            Thêm vào camp{usable.length ? ` (${usable.length})` : ''}
          </Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDialog('remove')}>Xóa khỏi thư viện</Button>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Bỏ chọn</Button>
        </div>
      )}

      {q.isLoading ? (
        <Grid>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-56 rounded-lg" />)}</Grid>
      ) : q.isError ? (
        <Banner tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>Không đọc được thư viện creative.</Banner>
      ) : list.length === 0 ? (
        <Card>
          {all.length === 0 ? (
            <EmptyState icon={Film} title="Thư viện trống"
              action={
                <div className="flex gap-2">
                  <Button icon={Link2} onClick={() => setDialog('manual')}>Nhập ID YouTube</Button>
                  <Button variant="primary" icon={FolderPlus} onClick={() => void imp.pick('folder')}>Chọn thư mục video</Button>
                </div>
              }>
              Kéo thả file hoặc cả thư mục vào đây. App đọc file tại chỗ (không sao chép), tự nhận tỉ lệ khung hình và đoán quốc gia từ tên file như <code className="font-mono">promo_US_v2.mp4</code>.
            </EmptyState>
          ) : (
            <EmptyState icon={Search} title="Không có creative khớp bộ lọc"
              action={!isDefaultFilter(filter) ? <Button onClick={() => setFilter({ q: '', status: 'all', aspect: 'all', country: '' })}>Xóa bộ lọc</Button> : <Button onClick={() => setFilter({ scope: 'all' })}>Xem mọi app</Button>} />
          )}
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted">
            <span className="num">{list.length}</span> creative · Bấm thẻ để xem chi tiết · ô tick hoặc ⌘/Ctrl + bấm để chọn · Shift + bấm chọn dải · <span className="font-mono">Ctrl/⌘ A</span> chọn hết
          </p>
          <Grid>
            {list.map((c, i) => (
              <CreativeCard key={c.id} c={c} pct={pct[c.id]} selected={sel.has(c.id)} open={openId === c.id} selecting={sel.size > 0}
                onActivate={(e, viaCheckbox) => activate(i, e, viaCheckbox)} />
            ))}
          </Grid>
        </>
      )}

      {openC && (
        <CreativeDrawer key={openC.id} c={openC} pct={pct[openC.id]} online={online}
          nav={{ index: openIdx, total: list.length, prev: () => openIdx > 0 && setOpenId(list[openIdx - 1].id), next: () => openIdx < list.length - 1 && setOpenId(list[openIdx + 1].id) }}
          onClose={() => setOpenId(null)} />
      )}

      {dialog === 'upload' && <UploadDialog items={uploadable} onClose={() => setDialog(null)} />}
      {dialog === 'countries' && <CountriesDialog items={selected} onClose={() => setDialog(null)} />}
      {dialog === 'manual' && <ManualIdsDialog onClose={() => setDialog(null)} />}
      {dialog === 'attach' && <AttachDialog items={usable} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && (
        <Dialog title={`Xóa ${selected.length} creative khỏi thư viện?`} onClose={() => setDialog(null)} width="w-[480px]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>Hủy</Button>
              <Button variant="danger" icon={Trash2} onClick={() => { setDialog(null); void act(() => api.creatives.remove(ids), `Đã xóa ${ids.length} creative khỏi thư viện`); }}>Xóa</Button>
            </>
          }>
          <p className="text-sm">File gốc trên máy, video trên YouTube và asset trong Google Ads <b>không bị xóa</b>. Chỉ bỏ khỏi danh sách quản lý của app.</p>
        </Dialog>
      )}
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{children}</div>
);

function CreativeCard({ c, pct, selected, open, selecting, onActivate }: {
  c: Creative;
  pct?: number;
  selected: boolean;
  open: boolean;
  selecting: boolean;
  onActivate: (e: React.MouseEvent | React.KeyboardEvent, viaCheckbox?: boolean) => void;
}) {
  const ytUrl = c.youtubeId ? `https://www.youtube.com/watch?v=${c.youtubeId}` : null;
  const flags = creativeFlags(c);
  const fc = flagCounts(flags);
  return (
    <div
      role="button"
      aria-pressed={selected}
      aria-label={c.name}
      tabIndex={0}
      onClick={(e) => onActivate(e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.preventDefault(), onActivate(e));
        else if (e.key === ' ') (e.preventDefault(), onActivate(e, true));
      }}
      className={cx(
        'group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-surface text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'border-accent ring-2 ring-accent/30' : open ? 'border-accent/70 ring-2 ring-accent/15' : 'border-border hover:border-accent/50',
      )}
    >
      <div className="relative">
        <Thumb c={c} className="aspect-video" />
        <label className={cx('absolute top-1.5 left-1.5 grid size-7 place-items-center rounded-md bg-surface/90 shadow-sm', !selected && !selecting && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}
          onClick={(e) => e.stopPropagation()} title="Chọn (Space)">
          <input type="checkbox" tabIndex={-1} checked={selected} aria-label={`Chọn ${c.name}`} className="size-4" onChange={() => undefined}
            onClick={(e) => { e.stopPropagation(); onActivate(e, true); }} />
        </label>
        <span className="absolute top-2 right-2 rounded-sm bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{aspectLabel(c)}</span>
        {c.kind === 'video' && c.durationS != null && <span className="num absolute right-2 bottom-2 rounded-sm bg-slate-900/70 px-1.5 py-0.5 text-[11px] text-white">{fmtDuration(c.durationS)}</span>}
        {(fc.danger > 0 || fc.warning > 0) && (
          <span className="absolute bottom-2 left-2"><SeverityPills danger={fc.danger} warning={fc.warning} title={flags.map((f) => `• ${f.message}`).join('\n')} /></span>
        )}
        {c.status === 'UPLOADING' && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-900/30" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="brand-gradient h-full transition-[width]" style={{ width: `${pct ?? 0}%` }} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <p className="truncate text-sm font-medium" title={c.path || c.name}>{c.name}</p>
        <p className="truncate text-xs text-muted">
          {c.source === 'youtube' ? 'Nhập từ YouTube' : [c.width && `${c.width}×${c.height}`, fmtBytes(c.sizeBytes)].filter(Boolean).join(' · ')}
        </p>
        <div className="flex flex-wrap gap-1">
          {c.countries.length ? (
            c.countries.slice(0, 6).map((k) => (
              <span key={k} className="rounded-sm bg-surface-2 px-1 text-xs"><span aria-hidden>{flag(k)}</span> {k}</span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1 text-xs text-muted"><Globe2 className="size-3" aria-hidden /> Dùng chung</span>
          )}
          {c.countries.length > 6 && <span className="text-xs text-muted">+{c.countries.length - 6}</span>}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          <CreativeStatusBadge c={c} pct={pct} />
          {c.linkedCustomers > 0 && <StatusBadge tone="success" icon={Megaphone}>Đã gắn{c.linkedCustomers > 1 ? ` · ${c.linkedCustomers} TK` : ''}</StatusBadge>}
          <div className="flex-1" />
          {ytUrl && (
            <button className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-text" title="Mở trên YouTube" aria-label="Mở trên YouTube"
              onClick={(e) => { e.stopPropagation(); void api.app.openExternal(ytUrl); }}>
              <CirclePlay className="size-4" aria-hidden />
            </button>
          )}
          {c.path && (
            <button className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-text" title="Hiện trong thư mục" aria-label="Hiện trong thư mục"
              onClick={(e) => { e.stopPropagation(); void api.creatives.reveal(c.id); }}>
              <FolderOpen className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
