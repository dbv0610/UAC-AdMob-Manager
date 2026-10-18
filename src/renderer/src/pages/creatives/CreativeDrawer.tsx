import { useState } from 'react';
import { Ban, CirclePlay, CloudUpload, Copy, ExternalLink, Film, FolderOpen, Globe2, ImageIcon, MapPin, Megaphone, Pause, Trash2 } from 'lucide-react';
import { ASPECTS, ASPECT_LABEL, isUsable, type Aspect, type Creative } from '@shared/creative';
import { creativeFlags } from '@shared/health';
import { flag, getCountry } from '@shared/geo';
import { api } from '@/lib/api';
import { useApps } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Button, Select, SeverityPills } from '@/components/ui';
import { Drawer } from '@/components/drawer';
import { Dialog } from '@/components/dialog';
import { FlagList, flagCounts } from '@/components/kit';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { AttachDialog, CountriesDialog, UploadDialog } from './dialogs';
import { CreativeStatusBadge, Thumb, fmtBytes, fmtDuration } from './shared';
import { VerdictPill, useVideoPerf } from './VideoPerf';
import { useAdsCustomers } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { fmtMoney, fmtNumber } from '@/lib/format';

// Ngăn chi tiết một creative: xem lớn, thông tin, cờ và thao tác cho riêng mục này.

type DialogKind = 'upload' | 'countries' | 'attach' | 'remove' | null;

