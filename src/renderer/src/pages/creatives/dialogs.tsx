import { useMemo, useState } from 'react';
import { ArrowRight, CloudUpload, LogIn, Search } from 'lucide-react';
import { ASPECTS, ASPECT_LABEL, YT_DAILY_UPLOADS, parseYoutubeIds, type Aspect, type AttachPreview, type Creative } from '@shared/creative';
import { flag } from '@shared/geo';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { useAdsCustomers, useCampaigns } from '@/lib/queries';
import { fmtTime } from '@/lib/format';
import { Dialog } from '@/components/dialog';
import { Banner, Button, Field, Input, Select, Skeleton, cx } from '@/components/ui';
import { toast } from '@/components/toast';
import { useErrorHandler, useSignIn } from '@/components/connect';
import { CountryPicker } from '@/pages/campaigns/CountryPicker';
import { Thumb } from './shared';

// ── Upload video ────────────────────────────────────────────────────────────
// Mặc định qua Google Ads (kênh YouTube do Google quản lý): chỉ cần tài khoản Ads đã đăng nhập.
export function UploadDialog({ items, onClose }: { items: Creative[]; onClose: () => void }) {
  const accounts = useUi((s) => s.accounts);
  const prefs = useUi((s) => s.prefs)!;
  const quota = useUi((s) => s.quota);
  const { data: customers = [] } = useAdsCustomers();
  const leaf = customers.filter((c) => !c.manager);
  const yt = accounts.filter((a) => a.kind === 'youtube');
  const [via, setVia] = useState<'ads' | 'youtube'>(prefs.uploadVia ?? 'ads');
  const [customerId, setCustomerId] = useState(prefs.uploadCustomerId ?? prefs.currentAdsCustomerId ?? leaf[0]?.customerId ?? '');
  const [accountId, setAccountId] = useState(prefs.youtubeAccountId && yt.some((a) => a.id === prefs.youtubeAccountId) ? prefs.youtubeAccountId : (yt[0]?.id ?? ''));
  const [kids, setKids] = useState(false);
  const [pending, setPending] = useState(false);
  const { signIn, pending: signing } = useSignIn();
  const onError = useErrorHandler();

  const uploadable = items.filter((c) => c.kind === 'video' && c.source === 'file' && ['LOCAL', 'FAILED', 'PAUSED'].includes(c.status));
  const left = Math.max(0, YT_DAILY_UPLOADS - (quota?.youtubeUploads ?? 0));
  const later = via === 'youtube' ? Math.max(0, uploadable.length - left) : 0;
  const skipped = items.length - uploadable.length;
  const ready = via === 'ads' ? !!customerId : !!accountId && kids;

  const submit = async () => {
    setPending(true);
    try {
      const ids = uploadable.map((c) => c.id);
      const r = await api.creatives.upload(via === 'ads' ? { kind: 'ads', ids, customerId } : { kind: 'youtube', ids, accountId, notMadeForKids: true });
      toast({ tone: 'success', title: `Đã xếp ${r.queued} video vào hàng đợi upload`, detail: later ? `${later} video sẽ chờ quota ngày mai` : undefined });
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  };

  const Option = ({ id, title, children }: { id: 'ads' | 'youtube'; title: React.ReactNode; children: React.ReactNode }) => (
    <label className={cx('flex cursor-pointer gap-3 rounded-lg border p-3', via === id ? 'border-accent bg-accent/5 ring-2 ring-accent/20' : 'border-border hover:border-accent/50')}>
      <input type="radio" name="via" className="mt-1" checked={via === id} onChange={() => setVia(id)} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <div className="text-muted">{children}</div>
      </div>
    </label>
  );

  return (
    <Dialog
      title={`Upload ${uploadable.length} video`}
      onClose={onClose}
      width="w-[720px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" icon={CloudUpload} loading={pending} disabled={!ready || !uploadable.length} onClick={submit}>
            Upload {uploadable.length} video
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Option id="ads" title={<>Qua Google Ads <span className="ml-1 rounded-sm bg-success/10 px-1.5 text-xs text-success">Khuyên dùng</span></>}>
          Video lên kênh YouTube do Google quản lý của tài khoản Ads, chế độ Unlisted. <b className="text-text">Không cần</b> tài khoản YouTube, YouTube API hay audit; không tính 100 lượt/ngày.
        </Option>
        {via === 'ads' && (
          <div className="ml-7 flex flex-col gap-2">
            {leaf.length === 0 ? (
              <Banner tone="warning" action={<Button size="sm" variant="primary" icon={LogIn} loading={signing === 'ads'} onClick={() => signIn('ads')}>Đăng nhập Google Ads</Button>}>
                Chưa có tài khoản Google Ads.
              </Banner>
            ) : (
              <Field label="Tài khoản Google Ads nhận video" htmlFor="up-cid" hint="Video dùng được cho camp của tài khoản này. Developer token mức Test chỉ chạy với tài khoản test.">
                <Select id="up-cid" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  {leaf.map((c) => <option key={c.customerId} value={c.customerId}>{c.name} · {c.customerId}</option>)}
                </Select>
              </Field>
            )}
          </div>
        )}

        <Option id="youtube" title="Qua kênh YouTube của bạn (YouTube API)">
          Video nằm trên kênh của bạn. Cần đăng nhập YouTube; project chưa qua YouTube API Audit thì video bị ép Private. Tối đa {YT_DAILY_UPLOADS} lượt/ngày.
        </Option>
        {via === 'youtube' && (
          <div className="ml-7 flex flex-col gap-3">
            {yt.length === 0 ? (
              <Banner tone="warning" action={<Button size="sm" variant="primary" icon={LogIn} loading={signing === 'youtube'} onClick={() => signIn('youtube')}>Đăng nhập YouTube</Button>}>
                Chưa có tài khoản YouTube.
              </Banner>
            ) : (
              <Field label="Kênh / tài khoản YouTube" htmlFor="yt-acc">
                <Select id="yt-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {yt.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.status === 'reauth'}>
                      {a.email}{a.status === 'reauth' ? ' (cần đăng nhập lại)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Stat label="Sẽ upload" value={uploadable.length} />
              <Stat label="Còn lượt hôm nay" value={left} tone={left < uploadable.length ? 'warning' : undefined} />
              <Stat label="Chờ ngày mai" value={later} tone={later ? 'warning' : undefined} />
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={kids} onChange={(e) => setKids(e.target.checked)} />
              <span>
                Tôi xác nhận các video này <b>không dành cho trẻ em</b>.
                <span className="block text-xs text-muted">Khai sai “made for kids” vi phạm chính sách COPPA của YouTube.</span>
              </span>
            </label>
          </div>
        )}

        {skipped > 0 && <p className="text-xs text-muted">Bỏ qua {skipped} mục: ảnh, video đã upload hoặc đang trong hàng đợi.</p>}
        <p className="text-xs text-muted">Tiêu đề = tên creative; file gốc trên máy giữ nguyên. Upload chạy nền, tạm dừng / tiếp tục được; tắt app vẫn upload tiếp từ chỗ dở.</p>
      </div>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={cx('num text-left text-lg font-semibold', tone === 'warning' && 'text-warning')}>{value}</p>
    </div>
  );
}

// ── Gán quốc gia ────────────────────────────────────────────────────────────
export function CountriesDialog({ items, onClose }: { items: Creative[]; onClose: () => void }) {
  const first = items[0]?.countries ?? [];
  const same = items.every((c) => c.countries.join() === first.join());
  const [mode, setMode] = useState<'replace' | 'add'>(same ? 'replace' : 'add');
  const [codes, setCodes] = useState<string[]>(same ? first : []);
  const [pending, setPending] = useState(false);
  const onError = useErrorHandler();

  const submit = async () => {
    setPending(true);
    try {
      await api.creatives.patch({ ids: items.map((c) => c.id), ...(mode === 'replace' ? { countries: codes } : { addCountries: codes }) });
      toast({ tone: 'success', title: `Đã cập nhật quốc gia cho ${items.length} creative` });
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      title={`Gán quốc gia · ${items.length} creative`}
      onClose={onClose}
      width="w-[880px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={pending} disabled={mode === 'add' && !codes.length} onClick={submit}>
            {mode === 'replace' && !codes.length ? 'Đặt là dùng chung (mọi nước)' : 'Lưu'}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Thay toàn bộ</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> Thêm vào quốc gia đang có</label>
        <span className="text-xs text-muted">Không chọn nước nào = video dùng chung, áp cho mọi quốc gia.</span>
      </div>
      <CountryPicker value={codes} onChange={setCodes} />
    </Dialog>
  );
}

// ── Nhập ID / link YouTube có sẵn ──────────────────────────────────────────
export function ManualIdsDialog({ onClose }: { onClose: () => void }) {
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const [text, setText] = useState('');
  const [aspect, setAspect] = useState<Aspect | ''>('');
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const onError = useErrorHandler();
  const parsed = useMemo(() => parseYoutubeIds(text), [text]);

  const submit = async () => {
    setPending(true);
    try {
      const r = await api.creatives.addYoutubeIds({ text, appId, aspect: aspect || null, countries: codes });
      toast({ tone: 'success', title: `Đã thêm ${r.added} video`, detail: r.duplicates ? `${r.duplicates} ID đã có trong thư viện` : undefined });
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      title="Nhập video YouTube có sẵn"
      onClose={onClose}
      width="w-[880px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={pending} disabled={!parsed.ids.length} onClick={submit}>
            Thêm {parsed.ids.length} video
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Dùng khi video đã upload tay trên YouTube Studio (ví dụ project chưa qua audit). Video phải ở chế độ Unlisted hoặc Public.</p>
        <Field
          label="Link hoặc ID (mỗi dòng một video)"
          htmlFor="yt-ids"
          error={parsed.invalid.length ? `Không đọc được: ${parsed.invalid.slice(0, 3).join(', ')}${parsed.invalid.length > 3 ? '…' : ''}` : undefined}
          hint={`${parsed.ids.length} video hợp lệ`}
        >
          <textarea id="yt-ids" value={text} onChange={(e) => setText(e.target.value)} placeholder={'https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/shorts/…'}
            className="min-h-28 w-full rounded-sm border border-border bg-surface p-2 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </Field>
        <Field label="Tỉ lệ khung hình" htmlFor="yt-aspect" hint="YouTube không cho đọc kích thước video của người khác — chọn để ma trận đếm đúng">
          <Select id="yt-aspect" className="w-48" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect | '')}>
            <option value="">Chưa rõ</option>
            {ASPECTS.map((a) => <option key={a} value={a}>{ASPECT_LABEL[a]}</option>)}
          </Select>
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Quốc gia (bỏ trống = dùng chung)</p>
          <CountryPicker value={codes} onChange={setCodes} />
        </div>
      </div>
    </Dialog>
  );
}

// ── Thêm video vào camp đang chạy: chọn camp → xem trước → ghi ──────────────
export function AttachDialog({ items, onClose }: { items: Creative[]; onClose: () => void }) {
  const prefs = useUi((s) => s.prefs)!;
  const online = useUi((s) => s.online);
  const cid = prefs.currentAdsCustomerId;
  const { data: customers = [] } = useAdsCustomers();
  const camps = useCampaigns(cid, prefs.range);
  const onError = useErrorHandler();
  const videoIds = items.map((c) => c.youtubeId!).slice(0, 20);
  const countries = new Set(items.flatMap((c) => c.countries));

  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [preview, setPreview] = useState<AttachPreview[] | null>(null);
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);

  // Gợi ý sẵn: camp cùng quốc gia với video (video dùng chung → không chọn sẵn)
  const sel = picked ?? new Set((camps.data ?? []).filter((c) => c.country && countries.has(c.country)).map((c) => c.id));
  const list = (camps.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };

  const loadPreview = async () => {
    setPending(true);
    try {
      setPreview(await api.creatives.previewAttach({ customerId: cid!, campaignIds: [...sel], videoIds }));
    } catch (err) {
      onError(err, () => void loadPreview());
    } finally {
      setPending(false);
    }
  };

  const changing = preview?.filter((p) => p.added.length) ?? [];
  const risky = changing.length >= 10;
  const confirm = async () => {
    setPending(true);
    try {
      const r = await api.creatives.attach({ customerId: cid!, campaignIds: changing.map((p) => p.campaignId), videoIds });
      toast({ tone: 'success', title: `Đã thêm video vào ${r.campaigns} camp`, detail: `${r.operations} operation` });
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  };

  const customer = customers.find((c) => c.customerId === cid);
  return (
    <Dialog
      title={preview ? `Xem trước · thêm ${videoIds.length} video vào ${changing.length} camp` : `Thêm ${videoIds.length} video vào camp`}
      onClose={onClose}
      width="w-[760px]"
      footer={
        preview ? (
          <>
            {risky && (
              <Input className="w-56" placeholder={`Gõ ${changing.length} để xác nhận`} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Xác nhận số camp" />
            )}
            <Button variant="ghost" onClick={() => setPreview(null)}>Quay lại</Button>
            <Button variant="primary" loading={pending} disabled={!online || !changing.length || (risky && typed.trim() !== String(changing.length))} onClick={confirm}>
              Ghi lên Google Ads
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Hủy</Button>
            <Button variant="primary" icon={ArrowRight} loading={pending} disabled={!sel.size || !online} onClick={loadPreview}>
              Xem trước ({sel.size} camp)
            </Button>
          </>
        )
      }
    >
      {!cid ? (
        <Banner tone="warning">Chọn tài khoản Google Ads ở thanh trên cùng trước.</Banner>
      ) : preview ? (
        <div className="flex flex-col gap-3">
          {preview.some((p) => p.overLimit) && (
            <Banner tone="warning">Có camp sẽ vượt 20 video: chỉ thêm đến khi đủ 20, video còn lại bị bỏ qua.</Banner>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">Camp</th>
                <th className="py-1 text-right font-medium">Video trước</th>
                <th className="py-1 text-right font-medium">Sau</th>
                <th className="py-1 font-medium">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.map((p) => (
                <tr key={p.campaignId} className={cx(!p.added.length && 'text-muted')}>
                  <td className="max-w-80 truncate py-1.5" title={p.name}>{p.name}</td>
                  <td className="num py-1.5">{p.before}</td>
                  <td className="num py-1.5 font-medium">{p.after}</td>
                  <td className="py-1.5 text-xs">{!p.added.length ? 'Đã có đủ các video này' : p.overLimit ? 'Chạm giới hạn 20' : `+${p.added.length}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">Video cũ trong camp giữ nguyên. Asset video tạo một lần cho tài khoản {customer?.name ?? cid}, dùng chung cho mọi camp.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
            <Input className="pl-8" placeholder="Tìm camp…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm camp" />
          </div>
          {camps.isLoading ? (
            <div className="flex flex-col gap-1">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : camps.isError ? (
            <Banner tone="danger" action={<Button size="sm" onClick={() => void camps.refetch()}>Thử lại</Button>}>Không tải được danh sách camp.</Banner>
          ) : (
            <div className="flex max-h-96 flex-col overflow-y-auto rounded-lg border border-border">
              {list.map((c) => (
                <label key={c.id} className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-sm last:border-0 hover:bg-surface-2">
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                  <span aria-hidden>{c.country ? flag(c.country) : ''}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted">{c.status === 'ENABLED' ? 'Đang chạy' : 'Tạm dừng'}</span>
                </label>
              ))}
              {!list.length && <p className="p-6 text-center text-sm text-muted">Không có camp nào</p>}
            </div>
          )}
          <p className="text-xs text-muted">Đã chọn sẵn camp cùng quốc gia với video. Video: {items.map((c) => c.name).slice(0, 3).join(', ')}{items.length > 3 ? '…' : ''}</p>
        </div>
      )}
    </Dialog>
  );
}

// ── Chọn video từ thư viện cho một dòng quốc gia (dùng trong wizard) ───────
export function VideoPickerDialog({
  library,
  country,
  value,
  onChange,
  onClose,
}: {
  library: Creative[];
  country: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState(value);
  const [onlyCountry, setOnlyCountry] = useState(!!country);
  const usable = library.filter((c) => c.kind === 'video' && c.status === 'READY' && c.youtubeId);
  const shown = usable
    .filter((c) => !onlyCountry || !country || c.countries.includes(country) || c.countries.length === 0)
    .sort((a, b) => Number(b.countries.includes(country ?? '')) - Number(a.countries.includes(country ?? '')));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 20 ? s : [...s, id]));

  return (
    <Dialog
      title={`Chọn video${country ? ` cho ${flag(country)} ${country}` : ''}`}
      onClose={onClose}
      width="w-[880px]"
      footer={
        <>
          <span className="num mr-auto text-sm text-muted">{sel.length}/20 video</span>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" onClick={() => { onChange(sel); onClose(); }}>Dùng {sel.length} video</Button>
        </>
      }
    >
      {country && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyCountry} onChange={(e) => setOnlyCountry(e.target.checked)} />
          Chỉ video gán {country} hoặc dùng chung
        </label>
      )}
      {!shown.length ? (
        <p className="py-10 text-center text-sm text-muted">Chưa có video sẵn sàng{onlyCountry ? ` cho ${country}` : ''}. Upload hoặc nhập ID ở màn Creatives.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {shown.map((c) => {
            const on = sel.includes(c.youtubeId!);
            return (
              <button key={c.id} onClick={() => toggle(c.youtubeId!)} aria-pressed={on}
                className={cx('flex flex-col overflow-hidden rounded-lg border text-left', on ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-accent/50')}>
                <Thumb c={c} className="aspect-video" />
                <span className="truncate px-2 pt-1 text-xs font-medium">{c.name}</span>
                <span className="px-2 pb-1.5 text-xs text-muted">
                  {c.aspect ? ASPECT_LABEL[c.aspect] : '—'} · {c.countries.length ? c.countries.join(', ') : 'Dùng chung'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

export function UploaderBanner() {
  const st = useUi((s) => s.uploader);
  const { signIn, pending } = useSignIn();
  if (!st?.waiting || (st.queued === 0 && st.waiting !== 'quota')) return null;
  if (st.waiting === 'quota') {
    return (
      <Banner tone="warning">
        Đã dùng hết {YT_DAILY_UPLOADS} lượt upload YouTube hôm nay. {st.queued} video đang chờ — tự chạy lại lúc {st.resumeAt ? fmtTime(st.resumeAt) : '0h giờ PT'}.
      </Banner>
    );
  }
  if (st.waiting === 'offline') return <Banner tone="warning">Mất mạng — {st.queued} video chờ upload, sẽ tự chạy khi có mạng.</Banner>;
  return (
    <Banner tone="danger" action={
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={LogIn} loading={pending === 'ads'} onClick={() => signIn('ads')}>Đăng nhập Google Ads</Button>
        <Button size="sm" icon={LogIn} loading={pending === 'youtube'} onClick={() => signIn('youtube')}>YouTube</Button>
      </div>
    }>
      {st.queued} video đang chờ vì tài khoản nhận video (Google Ads hoặc YouTube) chưa đăng nhập hoặc cần đăng nhập lại.
    </Banner>
  );
}
