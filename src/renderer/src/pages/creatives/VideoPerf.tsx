import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CirclePlay, Clock, Crown, Radar, RefreshCw, ThumbsDown, Video } from 'lucide-react';
import { ASPECT_LABEL } from '@shared/creative';
import { MIN_IMPRESSIONS, type GoogleLabel, type Verdict, type VideoPerf } from '@shared/insights';
import { rangeDays } from '@shared/analytics';
import { flag } from '@shared/geo';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { useAdsCustomers, useCreatives } from '@/lib/queries';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Skeleton, cx } from '@/components/ui';
import { CompactTable, FilterChips, StatGrid, SummaryCard } from '@/components/kit';
import { Drawer } from '@/components/drawer';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';

// Hiệu quả từng video trong App campaign: so CPI của video với CPI chung của camp chứa nó (gia quyền theo chi phí).

export const VERDICT: Record<Verdict, { label: string; cls: string; hint: string }> = {
  winner: { label: 'Thắng', cls: 'bg-success/10 text-success ring-success/30', hint: 'CPI rẻ hơn trung bình camp ≥ 20% (đủ 10 chuyển đổi) hoặc Google chấm BEST' },
  loser: { label: 'Thua', cls: 'bg-danger/10 text-danger ring-danger/30', hint: 'CPI đắt hơn trung bình camp ≥ 30% hoặc Google chấm LOW' },
  learning: { label: 'Đang học', cls: 'bg-surface-2 text-muted ring-border', hint: `Dưới ${fmtNumber(MIN_IMPRESSIONS)} lượt hiển thị — chưa đủ để kết luận` },
  neutral: { label: 'Trung bình', cls: 'bg-info/10 text-info ring-info/30', hint: 'Không nổi bật — giữ nguyên' },
};
const LABEL_CLS: Record<GoogleLabel, string> = { BEST: 'text-success', GOOD: 'text-info', LOW: 'text-danger', LEARNING: 'text-muted', PENDING: 'text-muted', UNKNOWN: 'text-muted' };

