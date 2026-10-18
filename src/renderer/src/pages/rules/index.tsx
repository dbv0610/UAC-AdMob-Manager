import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, ArrowRight, Check, CheckCircle2, ChevronRight, Copy, FlaskConical, Inbox, Pencil, Play, Plus, Power, Search, Trash2, Workflow, X } from 'lucide-react';
import { RULE_TEMPLATES, describeRule, type Rule, type RuleWithMeta, type SuggestionRow } from '@shared/rules';
import { flag } from '@shared/geo';
import { api } from '@/lib/api';
import { navigate, useUi } from '@/lib/store';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPct } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, StatusBadge, cx, type Tone } from '@/components/ui';
import { DiffPreview, fmtChangeValue } from '@/components/DiffPreview';
import { Dialog } from '@/components/dialog';
import { Drawer } from '@/components/drawer';
import { FilterChips, SummaryCard } from '@/components/kit';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { RuleEditor } from './RuleEditor';

type Tab = 'pending' | 'rules' | 'history';
const fmt = { money: (v: number) => fmtMoney(v, 'USD'), pct: (v: number) => fmtPct(v, 0), num: (v: number) => fmtNumber(v) };
const WEEK_MS = 7 * 86400_000;

const STATUS: Record<SuggestionRow['status'], [Tone, string]> = {
  pending: ['info', 'Chờ duyệt'],
  applied: ['success', 'Đã áp dụng'],
  dismissed: ['neutral', 'Bỏ qua'],
  failed: ['danger', 'Lỗi'],
  expired: ['neutral', 'Hết hạn'],
};

// % thay đổi của một đề xuất số (ngân sách, tCPI, tROAS); null với đổi trạng thái
const changePct = (s: SuggestionRow) =>
  typeof s.change.before === 'number' && typeof s.change.after === 'number' && s.change.before !== 0 ? s.change.after / s.change.before - 1 : null;

function ChangeCell({ s, big }: { s: SuggestionRow; big?: boolean }) {
  const p = changePct(s);
  const label = { budget: 'Ngân sách', status: 'Trạng thái', targetCpa: 'tCPI', targetRoas: 'tROAS' }[s.change.field];
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap', big && 'text-base')}>
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-muted line-through decoration-muted/40">{fmtChangeValue(s.change.field, s.change.before, s.currency)}</span>
      <ArrowRight className="size-3.5 text-muted" aria-hidden />
      <b className="num">{fmtChangeValue(s.change.field, s.change.after, s.currency)}</b>
      {p != null && (
        <span className={cx('num rounded-full px-1.5 text-[11px] font-semibold', p < 0 ? 'bg-warning/10 text-warning' : 'bg-info/10 text-info')}>
          {p > 0 ? '+' : ''}{fmtPct(p, 0)}
        </span>
      )}
      {s.change.field === 'status' && s.change.after === 'PAUSED' && <span className="rounded-full bg-danger/10 px-1.5 text-[11px] font-semibold text-danger">dừng</span>}
    </span>
  );
}

