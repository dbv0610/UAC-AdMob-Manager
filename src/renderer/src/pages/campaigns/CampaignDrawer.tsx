import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3, Copy, ExternalLink, History, Megaphone, Pause, Play, Workflow } from 'lucide-react';
import { describeChange } from '@shared/insights';
import { adsCampaignUrl } from '@shared/plan';
import { flag } from '@shared/geo';
import { budgetPacing, type HealthFlag } from '@shared/health';
import type { CampaignChange, CampaignRow } from '@shared/types';
import { api } from '@/lib/api';
import { navigate, useUi } from '@/lib/store';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPct, fromMicros } from '@/lib/format';
import { Button, SeverityPills, Skeleton, StatusBadge, cx } from '@/components/ui';
import { Drawer } from '@/components/drawer';
import { FlagList, Segmented, StatGrid, flagCounts } from '@/components/kit';
import { fmtChangeValue } from '@/components/DiffPreview';
import { toast } from '@/components/toast';
import { TrendChart, chartSeries, type ChartMode } from '../analytics/Chart';
import { GOAL_SHORT, changesFor } from './CampaignList';

// Ngăn chi tiết một camp ở màn Campaigns: số trực tiếp từ Google Ads + số đã đồng bộ (theo ngày, ROAS ước tính) + đề xuất rule.