export function CreativeDrawer({ c, pct, online, nav, onClose }: {
  c: Creative;
  pct?: number;
  online: boolean;
  nav: { index: number; total: number; prev: () => void; next: () => void };
  onClose: () => void;
}) {
  const { data: apps = [] } = useApps();
  const perfQ = useVideoPerf();
  const cid = useUi((s) => s.prefs?.currentAdsCustomerId ?? null);
  const { data: customers = [] } = useAdsCustomers();
  const cur = customers.find((x) => x.customerId === cid)?.currency ?? 'USD';
  const perf = c.youtubeId ? perfQ.data?.items.find((v) => v.videoId === c.youtubeId) : undefined;
  const onError = useErrorHandler();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const flags = creativeFlags(c);
  const ytUrl = c.youtubeId ? `https://www.youtube.com/watch?v=${c.youtubeId}` : null;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ tone: 'success', title: ok });
    } catch (err) {
      onError(err);
    }
  };
  const canUpload = c.kind === 'video' && c.source === 'file' && ['LOCAL', 'FAILED', 'PAUSED'].includes(c.status);
  const canPause = c.status === 'QUEUED' || c.status === 'UPLOADING';
  const canCancel = c.source === 'file' && ['QUEUED', 'UPLOADING', 'PAUSED', 'FAILED'].includes(c.status);
  const info: [string, React.ReactNode][] = [
    ['Loại', c.kind === 'video' ? 'Video' : 'Ảnh'],
    ['Tỉ lệ', c.aspect ? ASPECT_LABEL[c.aspect] : 'Chưa rõ'],
    ['Kích thước', c.width ? `${c.width}×${c.height}` : '—'],
    ...(c.kind === 'video' ? [['Thời lượng', fmtDuration(c.durationS)] as [string, React.ReactNode]] : []),
    ['Dung lượng', fmtBytes(c.sizeBytes)],
    ['Nguồn', c.source === 'youtube' ? 'Nhập ID YouTube' : 'File trên máy'],
    ['App', apps.find((a) => a.id === c.appId)?.name ?? 'Dùng cho mọi app'],
    ['Thêm lúc', fmtDateTime(c.createdAt)],
    ...(c.privacy ? [['Quyền riêng tư', c.privacy] as [string, React.ReactNode]] : []),
  ];

  return (
    <Drawer
      width="w-[560px]"
      title={c.name}
      leading={<span className="grid size-9 place-items-center rounded-lg bg-accent-2/10 text-accent-2">{c.kind === 'image' ? <ImageIcon className="size-5" aria-hidden /> : <Film className="size-5" aria-hidden />}</span>}
      subtitle={
        <>
          <CreativeStatusBadge c={c} pct={pct} />
          {c.linkedCustomers > 0 && <span>· đã gắn {c.linkedCustomers} tài khoản Ads</span>}
          {(flagCounts(flags).danger > 0 || flagCounts(flags).warning > 0) && <SeverityPills danger={flagCounts(flags).danger} warning={flagCounts(flags).warning} />}
        </>
      }
      nav={nav}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-lg border border-border">
          <Thumb c={c} className="aspect-video" />
          {ytUrl && (
            <button className="absolute inset-0 grid place-items-center bg-slate-900/0 transition-colors hover:bg-slate-900/30" onClick={() => void api.app.openExternal(ytUrl)} aria-label="Xem trên YouTube">
              <CirclePlay className="size-12 text-white drop-shadow-lg" aria-hidden />
            </button>
          )}
        </div>

        <FlagList flags={flags} />
        {c.status === 'LOCKED' && (
          <Button className="self-start" size="sm" variant="secondary" icon={ExternalLink} onClick={() => void api.app.openExternal('https://support.google.com/youtube/contact/yt_api_form')}>
            Gửi yêu cầu audit YouTube API
          </Button>
        )}

        {perf && (
          <section className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="mr-auto text-sm font-semibold">Hiệu quả trên Google Ads</h3>
              <VerdictPill v={perf.verdict} />
            </div>
            <p className="text-sm">
              {perf.campaigns.length} camp · chi <b className="num">{fmtMoney(perf.costMicros / 1e6, cur)}</b> · <b className="num">{fmtNumber(perf.conversions, 0)}</b> chuyển đổi · CPI <b className="num">{perf.cpiMicros == null ? '—' : fmtMoney(perf.cpiMicros / 1e6, cur)}</b>
              {perf.relCpi != null && <span className={perf.relCpi < 1 ? 'text-success' : 'text-danger'}> ({perf.relCpi < 1 ? 'rẻ' : 'đắt'} hơn camp {Math.round(Math.abs(1 - perf.relCpi) * 100)}%)</span>}
            </p>
            <p className="mt-1 text-xs text-muted">Kỳ {perfQ.data!.from} → {perfQ.data!.to} · xem tab Hiệu quả video</p>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Thông tin</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="truncate">{v}</dd>
              </div>
            ))}
          </dl>
          {c.path && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" data-selectable>
              <span className="truncate font-mono" title={c.path}>{c.path}</span>
              <button className="shrink-0 rounded-sm p-0.5 hover:bg-surface-2 hover:text-text" title="Hiện trong thư mục" aria-label="Hiện trong thư mục" onClick={() => void api.creatives.reveal(c.id)}>
                <FolderOpen className="size-3.5" aria-hidden />
              </button>
            </p>
          )}
          {c.youtubeId && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              YouTube ID <span className="font-mono text-text">{c.youtubeId}</span>
              <button className="rounded-sm p-0.5 hover:bg-surface-2 hover:text-text" aria-label="Sao chép YouTube ID" title="Sao chép"
                onClick={() => void navigator.clipboard.writeText(c.youtubeId!).then(() => toast({ tone: 'success', title: 'Đã sao chép YouTube ID' }))}>
                <Copy className="size-3.5" aria-hidden />
              </button>
            </p>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="mr-auto text-sm font-semibold">Quốc gia</h3>
            <Button size="sm" variant="ghost" icon={MapPin} onClick={() => setDialog('countries')}>Sửa</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.countries.length ? c.countries.map((k) => (
              <span key={k} className="rounded-md bg-surface-2 px-2 py-0.5 text-sm"><span aria-hidden>{flag(k)}</span> {getCountry(k)?.name ?? k}</span>
            )) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-sm text-muted"><Globe2 className="size-3.5" aria-hidden /> Dùng chung cho mọi nước</span>
            )}
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <h3 className="mb-2 text-sm font-semibold">Thao tác</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {canUpload && <Button size="sm" variant="primary" icon={CloudUpload} disabled={!online} onClick={() => setDialog('upload')}>Upload</Button>}
            {canPause && <Button size="sm" icon={Pause} onClick={() => void act(() => api.creatives.pause([c.id]), 'Đã tạm dừng upload')}>Tạm dừng</Button>}
            {canCancel && <Button size="sm" icon={Ban} onClick={() => void act(() => api.creatives.cancel([c.id]), 'Đã hủy upload')}>Hủy upload</Button>}
            <Button size="sm" icon={Megaphone} disabled={!isUsable(c) || !online} title={isUsable(c) ? undefined : 'Chỉ video Sẵn sàng mới gắn được vào camp'} onClick={() => setDialog('attach')}>Thêm vào camp</Button>
            {c.kind === 'video' && (
              <Select className="h-7 w-36" value={c.aspect ?? ''} aria-label="Tỉ lệ khung hình"
                onChange={(e) => e.target.value && void act(() => api.creatives.patch({ ids: [c.id], aspect: e.target.value as Aspect }), 'Đã đặt tỉ lệ')}>
                <option value="">Đặt tỉ lệ…</option>
                {ASPECTS.map((a) => <option key={a} value={a}>{ASPECT_LABEL[a]}</option>)}
              </Select>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDialog('remove')}>Xóa khỏi thư viện</Button>
          </div>
        </section>
      </div>

      {dialog === 'upload' && <UploadDialog items={[c]} onClose={() => setDialog(null)} />}
      {dialog === 'countries' && <CountriesDialog items={[c]} onClose={() => setDialog(null)} />}
      {dialog === 'attach' && <AttachDialog items={[c]} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && (
        <Dialog title={`Xóa “${c.name}” khỏi thư viện?`} onClose={() => setDialog(null)} width="w-[480px]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>Hủy</Button>
              <Button variant="danger" icon={Trash2} onClick={() => { setDialog(null); onClose(); void act(() => api.creatives.remove([c.id]), 'Đã xóa khỏi thư viện'); }}>Xóa</Button>
            </>
          }>
          <p className="text-sm">File gốc trên máy, video trên YouTube và asset trong Google Ads <b>không bị xóa</b>. Chỉ bỏ khỏi danh sách quản lý của app.</p>
        </Dialog>
      )}
    </Drawer>
  );
}
