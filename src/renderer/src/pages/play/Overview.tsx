import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, LayoutGrid, LogIn, MessageSquare, RefreshCw, Rocket, Search } from 'lucide-react';
import { STAGE_LABEL, VITALS_BAD, appStage, stageTrack, trackLabel, type AppOverview, type AppStage } from '@shared/playOps';
import { api } from '@/lib/api';
import { qk, useApps } from '@/lib/queries';
import { AppIcon } from '@/components/AppIcon';
import { useUi } from '@/lib/store';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Input, Select, Skeleton, StatusBadge, cx, type Tone } from '@/components/ui';
import { FilterChips, SummaryCard } from '@/components/kit';
import { toast } from '@/components/toast';
import { useErrorHandler, useSignIn } from '@/components/connect';
import { RolloutBar, ReleaseBadge, VITALS_LABEL, VITALS_TONE, activeRelease, ratePct, releaseName } from './parts';

type OpenTab = 'listing' | 'releases' | 'vitals' | 'reviews';
type Filter = 'all' | 'rollout' | 'testing' | 'vitals' | 'reviews' | 'errors';
type Sort = 'name' | 'stage' | 'crash' | 'reviews' | 'listing';

const STAGE_TONE: Record<AppStage, Tone> = { production: 'success', open: 'info', closed: 'warning', internal: 'neutral', none: 'neutral' };
const STAGE_RANK: Record<AppStage, number> = { production: 0, open: 1, closed: 2, internal: 3, none: 4 };

const rolling = (a: AppOverview) => a.tracks.some((t) => t.releases.some((r) => r.status === 'inProgress' || r.status === 'halted'));
const badVitals = (a: AppOverview) => a.vitals?.crash === 'bad' || a.vitals?.anr === 'bad';
const testing = (a: AppOverview) => a.stage === 'closed' || a.stage === 'open' || a.stage === 'internal';

const MATCH: Record<Filter, (a: AppOverview) => boolean> = {
  all: () => true,
  rollout: rolling,
  testing,
  vitals: badVitals,
  reviews: (a) => (a.reviews?.lowUnanswered ?? 0) > 0,
  errors: (a) => a.errors.length > 0,
};

const SORT: Record<Sort, (a: AppOverview, b: AppOverview) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  stage: (a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.name.localeCompare(b.name),
  crash: (a, b) => (b.vitals?.userCrash28 ?? -1) - (a.vitals?.userCrash28 ?? -1),
  reviews: (a, b) => (b.reviews?.lowUnanswered ?? 0) - (a.reviews?.lowUnanswered ?? 0) || (b.reviews?.unanswered ?? 0) - (a.reviews?.unanswered ?? 0),
  listing: (a, b) => (b.lastListingAt ?? '').localeCompare(a.lastListingAt ?? ''),
};