export function CampaignDrawer({ c, currency, days, periodLabel, flags, online, nav, onClose, onChange }: {
  c: CampaignRow;
  currency: string;
  days: number; // để chia chi phí/ngày
  periodLabel: string;
  flags: HealthFlag[];
  online: boolean;
  nav: { index: number; total: number; prev: () => void; next: () => void };
  onClose: () => void;
  onChange: (changes: CampaignChange[]) => void;
}) {
  const range = useUi((s) => s.prefs?.range ?? 'last7');
  const [tab, setTab] = useState('overview');
  const [mode, setMode] = useState<ChartMode>('combo');
  const money = (m: number | null) => (m == null ? '—' : fmtMoney(fromMicros(m), currency));
  const perf = useQuery({ queryKey: ['analytics', 'campaign', null, range, c.id], queryFn: () => api.analytics.campaign(null, range, c.id), enabled: tab === 'perf' });
  const changes = useQuery({ queryKey: ['changes', 'campaign', range, c.id], queryFn: () => api.analytics.changes(null, 'last30', c.id), enabled: tab === 'changes' });
  const sugg = useQuery({ queryKey: ['suggestions', 'campaign', c.id], queryFn: async () => [...(await api.rules.suggestions('pending')), ...(await api.rules.suggestions('history'))].filter((s) => s.campaignId === c.id), enabled: tab === 'rules' });
  const pacing = budgetPacing(c, days);
  const cpa = c.conversions > 0 ? c.costMicros / c.conversions : null;
  const ask = (changes: CampaignChange[]) => (changes.length ? onChange(changes) : toast({ tone: 'info', title: 'Không có gì thay đổi' }));
  const hasData = !!perf.data && perf.data.daily.some((p) => p.spend > 0 || p.revenue > 0);
  const sumP = perf.data?.daily.reduce((a, p) => ({ spend: a.spend + p.spend, revenue: a.revenue + p.revenue, installs: a.installs + p.installs }), { spend: 0, revenue: 0, installs: 0 });

  return (
    <Drawer
      title={c.name}
      leading={<span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent"><Megaphone className="size-5" aria-hidden /></span>}
      subtitle={
        <>
          {c.status === 'ENABLED' ? <StatusBadge tone="success" icon={Play}>Đang chạy</StatusBadge> : <StatusBadge tone="neutral" icon={Pause}>Tạm dừng</StatusBadge>}
          {c.country && <span><span aria-hidden>{flag(c.country)}</span> {c.country}</span>}
          {c.goalType && <span>· {GOAL_SHORT[c.goalType] ?? c.goalType}</span>}
          <span className="font-mono">#{c.id}</span>
          <button className="rounded-sm p-0.5 hover:bg-surface-2 hover:text-text" aria-label="Sao chép ID camp" title="Sao chép ID"
            onClick={() => void navigator.clipboard.writeText(c.id).then(() => toast({ tone: 'success', title: 'Đã sao chép ID camp' }))}>
            <Copy className="size-3.5" aria-hidden />
          </button>
        </>
      }
      actions={<Button size="sm" variant="ghost" icon={ExternalLink} title="Mở trên Google Ads" aria-label="Mở trên Google Ads" onClick={() => void api.app.openExternal(adsCampaignUrl(c.customerId, c.id))} />}
      nav={nav}
      onClose={onClose}
      tabs={[
        { id: 'overview', label: 'Tổng quan', badge: flags.some((f) => f.level !== 'info') ? <SeverityPills {...flagCounts(flags)} info={0} /> : undefined },
        { id: 'perf', label: 'Hiệu quả' },
        { id: 'rules', label: 'Đề xuất rule' },
        { id: 'changes', label: 'Lịch sử thay đổi' },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <StatGrid items={[
            { label: `Chi phí ${periodLabel}`, value: money(c.costMicros) },
            { label: 'Chuyển đổi', value: fmtNumber(c.conversions, 1) },
            { label: 'CPA', value: money(cpa), tone: cpa != null && c.targetCpaMicros != null && cpa > c.targetCpaMicros * 1.3 ? 'warning' : undefined },
            { label: 'Hiển thị', value: fmtNumber(c.impressions) },
            { label: 'Ngân sách/ngày', value: money(c.budgetMicros), hint: c.budgetShared ? 'Ngân sách dùng chung' : undefined },
            { label: 'Giá thầu', value: c.targetRoas != null ? `tROAS ${fmtNumber(c.targetRoas * 100)}%` : c.targetCpaMicros != null ? `tCPI ${money(c.targetCpaMicros)}` : '—' },
          ]} />
          {pacing != null && (
            <div className="rounded-md border border-border px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted">Tiêu trung bình mỗi ngày so với ngân sách</span>
                <span className={cx('num font-semibold', pacing >= 0.95 ? 'text-warning' : 'text-text')}>{fmtPct(pacing, 0)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className={cx('h-full rounded-full', pacing >= 0.95 ? 'bg-warning' : 'brand-gradient')} style={{ width: `${Math.min(100, pacing * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">{money(c.costMicros / days)}/ngày trên {money(c.budgetMicros)}</p>
            </div>
          )}
          <FlagList flags={flags} />
          <section className="rounded-md border border-border p-3">
            <h3 className="mb-2 text-sm font-semibold">Thao tác nhanh</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {c.status === 'ENABLED' ? (
                <Button size="sm" icon={Pause} disabled={!online} onClick={() => ask(changesFor.status([c], 'PAUSED'))}>Tạm dừng</Button>
              ) : (
                <Button size="sm" icon={Play} disabled={!online} onClick={() => ask(changesFor.status([c], 'ENABLED'))}>Bật</Button>
              )}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <span className="text-xs text-muted">Ngân sách</span>
              {[-20, -10, 10, 20].map((p) => (
                <Button key={p} size="sm" className="num" disabled={!online} onClick={() => ask(changesFor.budget([c], p))}>{p > 0 ? `+${p}` : p}%</Button>
              ))}
              {(c.targetCpaMicros != null || c.targetRoas != null) && (
                <>
                  <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                  <span className="text-xs text-muted">Giá thầu</span>
                  <Button size="sm" icon={ArrowDown} disabled={!online} onClick={() => ask(changesFor.target([c], -10))}>10%</Button>
                  <Button size="sm" icon={ArrowUp} disabled={!online} onClick={() => ask(changesFor.target([c], 10))}>10%</Button>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">Mọi thay đổi đều qua bước xem trước, ghi nhật ký và hoàn tác được trong 10 giây.</p>
          </section>
        </div>
      )}

      {tab === 'perf' && (
        perf.isLoading ? <Skeleton className="h-60" /> : !hasData ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <BarChart3 className="size-8 text-muted" aria-hidden />
            <p className="max-w-sm text-sm text-muted">Chưa có số đồng bộ cho camp này trong kỳ. App cần map với AdMob/Ads ở Cài đặt → App, rồi đồng bộ ở Analytics.</p>
            <Button onClick={() => navigate('/analytics')}>Mở Analytics</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <StatGrid items={[
              { label: 'Chi phí', value: fmtMoney(sumP!.spend, currency) },
              { label: 'Cài đặt', value: fmtNumber(sumP!.installs) },
              { label: 'Doanh thu (ước tính)', value: fmtMoney(sumP!.revenue, currency), hint: 'Doanh thu của (ngày, app, nước) chia theo tỉ lệ chi phí của camp' },
              { label: 'ROAS (ước tính)', value: sumP!.spend ? fmtPct(sumP!.revenue / sumP!.spend, 0) : '—', tone: sumP!.spend ? (sumP!.revenue >= sumP!.spend ? 'success' : 'danger') : undefined },
              { label: 'CPI', value: sumP!.installs ? fmtMoney(sumP!.spend / sumP!.installs, currency) : '—' },
              { label: 'Lợi nhuận', value: fmtMoney(sumP!.revenue - sumP!.spend, currency), tone: sumP!.revenue - sumP!.spend < 0 ? 'danger' : 'success' },
            ]} />
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold">Theo ngày</h3>
                <Segmented size="xs" label="Biểu đồ camp" value={mode} onChange={(v) => setMode(v as ChartMode)} options={[['combo', 'Chi & thu'], ['installs', 'Cài'], ['cpi', 'CPI'], ['roas', 'ROAS'], ['cumulative', 'Lũy kế']]} />
              </div>
              <TrendChart dates={perf.data!.daily.map((p) => p.date)} {...chartSeries(mode, perf.data!.daily, null)} currency={currency} height={200} ariaLabel="Camp theo ngày" />
            </section>
            <p className="text-xs text-muted">Số đã đồng bộ về máy (Analytics); doanh thu theo camp là ước lượng.</p>
          </div>
        )
      )}

      {tab === 'changes' && (
        changes.isLoading ? <Skeleton className="h-40" /> : !changes.data?.length ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <History className="size-8 text-muted" aria-hidden />
            <p className="max-w-sm text-sm text-muted">Chưa có thay đổi nào trong 30 ngày (lấy từ Google Ads mỗi lần đồng bộ báo cáo — gồm cả sửa tay trên web).</p>
          </div>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
            {changes.data.map((e) => (
              <li key={e.id} className="relative">
                <span className={cx('absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-surface', e.source.startsWith('API') ? 'bg-accent' : 'bg-accent-2')} aria-hidden />
                <p className="text-sm">{describeChange(e, (m) => fmtMoney(m / 1e6, currency), (v) => fmtPct(v, 0))}</p>
                <p className="text-xs text-muted">{fmtDateTime(e.at)} · {e.source}{e.user ? ` · ${e.user}` : ''}</p>
              </li>
            ))}
          </ol>
        )
      )}

      {tab === 'rules' && (
        sugg.isLoading ? <Skeleton className="h-40" /> : !sugg.data?.length ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Workflow className="size-8 text-muted" aria-hidden />
            <p className="text-sm text-muted">Chưa có đề xuất rule nào cho camp này.</p>
            <Button onClick={() => navigate('/rules')}>Mở Rules</Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sugg.data.map((s) => (
              <li key={s.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <StatusBadge tone={s.status === 'pending' ? 'info' : s.status === 'applied' ? 'success' : s.status === 'failed' ? 'danger' : 'neutral'}>
                    {{ pending: 'Chờ duyệt', applied: 'Đã áp dụng', dismissed: 'Bỏ qua', failed: 'Lỗi', expired: 'Hết hạn' }[s.status]}
                  </StatusBadge>
                  <span className="num text-muted">{fmtChangeValue(s.change.field, s.change.before, s.currency)}</span>→<b className="num">{fmtChangeValue(s.change.field, s.change.after, s.currency)}</b>
                  <span className="ml-auto text-xs text-muted">{fmtDateTime(s.decidedAt ?? s.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{s.ruleName} · {s.reason}</p>
              </li>
            ))}
            <Button className="self-start" variant="ghost" onClick={() => navigate('/rules')}>Duyệt ở Rules →</Button>
          </ul>
        )
      )}
    </Drawer>
  );
}
