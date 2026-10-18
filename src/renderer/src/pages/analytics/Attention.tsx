import { useMemo, useState } from 'react';
import { AlertTriangle, BellOff, CheckCircle2, ChevronDown, Database, Eye, Info, RefreshCw, Rocket, Settings2, XCircle, type LucideIcon } from 'lucide-react';
import type { Alert, AlertRule, AnalyticsResult, Insight, SyncStatus } from '@shared/analytics';
import { flag, getCountry } from '@shared/geo';
import { navigate } from '@/lib/store';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, cx } from '@/components/ui';

// “Cần chú ý”: gộp cảnh báo (7 ngày gần nhất) và nhận định của kỳ đang xem vào một danh sách có mức độ.

export type AttnLevel = 'danger' | 'warning' | 'opportunity' | 'info';
export interface AttnItem {
  id: string;
  level: AttnLevel;
  title: string;
  detail: string;
  countries: string[];
  origin: 'alert' | 'insight';
}

const LEVEL: Record<AttnLevel, { label: string; icon: LucideIcon; text: string; chip: string; bar: string }> = {
  danger: { label: 'Nghiêm trọng', icon: XCircle, text: 'text-danger', chip: 'bg-danger/10 text-danger', bar: 'bg-danger' },
  warning: { label: 'Cảnh báo', icon: AlertTriangle, text: 'text-warning', chip: 'bg-warning/10 text-warning', bar: 'bg-warning' },
  opportunity: { label: 'Cơ hội', icon: Rocket, text: 'text-success', chip: 'bg-success/10 text-success', bar: 'bg-success' },
  info: { label: 'Thông tin', icon: Info, text: 'text-info', chip: 'bg-info/10 text-info', bar: 'bg-info' },
};
const ORDER: AttnLevel[] = ['danger', 'warning', 'opportunity', 'info'];

export const RULE_LABEL: Record<AlertRule, string> = {
  ctr: 'CTR quảng cáo cao bất thường',
  showRate: 'Show rate thấp',
  ecpmDrop: 'eCPM tụt',
  spendSpike: 'Chi phí tăng vọt',
  roasLow: 'ROAS dưới ngưỡng',
  cpiHigh: 'CPI vượt tCPI',
};
const countryName = (c: string) => getCountry(c)?.name ?? c;

export function attentionItems(alerts: Alert[], insights: Insight[]): AttnItem[] {
  const a: AttnItem[] = alerts.map((x) => ({
    id: `alert:${x.rule}:${x.appId}:${x.country}`,
    level: x.level,
    title: `${countryName(x.country)} · ${RULE_LABEL[x.rule]}`,
    detail: x.message,
    countries: [x.country],
    origin: 'alert',
  }));
  const tone: Record<Insight['tone'], AttnLevel> = { danger: 'danger', warning: 'warning', success: 'opportunity', info: 'info' };
  const i: AttnItem[] = insights.map((x) => ({
    id: `insight:${x.id}`,
    level: x.id === 'expand' || x.id === 'rise' ? 'opportunity' : tone[x.tone],
    title: x.title,
    detail: x.detail,
    countries: x.countries,
    origin: 'insight',
  }));
  return [...a, ...i].sort((p, q) => ORDER.indexOf(p.level) - ORDER.indexOf(q.level));
}

// Ẩn trong hôm nay (theo máy, mất cũng không sao)
const snoozeKey = () => `attn-snooze:${new Date().toLocaleDateString('en-CA')}`;
function readSnoozed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(snoozeKey()) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function writeSnoozed(ids: string[]) {
  try {
    localStorage.setItem(snoozeKey(), JSON.stringify(ids));
  } catch {
    /* bỏ qua */
  }
}

