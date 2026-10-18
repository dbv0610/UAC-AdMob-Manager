import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Radar, RefreshCw, Replace, ThumbsDown } from 'lucide-react';
import { ASPECT_LABEL, type LowVideo } from '@shared/creative';
import { flag } from '@shared/geo';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { fmtDateTime } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Select, Skeleton, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';

// Video Google đánh giá LOW trong App campaign → gợi ý video Sẵn sàng cùng nước, cùng tỉ lệ khung, chưa có trong camp.
const key = (v: LowVideo) => `${v.adResource}|${v.lowAsset}`;
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/default.jpg`;

export function LowVideos() {
  const cid = useUi((s) => s.prefs?.currentAdsCustomerId ?? null);
  const online = useUi((s) => s.online);
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const cached = useQuery({ queryKey: ['lowVideos', cid], queryFn: () => api.creatives.lowCached(cid!), enabled: !!cid });
  const [scanning, setScanning] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setScanning(true);
    try {
      const items = await api.creatives.scanLow(cid!);
      qc.setQueryData(['lowVideos', cid], { at: new Date().toISOString(), items });
      setSel(new Set(items.filter((i) => i.candidates.length).map(key)));
      toast({ tone: items.length ? 'info' : 'success', title: items.length ? `Có ${items.length} video hiệu quả thấp` : 'Không có video nào bị đánh giá LOW' });
    } catch (err) {
      onError(err, () => void scan());
    } finally {
      setScanning(false);
    }
  };

  if (!cid) return <Banner tone="warning">Chọn tài khoản Google Ads ở thanh trên cùng để quét.</Banner>;
  const items = cached.data?.items ?? [];
  const pick = (v: LowVideo) => choice[key(v)] ?? v.candidates[0]?.youtubeId ?? '';
  const chosen = items.filter((v) => sel.has(key(v)) && pick(v));

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.creatives.replace({
        customerId: cid,
        items: chosen.map((v) => ({ adResource: v.adResource, campaignId: v.campaignId, removeAsset: v.lowAsset, addVideoId: pick(v) })),
      });
      toast({ tone: 'success', title: `Đã thay video ở ${r.ads} quảng cáo`, detail: 'Google cần vài ngày để đánh giá lại video mới' });
      setConfirm(false);
      // Bỏ các dòng đã thay khỏi danh sách đã lưu
      qc.setQueryData(['lowVideos', cid], { at: cached.data?.at ?? new Date().toISOString(), items: items.filter((v) => !chosen.includes(v)) });
      setSel(new Set());
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={scanning ? RefreshCw : Radar} loading={scanning} disabled={!online} onClick={() => void scan()}>Quét Google Ads</Button>
        <p className="text-sm text-muted">
          {cached.data?.at ? `Quét lúc ${fmtDateTime(cached.data.at)}` : 'Chưa quét'} · Google gắn nhãn LOW khi video kém hơn các video khác trong cùng quảng cáo (cần đủ lượt hiển thị).
        </p>
        <div className="flex-1" />
        {chosen.length > 0 && <Button icon={Replace} disabled={!online} onClick={() => setConfirm(true)}>Thay {chosen.length} video</Button>}
      </div>

      {cached.isLoading ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={ThumbsDown} title={cached.data ? 'Không có video hiệu quả thấp' : 'Chưa quét'}>
            Quét tìm video có nhãn LOW trong App campaign của tài khoản đang chọn; app gợi ý video Sẵn sàng trong thư viện để thay (cùng quốc gia, cùng tỉ lệ khung hình).
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr className="text-left">
                <th className="h-row w-8 px-3" />
                <th className="px-2 font-medium">Camp</th>
                <th className="px-2 font-medium">Video LOW</th>
                <th className="w-6" />
                <th className="px-2 font-medium">Thay bằng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((v) => {
                const k = key(v);
                return (
                  <tr key={k} className={cx(sel.has(k) && 'bg-accent/5')}>
                    <td className="px-3">
                      <input type="checkbox" aria-label={`Chọn ${v.campaignName}`} disabled={!v.candidates.length} checked={sel.has(k)}
                        onChange={() => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); }} />
                    </td>
                    <td className="max-w-64 truncate px-2" title={v.campaignName}>{v.country && <span aria-hidden>{flag(v.country)} </span>}{v.campaignName}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <img src={thumb(v.lowVideoId)} alt="" className="h-9 w-12 rounded-sm object-cover" />
                        <span className="font-mono text-xs">{v.lowVideoId}</span>
                        {v.lowAspect && <span className="text-xs text-muted">{ASPECT_LABEL[v.lowAspect]}</span>}
                      </span>
                    </td>
                    <td><ArrowRight className="size-4 text-muted" aria-hidden /></td>
                    <td className="px-2">
                      {v.candidates.length ? (
                        <Select className="w-72" aria-label={`Video thay cho ${v.campaignName}`} value={pick(v)} onChange={(e) => setChoice({ ...choice, [k]: e.target.value })}>
                          {v.candidates.map((c) => (
                            <option key={c.youtubeId} value={c.youtubeId}>
                              {c.name} · {c.aspect ? ASPECT_LABEL[c.aspect] : '—'} · {c.own ? v.country : 'dùng chung'}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-warning">Chưa có video Sẵn sàng phù hợp — upload thêm cho {v.country ?? 'nước này'}{v.lowAspect ? ` (${ASPECT_LABEL[v.lowAspect]})` : ''}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {confirm && (
        <Dialog title={`Thay ${chosen.length} video hiệu quả thấp?`} onClose={() => setConfirm(false)} width="w-[640px]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>Hủy</Button>
              <Button variant="primary" icon={Replace} loading={busy} onClick={() => void apply()}>Ghi lên Google Ads</Button>
            </>
          }>
          <ul className="flex flex-col gap-1 text-sm">
            {chosen.map((v) => (
              <li key={key(v)} className="flex items-center gap-2">
                <span className="max-w-60 truncate">{v.campaignName}</span>
                <span className="font-mono text-xs text-muted">{v.lowVideoId}</span>
                <ArrowRight className="size-3.5 text-muted" aria-hidden />
                <span className="truncate font-medium">{v.candidates.find((c) => c.youtubeId === pick(v))?.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Video LOW bị gỡ khỏi quảng cáo (vẫn còn trong thư viện asset); video mới được thêm vào. Ghi vào nhật ký thay đổi.</p>
        </Dialog>
      )}
    </div>
  );
}