export function VerdictPill({ v }: { v: Verdict }) {
  return <span className={cx('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1', VERDICT[v].cls)} title={VERDICT[v].hint}>{VERDICT[v].label}</span>;
}
const relText = (r: number | null) => (r == null ? '—' : Math.abs(r - 1) < 0.05 ? 'ngang camp' : r < 1 ? `rẻ hơn ${fmtPct(1 - r, 0)}` : `đắt hơn ${fmtPct(r - 1, 0)}`);
const thumb = (id: string, q = 'mqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;

export function useVideoPerf() {
  const cid = useUi((s) => s.prefs?.currentAdsCustomerId ?? null);
  return useQuery({ queryKey: ['videoPerf', cid], queryFn: () => api.creatives.videoPerfCached(cid!), enabled: !!cid, staleTime: Infinity });
}

export function VideoPerfTab({ onOpenLow }: { onOpenLow: () => void }) {
  const prefs = useUi((s) => s.prefs)!;
  const online = useUi((s) => s.online);
  const cid = prefs.currentAdsCustomerId;
  const { data: customers = [] } = useAdsCustomers();
  const currency = customers.find((c) => c.customerId === cid)?.currency ?? 'USD';
  const lib = useCreatives();
  const q = useVideoPerf();
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Verdict | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const money = (m: number | null) => (m == null ? '—' : fmtMoney(m / 1e6, currency));
  const byYt = useMemo(() => new Map((lib.data ?? []).filter((c) => c.youtubeId).map((c) => [c.youtubeId!, c])), [lib.data]);

  const scan = async () => {
    setBusy(true);
    try {
      const r = await api.creatives.videoPerf(cid!, prefs.range);
      qc.setQueryData(['videoPerf', cid], r);
      toast({ tone: 'success', title: `Đã quét ${r.items.length} video`, detail: `${r.from} → ${r.to}` });
    } catch (err) {
      onError(err, () => void scan());
    } finally {
      setBusy(false);
    }
  };

  if (!cid) return <Banner tone="warning">Chọn tài khoản Google Ads ở thanh trên cùng để xem hiệu quả video.</Banner>;
  const items = q.data?.items ?? [];
  const count = (v: Verdict) => items.filter((x) => x.verdict === v).length;
  const rows = items.filter((x) => f === 'all' || x.verdict === f);
  const loserCost = items.filter((x) => x.verdict === 'loser').reduce((s, x) => s + x.costMicros, 0);
  const idx = openId ? rows.findIndex((x) => x.videoId === openId) : -1;
  const open = idx >= 0 ? rows[idx] : null;
  // Tên trong thư viện nếu có ý nghĩa (video nhập bằng ID thì tên chính là ID → dùng tiêu đề YouTube)
  const nameOf = (v: VideoPerf) => {
    const lib = byYt.get(v.videoId)?.name;
    return lib && lib !== v.videoId ? lib : v.title || v.videoId;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={busy ? RefreshCw : Radar} loading={busy} disabled={!online} onClick={() => void scan()}>Quét Google Ads ({rangeDays(prefs.range) ? `${rangeDays(prefs.range)} ngày` : 'từ trước đến nay'})</Button>
        <p className="text-sm text-muted">
          {q.data ? `Quét lúc ${fmtDateTime(q.data.at)} · kỳ ${q.data.from} → ${q.data.to}` : 'Chưa quét'} · So CPI của video với CPI chung của camp chứa nó.
        </p>
      </div>

      {q.isLoading ? <Skeleton className="h-60 rounded-lg" /> : !items.length ? (
        <Card>
          <EmptyState icon={Video} title={q.data ? 'Không có video nào có số trong kỳ' : 'Chưa quét'}>
            Quét chi phí, lượt hiển thị và chuyển đổi của từng video YouTube trong các App campaign để biết video nào thắng, video nào nên thay.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
            <SummaryCard icon={Video} label="Video có số" value={items.length} sub={`${money(items.reduce((s, x) => s + x.costMicros, 0))} chi phí`} onClick={() => setF('all')} active={f === 'all'} />
            <SummaryCard icon={Crown} tone="success" label="Thắng" value={count('winner')} sub="nên làm thêm video kiểu này" onClick={() => setF(f === 'winner' ? 'all' : 'winner')} active={f === 'winner'} />
            <SummaryCard icon={ThumbsDown} tone={count('loser') ? 'danger' : 'success'} label="Thua" value={count('loser')} sub={count('loser') ? `${money(loserCost)} chi cho video thua` : 'không có'} onClick={() => setF(f === 'loser' ? 'all' : 'loser')} active={f === 'loser'} />
            <SummaryCard icon={Clock} tone="info" label="Đang học" value={count('learning')} sub={`< ${fmtNumber(MIN_IMPRESSIONS)} hiển thị`} onClick={() => setF(f === 'learning' ? 'all' : 'learning')} active={f === 'learning'} />
          </div>
          <FilterChips label="Lọc kết luận" value={f} onChange={setF}
            chips={[
              { id: 'all', label: 'Tất cả', count: items.length },
              { id: 'winner', label: 'Thắng', count: count('winner'), tone: 'success' },
              { id: 'loser', label: 'Thua', count: count('loser'), tone: 'danger' },
              { id: 'neutral', label: 'Trung bình', count: count('neutral'), tone: 'info' },
              { id: 'learning', label: 'Đang học', count: count('learning') },
            ]} />
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="h-row px-3 text-left font-medium">Video</th>
                  <th className="px-2 text-left font-medium">Kết luận</th>
                  <th className="px-2 text-right font-medium">Camp</th>
                  <th className="px-2 text-right font-medium">Hiển thị</th>
                  <th className="px-2 text-right font-medium">CTR</th>
                  <th className="px-2 text-right font-medium">Chi phí</th>
                  <th className="px-2 text-right font-medium">Chuyển đổi</th>
                  <th className="px-2 text-right font-medium">CPI</th>
                  <th className="px-2 text-right font-medium" title="CPI video so với CPI chung của các camp chứa nó">So với camp</th>
                  <th className="px-2 text-left font-medium">Nhãn Google</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((v) => {
                  const isOpen = openId === v.videoId;
                  const c = byYt.get(v.videoId);
                  return (
                    <tr key={v.videoId} tabIndex={0} onClick={() => setOpenId(v.videoId)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(v.videoId)}
                      className={cx('group cursor-pointer outline-none', isOpen ? 'bg-selected' : 'hover:bg-surface-2/70 focus-visible:bg-surface-2/70')}>
                      <td className="relative px-3 py-1.5">
                        {isOpen && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                        <span className="flex items-center gap-2.5">
                          <img src={thumb(v.videoId, 'default')} alt="" className="h-10 w-14 shrink-0 rounded-sm bg-surface-2 object-cover" loading="lazy" />
                          <span className="min-w-0">
                            <span className="block max-w-64 truncate font-medium" title={nameOf(v)}>{nameOf(v)}</span>
                            <span className="block text-[11px] text-muted">
                              <span className="font-mono">{v.videoId}</span>
                              {c?.aspect && ` · ${ASPECT_LABEL[c.aspect]}`}
                              {!c && ' · ngoài thư viện'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-2"><VerdictPill v={v.verdict} /></td>
                      <td className="num px-2">{v.campaigns.length}</td>
                      <td className="num px-2">{fmtNumber(v.impressions)}</td>
                      <td className="num px-2">{v.ctr == null ? '—' : fmtPct(v.ctr, 1)}</td>
                      <td className="num px-2">{money(v.costMicros)}</td>
                      <td className="num px-2">{fmtNumber(v.conversions, 0)}</td>
                      <td className="num px-2 font-medium">{money(v.cpiMicros)}</td>
                      <td className={cx('num px-2 text-xs whitespace-nowrap', v.relCpi != null && (v.relCpi < 0.95 ? 'text-success' : v.relCpi > 1.05 ? 'text-danger' : 'text-muted'))}>{relText(v.relCpi)}</td>
                      <td className="px-2 text-xs whitespace-nowrap">{v.labels.map((l) => <span key={l} className={cx('mr-1.5 font-semibold', LABEL_CLS[l])}>{l}</span>)}</td>
                      <td className="pr-2"><ChevronRight className={cx('size-4 text-muted', isOpen ? 'text-accent' : 'opacity-0 group-hover:opacity-100')} aria-hidden /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted">Chuyển đổi = mục tiêu camp (thường là lượt cài). Video ở nhiều ad group/camp được cộng lại; “So với camp” cân theo chi phí ở từng camp.</p>
        </>
      )}

      {open && (
        <Drawer key={open.videoId} width="w-[580px]" title={nameOf(open)}
          leading={<span className="grid size-9 place-items-center rounded-lg bg-accent-2/10 text-accent-2"><Video className="size-5" aria-hidden /></span>}
          subtitle={<><VerdictPill v={open.verdict} /><span className="font-mono">{open.videoId}</span><span>· {open.campaigns.length} camp</span></>}
          nav={{ index: idx, total: rows.length, prev: () => idx > 0 && setOpenId(rows[idx - 1].videoId), next: () => idx < rows.length - 1 && setOpenId(rows[idx + 1].videoId) }}
          onClose={() => setOpenId(null)}>
          <div className="flex flex-col gap-4">
            <button className="relative overflow-hidden rounded-lg border border-border" onClick={() => void api.app.openExternal(`https://www.youtube.com/watch?v=${open.videoId}`)} aria-label="Xem trên YouTube">
              <img src={thumb(open.videoId)} alt="" className="aspect-video w-full bg-surface-2 object-cover" />
              <span className="absolute inset-0 grid place-items-center bg-slate-900/0 transition-colors hover:bg-slate-900/30"><CirclePlay className="size-12 text-white drop-shadow-lg" aria-hidden /></span>
            </button>
            <StatGrid items={[
              { label: 'Chi phí', value: money(open.costMicros) },
              { label: 'Chuyển đổi', value: fmtNumber(open.conversions, 0) },
              { label: 'CPI', value: money(open.cpiMicros), tone: open.relCpi != null ? (open.relCpi < 0.95 ? 'success' : open.relCpi > 1.05 ? 'danger' : undefined) : undefined },
              { label: 'Hiển thị', value: fmtNumber(open.impressions) },
              { label: 'CTR', value: open.ctr == null ? '—' : fmtPct(open.ctr, 1) },
              { label: 'So với camp', value: relText(open.relCpi) },
            ]} />
            <p className={cx('rounded-md border px-3 py-2 text-sm', open.verdict === 'winner' ? 'border-success/30 bg-success/5' : open.verdict === 'loser' ? 'border-danger/30 bg-danger/5' : 'border-border bg-surface-2/50')}>
              {open.verdict === 'winner' && 'Video thắng: giữ chạy, làm thêm biến thể cùng ý tưởng/tỉ lệ khung hình và thử ở các nước khác.'}
              {open.verdict === 'loser' && 'Video thua: cân nhắc thay bằng video Sẵn sàng khác cùng nước và tỉ lệ khung hình.'}
              {open.verdict === 'learning' && 'Chưa đủ lượt hiển thị để kết luận — đợi thêm vài ngày.'}
              {open.verdict === 'neutral' && 'Hiệu quả ngang mức trung bình của camp.'}
              {' '}<span className="text-muted">{VERDICT[open.verdict].hint}.</span>
            </p>
            {open.verdict === 'loser' && <Button className="self-start" icon={ThumbsDown} onClick={() => { setOpenId(null); onOpenLow(); }}>Mở tab thay video hiệu quả thấp</Button>}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Theo camp</h3>
              <CompactTable empty="—" head={['Camp', 'Nhãn', 'Chi phí', 'Chuyển đổi', 'CPI']}
                rows={open.campaigns.map((c) => ({
                  key: c.campaignId,
                  cells: [
                    <span key="n" className="flex min-w-0 items-center gap-1.5">{c.country && <span aria-hidden>{flag(c.country)}</span>}<span className="truncate" title={c.campaignName}>{c.campaignName}</span>{!c.enabled && <span className="text-[11px] text-muted">(đã tắt)</span>}</span>,
                    <span key="l" className={cx('font-semibold', LABEL_CLS[c.label])}>{c.label}</span>,
                    money(c.costMicros),
                    fmtNumber(c.conversions, 0),
                    money(c.conversions > 0 ? c.costMicros / c.conversions : null),
                  ],
                }))} />
            </section>
          </div>
        </Drawer>
      )}
    </div>
  );
}