export function AttentionPanel({ items, onOpenCountry, onFilter, onPlan }: { items: AttnItem[]; onOpenCountry: (c: string) => void; onFilter: (countries: string[], title: string) => void; onPlan?: (countries: string[]) => void }) {
  const [filter, setFilter] = useState<AttnLevel | 'all'>('all');
  const [snoozed, setSnoozed] = useState(readSnoozed);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const live = items.filter((x) => showSnoozed || !snoozed.includes(x.id));
  const counts = useMemo(() => Object.fromEntries(ORDER.map((l) => [l, live.filter((x) => x.level === l).length])) as Record<AttnLevel, number>, [live]);
  const shown = live.filter((x) => filter === 'all' || x.level === filter);
  const hidden = items.filter((x) => snoozed.includes(x.id)).length;
  const snooze = (id: string) => {
    const next = [...snoozed, id];
    setSnoozed(next);
    writeSnoozed(next);
  };

  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-base font-semibold">Cần chú ý</h2>
        {live.length > 0 && <span className="num rounded-full bg-surface-2 px-2 text-xs font-semibold text-muted">{live.length}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon={Settings2} title="Ngưỡng cảnh báo" aria-label="Ngưỡng cảnh báo" onClick={() => navigate('/settings')} />
      </div>
      <div className="flex flex-wrap gap-1 px-4 pb-2" role="radiogroup" aria-label="Lọc mức độ">
        {(['all', ...ORDER] as const).map((l) => {
          const n = l === 'all' ? live.length : counts[l];
          if (l !== 'all' && !n) return null;
          return (
            <button key={l} role="radio" aria-checked={filter === l} onClick={() => setFilter(l)}
              className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition-colors',
                filter === l ? (l === 'all' ? 'bg-accent text-accent-fg ring-accent' : cx(LEVEL[l].chip, 'ring-current')) : 'text-muted ring-border hover:text-text')}>
              {l === 'all' ? 'Tất cả' : LEVEL[l].label} <span className="num opacity-80">{n}</span>
            </button>
          );
        })}
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {shown.map((it) => {
          const L = LEVEL[it.level];
          const one = it.countries.length === 1;
          return (
            <li key={it.id} className={cx('group relative overflow-hidden rounded-md border border-border bg-surface pl-3.5 transition-shadow hover:shadow-sm', snoozed.includes(it.id) && 'opacity-50')}>
              <span className={cx('absolute inset-y-0 left-0 w-1', L.bar)} aria-hidden />
              <div className="flex items-start gap-2 py-2 pr-2" title={it.origin === 'alert' ? 'Cảnh báo tính trên 7 ngày gần nhất' : 'Nhận định theo kỳ đang xem'}>
                <L.icon className={cx('mt-0.5 size-4 shrink-0', L.text)} aria-label={L.label} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-medium">
                    {one && <span className="mr-1" aria-hidden>{flag(it.countries[0])}</span>}
                    {it.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{it.detail}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  {it.countries.length > 0 && (
                    <button className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/10"
                      onClick={() => (one ? onOpenCountry(it.countries[0]) : onFilter(it.countries, it.title))}>
                      <Eye className="size-3.5" aria-hidden /> {one ? 'Xem' : `Lọc ${it.countries.length}`}
                    </button>
                  )}
                  {it.id === 'insight:expand' && onPlan && (
                    <button className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-success hover:bg-success/10" onClick={() => onPlan(it.countries)}
                      title="Thêm các nước này vào kế hoạch camp mới">
                      <Rocket className="size-3.5" aria-hidden /> Tạo kế hoạch
                    </button>
                  )}
                  {!snoozed.includes(it.id) && (
                    <button className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-text focus-visible:opacity-100"
                      onClick={() => snooze(it.id)} title="Ẩn mục này đến hết hôm nay">
                      <BellOff className="size-3.5" aria-hidden /> Ẩn
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {!shown.length && (
          <li className="flex flex-col items-center gap-1 py-8 text-center text-sm text-muted">
            <CheckCircle2 className="size-6 text-success" aria-hidden />
            Không có gì cần chú ý
          </li>
        )}
      </ul>
      {hidden > 0 && (
        <button className="border-t border-border px-4 py-2 text-left text-xs text-muted hover:text-text" onClick={() => setShowSnoozed(!showSnoozed)}>
          {showSnoozed ? 'Ẩn lại các mục đã ẩn' : `Đã ẩn ${hidden} mục hôm nay · hiện lại`}
        </button>
      )}
    </Card>
  );
}

// ── Dải trạng thái dữ liệu: thay cho nhiều banner xếp chồng ─────────────────
export function DataHealth({ sync, d, online, onSync, needDays, missingHistory }: {
  sync: SyncStatus | null;
  d: AnalyticsResult | undefined;
  online: boolean;
  onSync: (days: number) => void;
  needDays: number;
  missingHistory: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!sync?.at) return null;
  const stale = Date.now() - Date.parse(sync.at) > 24 * 3600_000;
  const errs = [!sync.spend.ok && { k: 'Google Ads', msg: sync.spend.error }, !sync.revenue.ok && { k: 'AdMob', msg: sync.revenue.error }].filter(Boolean) as { k: string; msg?: string }[];
  const mixed = d?.mixedCurrency ?? [];
  const bad = errs.length > 0;
  const warn = stale || missingHistory || mixed.length > 0;
  const Dot = ({ ok, label, title }: { ok: boolean | 'warn'; label: string; title?: string }) => (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className={cx('size-2 rounded-full', ok === true ? 'bg-success' : ok === 'warn' ? 'bg-warning' : 'bg-danger')} aria-hidden />
      {label}
    </span>
  );

  return (
    <div className={cx('rounded-lg border text-sm', bad ? 'border-danger/30 bg-danger/5' : warn ? 'border-warning/30 bg-warning/5' : 'border-border bg-surface')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        <Database className={cx('size-4', bad ? 'text-danger' : warn ? 'text-warning' : 'text-muted')} aria-hidden />
        <Dot ok={sync.spend.ok} label="Google Ads" title={sync.spend.ok ? `OK lúc ${sync.spend.at ? fmtDateTime(sync.spend.at) : '—'}` : sync.spend.error} />
        <Dot ok={sync.revenue.ok} label="AdMob" title={sync.revenue.ok ? `OK lúc ${sync.revenue.at ? fmtDateTime(sync.revenue.at) : '—'}` : sync.revenue.error} />
        <Dot ok={stale ? 'warn' : true} label={`Đồng bộ ${fmtDateTime(sync.at)}${stale ? ' (cũ hơn 24 giờ)' : ''}`} />
        {d?.dataFrom && <Dot ok={missingHistory ? 'warn' : true} label={missingHistory ? `Dữ liệu chỉ từ ${d.dataFrom}` : `Dữ liệu từ ${d.dataFrom}`} title="Ngày sớm nhất có số trên máy" />}
        {d && <span className="text-muted">Tiền tệ {d.currency}{mixed.length > 0 && <span className="text-warning"> · bỏ qua {mixed.length} app khác tiền tệ</span>}</span>}
        <span className="flex-1" />
        {missingHistory && <Button size="sm" icon={RefreshCw} disabled={!online} onClick={() => onSync(Math.min(400, needDays))}>Đồng bộ {Math.min(400, needDays)} ngày</Button>}
        {stale && !missingHistory && <Button size="sm" icon={RefreshCw} disabled={!online} onClick={() => onSync(3)}>Làm mới</Button>}
        {(bad || mixed.length > 0) && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            Chi tiết <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-1 border-t border-current/10 px-3 py-2 text-xs">
          {errs.map((e) => (
            <p key={e.k} className="flex items-start gap-1.5"><XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden /><b>{e.k}:</b> {e.msg} {e.k === 'AdMob' ? '— chi phí Google Ads vẫn dùng được.' : '— doanh thu AdMob vẫn dùng được.'}</p>
          ))}
          {mixed.length > 0 && <p className="flex items-start gap-1.5"><Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />Đang tính theo {d!.currency}; bỏ qua: {mixed.join(', ')}. Chọn từng app ở thanh trên để xem riêng.</p>}
          {bad && <Button size="sm" variant="secondary" icon={Settings2} onClick={() => navigate('/settings')}>Mở Cài đặt → Tài khoản</Button>}
        </div>
      )}
    </div>
  );
}