export function Rules() {
  const pending = useUi((s) => s.pendingSuggestions);
  const [tab, setTab] = useState<Tab>(pending ? 'pending' : 'rules');
  const onError = useErrorHandler();
  const rulesQ = useQuery({ queryKey: ['rules'], queryFn: () => api.rules.list() });
  const histQ = useQuery({ queryKey: ['suggestions', 'history'], queryFn: () => api.rules.suggestions('history') });
  const runNow = async () => {
    try {
      await api.rules.run();
      toast({ tone: 'info', title: 'Đang chạy các rule đang bật trên số liệu đã đồng bộ' });
    } catch (err) {
      onError(err);
    }
  };
  const rules = rulesQ.data ?? [];
  const recent = (histQ.data ?? []).filter((h) => Date.now() - Date.parse(h.decidedAt ?? h.createdAt) < WEEK_MS);
  const applied7 = recent.filter((h) => h.status === 'applied').length;
  const failed7 = recent.filter((h) => h.status === 'failed').length;

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
      <PageHeader title="Rules">
        <Button icon={Play} onClick={runNow} title="Rule tự chạy sau mỗi lần đồng bộ báo cáo">Chạy rule ngay</Button>
      </PageHeader>
      <div className="-mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <SummaryCard icon={Power} tone="success" label="Rule đang bật" value={<>{rules.filter((r) => r.enabled).length}<span className="text-sm font-normal text-muted">/{rules.length}</span></>}
          sub={`${rules.filter((r) => r.enabled && r.mode === 'AUTO').length} tự áp dụng`} onClick={() => setTab('rules')} active={tab === 'rules'} />
        <SummaryCard icon={Inbox} tone={pending ? 'warning' : 'info'} label="Chờ duyệt" value={pending} sub={pending ? 'bấm để duyệt' : 'không có'} onClick={() => setTab('pending')} active={tab === 'pending'} />
        <SummaryCard icon={CheckCircle2} tone="accent" label="Đã áp dụng 7 ngày" value={applied7} sub="duyệt tay + tự áp dụng" onClick={() => setTab('history')} active={tab === 'history'} />
        <SummaryCard icon={AlertOctagon} tone={failed7 ? 'danger' : 'success'} label="Lỗi 7 ngày" value={failed7} sub={failed7 ? 'xem trong Lịch sử' : 'không có'} onClick={() => setTab('history')} />
      </div>
      <div role="tablist" className="flex gap-1 border-b border-border">
        {([['pending', 'Chờ duyệt', pending], ['rules', 'Rule', rules.length], ['history', 'Lịch sử', histQ.data?.length ?? 0]] as const).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm', tab === id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
            {label}
            {n > 0 && <span className={cx('num rounded-full px-1.5 text-[11px] font-semibold', id === 'pending' ? 'bg-warning/12 text-warning' : 'bg-surface-2 text-muted')}>{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'pending' && <PendingTab onRun={runNow} rules={rules} />}
      {tab === 'rules' && <RulesTab rules={rules} loading={rulesQ.isLoading} history={histQ.data ?? []} />}
      {tab === 'history' && <HistoryTab rows={histQ.data} loading={histQ.isLoading} error={histQ.isError} rules={rules} />}
    </div>
  );
}

// ── Ngăn chi tiết một đề xuất ───────────────────────────────────────────────
function SuggestionDrawer({ s, rule, nav, onClose, onApprove, onDismiss, busy }: {
  s: SuggestionRow;
  rule?: RuleWithMeta;
  nav: { index: number; total: number; prev: () => void; next: () => void };
  onClose: () => void;
  onApprove?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
}) {
  const online = useUi((x) => x.online);
  return (
    <Drawer
      width="w-[520px]"
      title={s.name}
      leading={<span className="grid size-9 place-items-center rounded-lg bg-surface-2 text-2xl leading-none" aria-hidden>{s.country ? flag(s.country) : '📣'}</span>}
      subtitle={<><StatusBadge tone={STATUS[s.status][0]}>{STATUS[s.status][1]}</StatusBadge><span>{fmtDateTime(s.createdAt)}</span><span className="font-mono">#{s.campaignId}</span></>}
      nav={nav}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded-lg border border-border bg-surface-2/50 p-4">
          <p className="mb-2 text-xs font-medium text-muted">Thay đổi đề xuất</p>
          <ChangeCell s={s} big />
          <p className="mt-3 text-sm"><span className="text-muted">Vì: </span>{s.reason}</p>
        </section>
        {s.error && <Banner tone="danger">{s.error}</Banner>}
        <section>
          <h3 className="mb-1 text-sm font-semibold">Rule</h3>
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{s.ruleName}</p>
            {rule ? (
              <>
                <p className="mt-0.5 text-muted">{describeRule(rule, fmt)}</p>
                <p className="mt-1 text-xs text-muted">{rule.mode === 'AUTO' ? 'Tự áp dụng' : 'Chỉ đề xuất'} · nghỉ {rule.cooldownHours} giờ · tối đa {rule.maxChangesPerWeek} lần/7 ngày</p>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-muted">Rule đã bị xóa.</p>
            )}
          </div>
        </section>
        {s.decidedAt && <p className="text-xs text-muted">Xử lý lúc {fmtDateTime(s.decidedAt)}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {onApprove && <Button variant="primary" icon={Check} disabled={!online} loading={busy} onClick={onApprove}>Xem trước & áp dụng</Button>}
          {onDismiss && <Button icon={X} onClick={onDismiss}>Bỏ qua</Button>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => navigate('/campaigns')}>Mở Campaigns →</Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Đề xuất chờ duyệt ───────────────────────────────────────────────────────
function PendingTab({ onRun, rules }: { onRun: () => void; rules: RuleWithMeta[] }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const q = useQuery({ queryKey: ['suggestions', 'pending'], queryFn: () => api.rules.suggestions('pending') });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SuggestionRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onError = useErrorHandler();
  const rows = q.data ?? [];
  const picked = rows.filter((r) => sel.has(r.id));
  const refresh = () => {
    setSel(new Set());
    void qc.invalidateQueries({ queryKey: ['suggestions'] });
  };

  const approve = async (items: SuggestionRow[]) => {
    setBusy(true);
    try {
      const r = await api.rules.approve(items.map((i) => i.id));
      toast({ tone: r.failed ? 'warning' : 'success', title: `Đã áp dụng ${r.applied} thay đổi`, detail: r.failed ? `${r.failed} đề xuất không áp được — xem tab Lịch sử` : undefined });
      setPreview(null);
      setOpenId(null);
      refresh();
    } catch (err) {
      // Đề xuất lỗi đã chuyển sang Lịch sử (failed) — đóng xem trước để không bấm lại vào dữ liệu cũ
      onError(err);
      setPreview(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (items: SuggestionRow[]) => {
    try {
      await api.rules.dismiss(items.map((i) => i.id));
      toast({ tone: 'info', title: `Đã bỏ qua ${items.length} đề xuất` });
      if (items.some((i) => i.id === openId)) setOpenId(null);
      refresh();
    } catch (err) {
      onError(err);
    }
  };

  if (q.isLoading) return <Skeleton className="h-60 rounded-lg" />;
  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="Không có đề xuất chờ duyệt" action={<Button icon={Play} onClick={onRun}>Chạy rule ngay</Button>}>
          Rule chạy sau mỗi lần đồng bộ báo cáo (tự động mỗi sáng). Thay đổi rule đề xuất sẽ hiện ở đây để bạn duyệt trước khi ghi lên Google Ads.
        </EmptyState>
      </Card>
    );
  }
  const all = sel.size === rows.length;
  const idx = openId ? rows.findIndex((r) => r.id === openId) : -1;
  const open = idx >= 0 ? rows[idx] : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="sticky -top-6 z-10 flex items-center gap-2 rounded-lg border border-accent/30 bg-surface px-3 py-2 text-sm shadow-sm">
        <span>{sel.size ? <>Đã chọn <b className="num">{sel.size}</b></> : <><b className="num">{rows.length}</b> đề xuất · chọn để duyệt hàng loạt</>}</span>
        <div className="flex-1" />
        <Button size="sm" variant="primary" icon={Check} disabled={!picked.length || !online} onClick={() => setPreview(picked)}>Xem trước & áp dụng</Button>
        <Button size="sm" icon={X} disabled={!picked.length} onClick={() => void dismiss(picked)}>Bỏ qua</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr className="text-left">
              <th className="h-row w-8 px-3"><input type="checkbox" aria-label="Chọn tất cả" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th className="px-2 font-medium">Camp</th>
              <th className="px-2 font-medium">Thay đổi</th>
              <th className="px-2 font-medium">Vì</th>
              <th className="px-2 font-medium">Rule</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const isOpen = openId === r.id;
              return (
                <tr key={r.id} tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}
                  className={cx('group cursor-pointer outline-none', isOpen ? 'bg-selected' : sel.has(r.id) ? 'bg-accent/5' : 'hover:bg-surface-2/70 focus-visible:bg-surface-2/70')}>
                  <td className="relative px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {isOpen && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                    <input type="checkbox" aria-label={`Chọn ${r.name}`} checked={sel.has(r.id)}
                      onChange={() => { const n = new Set(sel); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSel(n); }} />
                  </td>
                  <td className="max-w-64 px-2">
                    <p className="truncate font-medium" title={r.name}>{r.country && <span aria-hidden>{flag(r.country)} </span>}{r.name}</p>
                    <p className="text-xs text-muted">{fmtDateTime(r.createdAt)}</p>
                  </td>
                  <td className="px-2"><ChangeCell s={r} /></td>
                  <td className="max-w-72 px-2 text-xs text-muted"><span className="line-clamp-2">{r.reason}</span></td>
                  <td className="max-w-40 truncate px-2 text-xs" title={r.ruleName}>{r.ruleName}</td>
                  <td className="px-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={Check} aria-label="Áp dụng" title="Áp dụng" disabled={!online} onClick={() => setPreview([r])} />
                      <Button size="sm" variant="ghost" icon={X} aria-label="Bỏ qua" title="Bỏ qua" onClick={() => void dismiss([r])} />
                      <ChevronRight className={cx('size-4 text-muted', isOpen ? 'text-accent' : 'opacity-0 group-hover:opacity-100')} aria-hidden />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {open && (
        <SuggestionDrawer key={open.id} s={open} rule={rules.find((x) => x.id === open.ruleId)} busy={busy}
          nav={{ index: idx, total: rows.length, prev: () => idx > 0 && setOpenId(rows[idx - 1].id), next: () => idx < rows.length - 1 && setOpenId(rows[idx + 1].id) }}
          onClose={() => setOpenId(null)} onApprove={() => setPreview([open])} onDismiss={() => void dismiss([open])} />
      )}
      {preview && (
        <DiffPreview
          changes={preview.map((p) => p.change)}
          currency={preview[0].currency}
          sharedBudgetNames={[]}
          pending={busy}
          onCancel={() => setPreview(null)}
          onConfirm={() => void approve(preview)}
        />
      )}
    </div>
  );
}

// ── Danh sách rule ──────────────────────────────────────────────────────────
function RulesTab({ rules, loading, history }: { rules: RuleWithMeta[]; loading: boolean; history: SuggestionRow[] }) {
  const qc = useQueryClient();
  const pendingQ = useQuery({ queryKey: ['suggestions', 'pending'], queryFn: () => api.rules.suggestions('pending') });
  const [editing, setEditing] = useState<Rule | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tpl, setTpl] = useState('');
  const onError = useErrorHandler();
  const reload = () => void qc.invalidateQueries({ queryKey: ['rules'] });

  const fromTemplate = (i: number) => setEditing({ ...structuredClone(RULE_TEMPLATES[i]), id: crypto.randomUUID() });
  const blank = (): Rule => ({
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    scope: { appId: null, countries: [] },
    window: 'LAST_7_DAYS',
    when: { all: [{ metric: 'spend', op: '>=', value: 50 }] },
    then: { action: 'PAUSE_CAMPAIGN' },
    mode: 'SUGGEST',
    cooldownHours: 72,
    maxChangesPerWeek: 2,
  });
  const toggle = async (r: Rule) => {
    try {
      await api.rules.save({ ...r, enabled: !r.enabled });
      reload();
    } catch (err) {
      onError(err);
    }
  };
  const stats = (id: string) => ({
    pending: (pendingQ.data ?? []).filter((s) => s.ruleId === id).length,
    applied: history.filter((s) => s.ruleId === id && s.status === 'applied').length,
    failed: history.filter((s) => s.ruleId === id && s.status === 'failed').length,
  });
  const idx = openId ? rules.findIndex((r) => r.id === openId) : -1;
  const open = idx >= 0 ? rules[idx] : null;
  const recentOf = (id: string) => [...(pendingQ.data ?? []), ...history].filter((s) => s.ruleId === id);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Plus} onClick={() => setEditing(blank())}>Rule mới</Button>
        <Select className="w-64" value={tpl} aria-label="Tạo từ mẫu" onChange={(e) => { setTpl(''); if (e.target.value) fromTemplate(Number(e.target.value)); }}>
          <option value="">Tạo từ mẫu…</option>
          {RULE_TEMPLATES.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}
        </Select>
        <p className="text-xs text-muted">Mỗi lần chỉnh tối đa ±20%, có thời gian nghỉ và giới hạn số lần/tuần; mọi thay đổi ghi vào nhật ký.</p>
      </div>
      {loading ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : !rules.length ? (
        <Card>
          <EmptyState icon={Workflow} title="Chưa có rule nào" action={<Button variant="primary" icon={Copy} onClick={() => fromTemplate(0)}>Dùng mẫu “{RULE_TEMPLATES[0].name}”</Button>}>
            Rule tự đề xuất tạm dừng camp lỗ, chỉnh tCPI hay ngân sách theo số liệu đã đồng bộ. Mặc định chỉ đề xuất, bạn duyệt rồi mới ghi.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rules.map((r) => {
            const st = stats(r.id);
            return (
              <div key={r.id} role="button" tabIndex={0} aria-label={`Rule ${r.name}`} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}
                className={cx('group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border bg-surface p-4 pl-5 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent',
                  openId === r.id ? 'border-accent/70 ring-2 ring-accent/15' : 'border-border', !r.enabled && 'opacity-75')}>
                <span className={cx('absolute inset-y-0 left-0 w-1', !r.enabled ? 'bg-border' : r.mode === 'AUTO' ? 'bg-warning' : 'bg-accent')} aria-hidden />
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{r.name}</p>
                      <StatusBadge tone={r.mode === 'AUTO' ? 'warning' : 'info'}>{r.mode === 'AUTO' ? 'Tự áp dụng' : 'Đề xuất'}</StatusBadge>
                      {!r.enabled && <StatusBadge tone="neutral">Tắt</StatusBadge>}
                    </div>
                    <p className="mt-1 text-sm text-muted">{describeRule(r, fmt)}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted" onClick={(e) => e.stopPropagation()} title={r.enabled ? 'Đang bật' : 'Đang tắt'}>
                    <input type="checkbox" className="size-4" checked={r.enabled} onChange={() => void toggle(r)} aria-label={`Bật rule ${r.name}`} />
                    Bật
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{r.scope.countries.length ? `Nước: ${r.scope.countries.join(', ')}` : 'Mọi nước'}</span>
                  <span>nghỉ {r.cooldownHours} giờ</span>
                  <span>tối đa {r.maxChangesPerWeek} lần/7 ngày</span>
                  {r.lastRunAt && <span>chạy {fmtDateTime(r.lastRunAt)}</span>}
                </div>
                <div className="flex min-h-7 items-center gap-1.5">
                  {st.pending > 0 && <span className="rounded-full bg-warning/10 px-2 text-xs font-medium text-warning">{st.pending} chờ duyệt</span>}
                  {st.applied > 0 && <span className="rounded-full bg-success/10 px-2 text-xs font-medium text-success">{st.applied} đã áp dụng</span>}
                  {st.failed > 0 && <span className="rounded-full bg-danger/10 px-2 text-xs font-medium text-danger">{st.failed} lỗi</span>}
                  <span className="flex-1" />
                  <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={FlaskConical} onClick={() => setEditing(r)} title="Mở để chạy thử">Chạy thử</Button>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Sửa ${r.name}`} onClick={() => setEditing(r)} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Xóa ${r.name}`} onClick={() => setRemoving(r)} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && (
        <Drawer width="w-[520px]" title={open.name} key={open.id}
          leading={<span className={cx('grid size-9 place-items-center rounded-lg', open.mode === 'AUTO' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent')}><Workflow className="size-5" aria-hidden /></span>}
          subtitle={<><StatusBadge tone={open.enabled ? 'success' : 'neutral'}>{open.enabled ? 'Đang bật' : 'Tắt'}</StatusBadge><span>{open.mode === 'AUTO' ? 'Tự áp dụng' : 'Chỉ đề xuất'}</span>{open.lastRunAt && <span>· chạy {fmtDateTime(open.lastRunAt)}</span>}</>}
          nav={{ index: idx, total: rules.length, prev: () => idx > 0 && setOpenId(rules[idx - 1].id), next: () => idx < rules.length - 1 && setOpenId(rules[idx + 1].id) }}
          onClose={() => setOpenId(null)}>
          <div className="flex flex-col gap-4">
            <section className="rounded-lg border border-border bg-surface-2/50 p-4 text-sm">{describeRule(open, fmt)}</section>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {([['Chờ duyệt', stats(open.id).pending], ['Đã áp dụng', stats(open.id).applied], ['Lỗi', stats(open.id).failed]] as const).map(([k, v]) => (
                <div key={k} className="rounded-md border border-border px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className="num text-left text-lg font-semibold">{v}</dd></div>
              ))}
            </dl>
            <p className="text-xs text-muted">{open.scope.countries.length ? `Quốc gia: ${open.scope.countries.join(', ')}` : 'Mọi quốc gia'} · nghỉ {open.cooldownHours} giờ giữa 2 lần chỉnh · tối đa {open.maxChangesPerWeek} lần/7 ngày · mỗi lần tối đa ±20%</p>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Gần đây</h3>
              {recentOf(open.id).slice(0, 8).map((s) => (
                <div key={s.id} className="mb-1.5 rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={STATUS[s.status][0]}>{STATUS[s.status][1]}</StatusBadge>
                    <span className="truncate font-medium">{s.country && <span aria-hidden>{flag(s.country)} </span>}{s.name}</span>
                  </div>
                  <div className="mt-1"><ChangeCell s={s} /></div>
                </div>
              ))}
              {!recentOf(open.id).length && <p className="text-sm text-muted">Rule chưa tạo đề xuất nào.</p>}
            </section>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Pencil} onClick={() => setEditing(open)}>Sửa & chạy thử</Button>
              <Button icon={Power} onClick={() => void toggle(open)}>{open.enabled ? 'Tắt rule' : 'Bật rule'}</Button>
              <span className="flex-1" />
              <Button variant="ghost" icon={Trash2} onClick={() => setRemoving(open)}>Xóa</Button>
            </div>
          </div>
        </Drawer>
      )}
      {editing && <RuleEditor key={editing.id} initial={editing} isNew={!rules.some((x) => x.id === editing.id)} onClose={() => setEditing(null)} onSaved={() => { reload(); toast({ tone: 'success', title: 'Đã lưu rule' }); }} />}
      {removing && (
        <Dialog title={`Xóa rule “${removing.name}”?`} onClose={() => setRemoving(null)} width="w-[460px]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>Hủy</Button>
              <Button variant="danger" icon={Trash2} onClick={async () => {
                try {
                  await api.rules.remove(removing.id);
                  setRemoving(null);
                  setOpenId(null);
                  reload();
                } catch (err) {
                  onError(err);
                }
              }}>Xóa</Button>
            </>
          }>
          <p className="text-sm">Đề xuất đang chờ của rule này sẽ hết hạn. Thay đổi đã áp dụng trên Google Ads giữ nguyên.</p>
        </Dialog>
      )}
    </div>
  );
}

// ── Lịch sử ─────────────────────────────────────────────────────────────────
type HistFilter = 'all' | SuggestionRow['status'];

function HistoryTab({ rows: data, loading, error, rules }: { rows?: SuggestionRow[]; loading: boolean; error: boolean; rules: RuleWithMeta[] }) {
  const [f, setF] = useState<HistFilter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => {
    const s = query.trim().toLowerCase();
    return all.filter((r) => (f === 'all' || r.status === f) && (!s || r.name.toLowerCase().includes(s) || r.ruleName.toLowerCase().includes(s) || (r.country ?? '').toLowerCase() === s));
  }, [all, f, query]);
  if (loading) return <Skeleton className="h-60 rounded-lg" />;
  if (error) return <Banner tone="danger">Không đọc được lịch sử.</Banner>;
  if (!all.length) return <Card><EmptyState icon={Inbox} title="Chưa có lịch sử">Đề xuất đã duyệt, bỏ qua hoặc rule tự áp dụng sẽ hiện ở đây.</EmptyState></Card>;
  const count = (s: SuggestionRow['status']) => all.filter((r) => r.status === s).length;
  const idx = openId ? rows.findIndex((r) => r.id === openId) : -1;
  const open = idx >= 0 ? rows[idx] : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Tìm camp, rule, mã nước" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm trong lịch sử" />
        </div>
        <FilterChips label="Lọc trạng thái" value={f} onChange={setF}
          chips={[
            { id: 'all', label: 'Tất cả', count: all.length },
            { id: 'applied', label: 'Đã áp dụng', count: count('applied'), tone: 'success' },
            { id: 'failed', label: 'Lỗi', count: count('failed'), tone: 'danger' },
            { id: 'dismissed', label: 'Bỏ qua', count: count('dismissed') },
            { id: 'expired', label: 'Hết hạn', count: count('expired') },
          ]} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr className="text-left">
              <th className="h-row px-3 font-medium">Lúc</th>
              <th className="px-2 font-medium">Trạng thái</th>
              <th className="px-2 font-medium">Camp</th>
              <th className="px-2 font-medium">Thay đổi</th>
              <th className="px-2 font-medium">Rule</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const isOpen = openId === r.id;
              return (
                <tr key={r.id} tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}
                  className={cx('group cursor-pointer outline-none', isOpen ? 'bg-selected' : 'hover:bg-surface-2/70 focus-visible:bg-surface-2/70')}>
                  <td className="relative px-3 py-2 text-xs whitespace-nowrap text-muted">
                    {isOpen && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                    {fmtDateTime(r.decidedAt ?? r.createdAt)}
                  </td>
                  <td className="px-2">
                    <StatusBadge tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</StatusBadge>
                    {r.error && <p className="mt-0.5 max-w-60 truncate text-xs text-danger" title={r.error}>{r.error}</p>}
                  </td>
                  <td className="max-w-64 truncate px-2" title={r.name}>{r.country && <span aria-hidden>{flag(r.country)} </span>}{r.name}</td>
                  <td className="px-2"><ChangeCell s={r} /></td>
                  <td className="max-w-48 truncate px-2 text-xs">{r.ruleName}</td>
                  <td className="pr-2"><ChevronRight className={cx('size-4 text-muted', isOpen ? 'text-accent' : 'opacity-0 group-hover:opacity-100')} aria-hidden /></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-muted">Không có mục khớp bộ lọc</td></tr>}
          </tbody>
        </table>
      </Card>
      {open && (
        <SuggestionDrawer key={open.id} s={open} rule={rules.find((x) => x.id === open.ruleId)}
          nav={{ index: idx, total: rows.length, prev: () => idx > 0 && setOpenId(rows[idx - 1].id), next: () => idx < rows.length - 1 && setOpenId(rows[idx + 1].id) }}
          onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