// Mọi app Google Play trên một bảng. Đọc cache trên máy; bấm Làm mới mới gọi Play (chạy nền).
export function Overview({ onOpen }: { onOpen: (row: AppOverview, tab: OpenTab) => void }) {
  const { data: mapped = [] } = useApps();
  const accounts = useUi((s) => s.accounts);
  const { signIn, pending } = useSignIn();
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const onError = useErrorHandler();
  const q = useQuery({ queryKey: qk.playOverview, queryFn: () => api.play.overviewCached(), staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('stage');

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await api.play.overview();
      qc.setQueryData(qk.playOverview, res);
      const failed = res.apps.filter((a) => a.errors.length).length;
      toast({ tone: failed ? 'warning' : 'success', title: `Đã đọc ${res.apps.length} app${failed ? ` · ${failed} app có lỗi` : ''}` });
    } catch (err) {
      onError(err, () => void refresh());
    } finally {
      setBusy(false);
    }
  };

  // Tên/icon theo danh sách app đã map hiện tại (khớp package); app mới map chưa có trong lần đọc trước vẫn hiện
  const apps = useMemo(() => {
    const cached = new Map((q.data?.apps ?? []).map((a) => [a.packageName, a]));
    return mapped
      .filter((m) => m.store === 'GOOGLE_PLAY')
      .map((m): AppOverview & { iconUrl: string | null; pending: boolean } => {
        const c = cached.get(m.storeAppId);
        const base = c ?? { appId: m.id, name: m.name, packageName: m.storeAppId, accountId: null, stage: 'none' as const, tracks: [], vitals: null, vitalsAt: null, reviews: null, lastListingAt: null, errors: [] };
        // Bản cache cũ còn lỗi "cần đăng nhập lại để xem Vitals" trong errors: chuyển thành cờ
        const errors = base.errors.filter((e) => !/cấp quyền xem chỉ số Vitals/.test(e));
        const scope = base.vitalsScopeMissing || errors.length < base.errors.length;
        return { ...base, appId: m.id, name: m.name, iconUrl: m.iconUrl, stage: base.stage ?? appStage(base.tracks), errors, vitalsScopeMissing: scope, pending: !c };
      });
  }, [q.data, mapped]);
  const reauth = useMemo(() => {
    const ids = new Set([...(q.data?.reauthAccounts ?? []), ...apps.filter((a) => a.vitalsScopeMissing && a.accountId).map((a) => a.accountId!)]);
    return accounts.filter((a) => ids.has(a.id));
  }, [q.data, apps, accounts]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return apps.filter((a) => MATCH[filter](a) && (!s || a.name.toLowerCase().includes(s) || a.packageName.toLowerCase().includes(s))).sort(SORT[sort]);
  }, [apps, filter, search, sort]);

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (!q.data) {
    return (
      <EmptyState icon={LayoutGrid} title="Chưa có dữ liệu tổng quan"
        action={<Button variant="primary" icon={RefreshCw} loading={busy} disabled={!online} onClick={refresh}>Đọc từ Google Play</Button>}>
        Đọc release (mọi kênh, kể cả thử nghiệm kín), vitals và review 7 ngày của mọi app Google Play đã map. App tự dò tài khoản Play có quyền với từng app.
      </EmptyState>
    );
  }

  const count = (f: Filter) => apps.filter(MATCH[f]).length;
  return (
    <div className="flex flex-col gap-4">
      {reauth.length > 0 && (
        <Card className="overflow-hidden">
          <Banner tone="warning" action={<Button size="sm" variant="primary" icon={LogIn} loading={pending === 'play'} onClick={() => signIn('play')}>Đăng nhập lại</Button>}>
            <b>{reauth.map((a) => a.email).join(', ')}</b> cần đăng nhập lại một lần để cấp quyền xem Vitals (crash/ANR). Release, review, listing vẫn dùng bình thường. Đăng nhập xong bấm Làm mới.
          </Banner>
        </Card>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <SummaryCard icon={LayoutGrid} tone="accent" label="App Google Play" value={apps.length} sub={`${count('testing')} đang thử nghiệm`} onClick={() => setFilter('all')} active={filter === 'all'} />
        <SummaryCard icon={FlaskConical} tone="warning" label="Đang thử nghiệm" value={count('testing')} sub="kín / mở / nội bộ" onClick={() => setFilter('testing')} active={filter === 'testing'} />
        <SummaryCard icon={Rocket} tone="info" label="Đang rollout dở" value={count('rollout')} sub="đang chạy hoặc tạm dừng" onClick={() => setFilter('rollout')} active={filter === 'rollout'} />
        <SummaryCard icon={AlertTriangle} tone={count('vitals') ? 'danger' : 'success'} label="Vitals vượt ngưỡng" value={count('vitals')} sub="crash/ANR 28 ngày" onClick={() => setFilter('vitals')} active={filter === 'vitals'} />
        <SummaryCard icon={MessageSquare} tone={count('reviews') ? 'warning' : 'success'} label="Có review ≤2★ chưa trả lời" value={count('reviews')} sub="7 ngày gần nhất" onClick={() => setFilter('reviews')} active={filter === 'reviews'} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
          <Input className="w-56 pl-8" placeholder="Tìm tên app hoặc package…" aria-label="Tìm app" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <FilterChips<Filter> label="Lọc app" value={filter} onChange={setFilter}
          chips={[
            { id: 'all', label: 'Tất cả', count: apps.length },
            { id: 'testing', label: 'Đang thử nghiệm', count: count('testing'), tone: 'warning' },
            { id: 'rollout', label: 'Đang rollout', count: count('rollout'), tone: 'info' },
            { id: 'vitals', label: 'Vitals xấu', count: count('vitals'), tone: 'danger' },
            { id: 'reviews', label: 'Review ≤2★', count: count('reviews'), tone: 'warning' },
            { id: 'errors', label: 'Có lỗi', count: count('errors'), tone: 'danger' },
          ]} />
        <span className="flex-1" />
        <Select className="w-44" aria-label="Sắp xếp" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="stage">Theo giai đoạn</option>
          <option value="name">Theo tên</option>
          <option value="crash">Crash cao trước</option>
          <option value="reviews">Review cần trả lời</option>
          <option value="listing">Sửa listing gần nhất</option>
        </Select>
        <Button icon={RefreshCw} loading={busy} disabled={!online} onClick={refresh} title={`Cập nhật ${fmtDateTime(q.data.at)}`}>Làm mới</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">App</th>
              <th className="px-3 py-2 font-medium">Giai đoạn</th>
              <th className="px-3 py-2 font-medium">Bản đang chạy</th>
              <th className="px-3 py-2 font-medium">Kênh khác</th>
              <th className="px-3 py-2 text-right font-medium" title={`Ngưỡng xấu ${ratePct(VITALS_BAD.userCrashRate)}`}>Crash 28 ngày</th>
              <th className="px-3 py-2 text-right font-medium" title={`Ngưỡng xấu ${ratePct(VITALS_BAD.userAnrRate)}`}>ANR 28 ngày</th>
              <th className="px-3 py-2 font-medium">Review 7 ngày</th>
              <th className="px-3 py-2 font-medium">Sửa listing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => {
              const main = stageTrack(a.tracks);
              const cur = activeRelease(main);
              const others = a.tracks.filter((t) => t !== main && t.releases.length);
              const cell = 'px-3 py-2 align-top';
              const link = 'text-left hover:text-accent hover:underline underline-offset-2';
              const store = a.stage === 'production' || a.stage === 'open';
              return (
                <tr key={a.appId} className="hover:bg-surface-2/50">
                  <td className={cell}>
                    <div className="flex items-start gap-2.5">
                      <AppIcon url={a.iconUrl} name={a.name} />
                      <div className="min-w-0">
                        <button className={cx(link, 'font-medium')} onClick={() => onOpen(a, 'listing')}>{a.name}</button>
                        <p className="font-mono text-xs text-muted" data-selectable>{a.packageName}</p>
                        {a.pending && <p className="text-xs text-muted">Chưa đọc — bấm Làm mới</p>}
                      </div>
                    </div>
                    {a.errors.map((e) => <p key={e} className="mt-0.5 line-clamp-2 max-w-72 text-xs text-danger" title={e}>{e}</p>)}
                  </td>
                  <td className={cell}><StatusBadge tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</StatusBadge></td>
                  <td className={cell}>
                    {cur && main ? (
                      <button className={cx(link, 'flex flex-col items-start gap-1')} onClick={() => onOpen(a, 'releases')}>
                        <span>{releaseName(cur)} <span className="text-xs text-muted">· {trackLabel(main.track)}</span></span>
                        <span className="flex items-center gap-2"><ReleaseBadge r={cur} />{cur.userFraction != null && cur.status !== 'completed' && <RolloutBar value={cur.userFraction} halted={cur.status === 'halted'} />}</span>
                      </button>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className={cell}>
                    {others.length ? (
                      <button className={cx(link, 'flex flex-col items-start gap-0.5 text-xs')} onClick={() => onOpen(a, 'releases')}>
                        {others.map((t) => <span key={t.track}>{trackLabel(t.track)}: {releaseName(activeRelease(t)!)}</span>)}
                      </button>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className={cx(cell, 'text-right')}>
                    <button className={link} onClick={() => onOpen(a, 'vitals')}>
                      <span className={cx('num block', !a.vitals && a.vitalsScopeMissing && 'text-xs text-muted')}>{!a.vitals && a.vitalsScopeMissing ? 'Chưa cấp quyền' : ratePct(a.vitals?.userCrash28)}</span>
                      {a.vitals?.crash && <StatusBadge tone={VITALS_TONE[a.vitals.crash]}>{VITALS_LABEL[a.vitals.crash]}</StatusBadge>}
                    </button>
                  </td>
                  <td className={cx(cell, 'text-right')}>
                    <button className={link} onClick={() => onOpen(a, 'vitals')}>
                      <span className={cx('num block', !a.vitals && a.vitalsScopeMissing && 'text-xs text-muted')}>{!a.vitals && a.vitalsScopeMissing ? 'Chưa cấp quyền' : ratePct(a.vitals?.userAnr28)}</span>
                      {a.vitals?.anr && <StatusBadge tone={VITALS_TONE[a.vitals.anr]}>{VITALS_LABEL[a.vitals.anr]}</StatusBadge>}
                    </button>
                  </td>
                  <td className={cell}>
                    {a.reviews && a.reviews.count > 0 ? (
                      <button className={cx(link, 'flex flex-col items-start')} onClick={() => onOpen(a, 'reviews')}>
                        <span className="num">{a.reviews.avg == null ? '—' : `${fmtNumber(a.reviews.avg, 1)}★`} · {a.reviews.count}</span>
                        {a.reviews.unanswered > 0 && (
                          <span className={cx('text-xs', a.reviews.lowUnanswered ? 'text-danger' : 'text-muted')}>
                            {a.reviews.unanswered} chưa trả lời{a.reviews.lowUnanswered ? ` · ${a.reviews.lowUnanswered} ≤2★` : ''}
                          </span>
                        )}
                      </button>
                    ) : <span className="text-xs text-muted">{store ? 'Không có review mới' : 'Chưa công khai'}</span>}
                  </td>
                  <td className={cx(cell, 'text-xs text-muted')}>{a.lastListingAt ? fmtDateTime(a.lastListingAt) : '—'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-muted">Không có app nào khớp bộ lọc.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
