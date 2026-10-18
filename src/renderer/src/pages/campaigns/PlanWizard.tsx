import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  Loader2,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react';
import { flag, getCountry } from '@shared/geo';
import {
  adsCampaignUrl,
  CountryRowSchema,
  GOALS,
  issueMap,
  newRow,
  PlanSchema,
  type CountryRow,
  type PlanDraft,
  type PlanRecord,
  type RowResult,
  type ValidateResult,
} from '@shared/plan';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAdsCustomers, useApps } from '@/lib/queries';
import { navigate, useUi } from '@/lib/store';
import { fmtMoney } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Field, Select, StatusBadge, cx, type Tone } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { CountryPicker } from './CountryPicker';
import { PlanGrid, type RowErrors } from './PlanGrid';
import { usePlanDraft } from './usePlanDraft';

const STEPS = ['App', 'Quốc gia', 'Cấu hình', 'Kiểm tra'] as const;

export function PlanWizard() {
  const { draft, update, reset } = usePlanDraft();
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [created, setCreated] = useState<PlanRecord | null>(null);

  if (!draft) return <Card className="h-64 skeleton">{null}</Card>;
  if (created) {
    return (
      <PlanResults
        initial={created}
        onNew={() => {
          setCreated(null);
          setValidation(null);
          reset();
        }}
      />
    );
  }

  const setStep = (step: number) => update(() => ({ step }));
  // Sửa dữ liệu thì kết quả kiểm tra cũ hết hiệu lực
  const setRows = (rows: CountryRow[]) => {
    setValidation(null);
    update(() => ({ rows }));
  };

  return (
    <div className="flex flex-col gap-4">
      <Stepper step={draft.step} draft={draft} onStep={setStep} />
      {draft.step === 0 && <AppStep draft={draft} update={update} onNext={() => setStep(1)} />}
      {draft.step === 1 && (
        <CountryStep draft={draft} setRows={setRows} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      )}
      {draft.step === 2 && <ConfigStep draft={draft} setRows={setRows} validation={validation} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {draft.step === 3 && (
        <ReviewStep
          draft={draft}
          validation={validation}
          setValidation={setValidation}
          onBack={() => setStep(2)}
          onFix={() => setStep(2)}
          onCreated={(rec) => {
            void api.plans.saveDraft(null);
            setCreated(rec);
          }}
          onReset={() => {
            setValidation(null);
            reset();
          }}
        />
      )}
    </div>
  );
}

// ── Thanh bước ─────────────────────────────────────────────────────────────
function stepReady(d: PlanDraft, i: number) {
  if (i === 0) return !!d.appId && !!d.customerId;
  if (i === 1) return d.rows.length > 0;
  return true;
}

function Stepper({ step, draft, onStep }: { step: number; draft: PlanDraft; onStep: (s: number) => void }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Các bước tạo kế hoạch">
      {STEPS.map((s, i) => {
        const done = i < step;
        const reachable = STEPS.slice(0, i).every((_, j) => stepReady(draft, j));
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className={cx('h-px w-8', done || i === step ? 'bg-accent' : 'bg-border')} aria-hidden />}
            <button
              disabled={!reachable}
              onClick={() => onStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cx(
                'flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm disabled:opacity-50',
                i === step ? 'bg-accent text-accent-fg font-medium' : done ? 'text-accent hover:bg-accent/10' : 'text-muted hover:bg-surface-2',
              )}
            >
              <span className={cx('flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                i === step ? 'bg-white/20' : done ? 'bg-accent/15' : 'bg-surface-2')}>
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {s}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Nav({ onBack, onNext, nextLabel = 'Tiếp', nextDisabled, reason }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; reason?: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-border pt-4">
      {onBack && <Button icon={ArrowLeft} onClick={onBack}>Quay lại</Button>}
      <div className="flex-1" />
      {nextDisabled && reason && <span className="text-sm text-muted">{reason}</span>}
      {onNext && (
        <Button variant="primary" disabled={nextDisabled} onClick={onNext}>
          {nextLabel} <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}

// ── Bước 1: App + tài khoản ────────────────────────────────────────────────
function AppStep({ draft, update, onNext }: { draft: PlanDraft; update: (fn: (d: PlanDraft) => Partial<PlanDraft>) => void; onNext: () => void }) {
  const { data: apps = [], isLoading } = useApps();
  const { data: customers = [] } = useAdsCustomers();
  const leaf = customers.filter((c) => !c.manager);

  if (!isLoading && apps.length === 0) {
    return (
      <Card>
        <EmptyState icon={Smartphone} title="Chưa có app nào" action={<Button variant="primary" onClick={() => navigate('/settings')}>Mở Cài đặt → App</Button>}>
          Thêm app (package name hoặc App Store ID) trước khi lên kế hoạch camp.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2" role="radiogroup" aria-label="Chọn app">
        {apps.map((a) => {
          const on = draft.appId === a.id;
          return (
            <button
              key={a.id}
              role="radio"
              aria-checked={on}
              onClick={() => update((d) => ({ appId: a.id, customerId: a.adsCustomerId ?? d.customerId }))}
              className={cx('flex items-start gap-3 rounded-lg border p-3 text-left', on ? 'border-accent bg-accent/5 ring-2 ring-accent/30' : 'border-border hover:bg-surface-2')}
            >
              <span className={cx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted')}>
                <Smartphone className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block truncate font-mono text-xs text-muted">{a.storeAppId}</span>
                <span className="text-xs text-muted">{a.store === 'GOOGLE_PLAY' ? 'Google Play' : 'App Store'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 max-w-md">
        <Field label="Tài khoản Google Ads tạo camp" hint={leaf.length ? 'Lấy theo app đã map; đổi được nếu cần' : 'Chưa có tài khoản Ads — kết nối trong Cài đặt'}>
          <Select value={draft.customerId ?? ''} onChange={(e) => update(() => ({ customerId: e.target.value || null }))}>
            <option value="">Chọn tài khoản…</option>
            {leaf.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {c.name} · {c.customerId} · {c.currency}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-5">
        <Nav onNext={onNext} nextDisabled={!stepReady(draft, 0)} reason={!draft.appId ? 'Chọn app' : 'Chọn tài khoản Google Ads'} />
      </div>
    </Card>
  );
}

// ── Bước 2: Quốc gia ───────────────────────────────────────────────────────
function CountryStep({ draft, setRows, onBack, onNext }: { draft: PlanDraft; setRows: (r: CountryRow[]) => void; onBack: () => void; onNext: () => void }) {
  const codes = draft.rows.map((r) => r.countryCode);
  const onChange = (next: string[]) => {
    // Dòng mới lấy cấu hình của dòng đầu tiên (ngân sách, mục tiêu, text, video) để đỡ nhập lại
    const base = draft.rows[0];
    const keep = new Map(draft.rows.map((r) => [r.countryCode, r]));
    setRows(
      next.map(
        (c) =>
          keep.get(c) ??
          newRow(c, base && { dailyBudget: base.dailyBudget, goal: base.goal, target: base.target, conversionActions: base.conversionActions,
            headlines: base.headlines, descriptions: base.descriptions, videoIds: base.videoIds, imageAssetIds: base.imageAssetIds }),
      ),
    );
  };
  return (
    <Card className="p-5">
      <CountryPicker value={codes} onChange={onChange} />
      <div className="mt-5">
        <Nav onBack={onBack} onNext={onNext} nextDisabled={!codes.length} reason="Chọn ít nhất 1 quốc gia" />
      </div>
    </Card>
  );
}

// ── Lỗi: zod cục bộ + lỗi Google gộp theo dòng/ô ──────────────────────────
function useRowErrors(draft: PlanDraft, validation: ValidateResult | null): RowErrors {
  return useMemo(() => {
    const out: RowErrors = {};
    draft.rows.forEach((r, i) => {
      const local = issueMap(CountryRowSchema.safeParse(r).error);
      const google = Object.fromEntries((validation?.rows[r.countryCode]?.errors ?? []).filter((e) => e.field).map((e) => [e.field, e.message]));
      const merged = { ...google, ...local };
      if (Object.keys(merged).length) out[i] = merged;
    });
    return out;
  }, [draft.rows, validation]);
}

// ── Bước 3: Bảng cấu hình ──────────────────────────────────────────────────
function ConfigStep({ draft, setRows, validation, onBack, onNext }: { draft: PlanDraft; setRows: (r: CountryRow[]) => void; validation: ValidateResult | null; onBack: () => void; onNext: () => void }) {
  const { data: customers = [] } = useAdsCustomers();
  const currency = customers.find((c) => c.customerId === draft.customerId)?.currency ?? 'USD';
  const errors = useRowErrors(draft, validation);
  const nErr = Object.keys(errors).length;
  const [json, setJson] = useState<string | null>(null);
  const [jsonErr, setJsonErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">
          <span className="num font-medium text-text">{draft.rows.length}</span> quốc gia · tiền tệ <b>{currency}</b> · camp tạo ở trạng thái <b>Tạm dừng</b>
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={Braces} onClick={() => {
          setJsonErr(null);
          setJson(JSON.stringify(draft.rows, null, 2));
        }}>
          Sửa dạng JSON
        </Button>
      </div>
      <PlanGrid rows={draft.rows} onRows={setRows} errors={errors} currency={currency} customerId={draft.customerId} appId={draft.appId} />
      <Nav onBack={onBack} onNext={onNext} nextLabel="Kiểm tra" nextDisabled={nErr > 0} reason={`${nErr} dòng còn lỗi — xem ô viền đỏ`} />

      {json != null && (
        <Dialog
          title="Sửa kế hoạch dạng JSON"
          onClose={() => setJson(null)}
          width="w-[760px]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setJson(null)}>Hủy</Button>
              <Button variant="primary" onClick={() => {
                try {
                  const parsed = z.array(z.object({ countryCode: z.string() }).loose()).parse(JSON.parse(json));
                  setRows(parsed.map((r) => newRow(r.countryCode.toUpperCase(), r as Partial<CountryRow>)));
                  setJson(null);
                } catch (e) {
                  setJsonErr(e instanceof z.ZodError ? 'Mỗi phần tử cần có countryCode' : (e as Error).message);
                }
              }}>
                Áp dụng
              </Button>
            </>
          }
        >
          <textarea
            className="h-96 w-full rounded-sm border border-border bg-surface-2 p-2 font-mono text-xs outline-none focus:border-accent"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            aria-label="JSON kế hoạch"
          />
          {jsonErr && <p className="mt-2 text-sm text-danger" role="alert">{jsonErr}</p>}
        </Dialog>
      )}
    </div>
  );
}

// ── Bước 4: Kiểm tra + Tạo ─────────────────────────────────────────────────
const ROW_TONE: Record<RowResult['state'], [Tone, string]> = {
  pending: ['neutral', 'Chờ'],
  running: ['info', 'Đang tạo'],
  done: ['success', 'Hợp lệ'],
  exists: ['warning', 'Đã có'],
  failed: ['danger', 'Lỗi'],
};

function ReviewStep({
  draft,
  validation,
  setValidation,
  onBack,
  onFix,
  onCreated,
  onReset,
}: {
  draft: PlanDraft;
  validation: ValidateResult | null;
  setValidation: (v: ValidateResult | null) => void;
  onBack: () => void;
  onFix: () => void;
  onCreated: (r: PlanRecord) => void;
  onReset: () => void;
}) {
  const online = useUi((s) => s.online);
  const { data: customers = [] } = useAdsCustomers();
  const { data: apps = [] } = useApps();
  const app = apps.find((a) => a.id === draft.appId);
  const currency = customers.find((c) => c.customerId === draft.customerId)?.currency ?? 'USD';
  const onError = useErrorHandler();
  const [busy, setBusy] = useState<'validate' | 'create' | null>(null);

  const plan = PlanSchema.safeParse({ id: draft.id, appId: draft.appId, customerId: draft.customerId, rows: draft.rows });
  const names = useQuery({
    queryKey: ['planNames', draft.id, draft.rows.map((r) => `${r.countryCode}:${r.goal}`).join(','), draft.appId],
    queryFn: () => api.plans.previewNames(plan.data!),
    enabled: plan.success,
  });
  const total = draft.rows.reduce((s, r) => s + (r.dailyBudget || 0), 0);
  const failed = validation ? Object.values(validation.rows).filter((r) => r.state === 'failed').length : 0;
  const exists = validation ? Object.values(validation.rows).filter((r) => r.state === 'exists').length : 0;

  async function validate() {
    if (!plan.success) return onFix();
    setBusy('validate');
    try {
      setValidation(await api.plans.validate(plan.data));
    } catch (err) {
      onError(err, validate);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!plan.success) return;
    setBusy('create');
    try {
      const { plan: rec } = await api.plans.create(plan.data);
      toast({ tone: 'info', title: `Đang tạo ${draft.rows.length} camp ở nền`, detail: 'Theo dõi trong hàng đợi job (⌘/Ctrl J)' });
      onCreated(rec);
    } catch (err) {
      onError(err, create);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span><span className="text-muted">App</span> <b>{app?.name}</b></span>
        <span><span className="text-muted">Tài khoản</span> <span className="num font-medium">{draft.customerId}</span></span>
        <span><span className="text-muted">Quốc gia</span> <span className="num font-medium">{draft.rows.length}</span></span>
        <span><span className="text-muted">Tổng ngân sách/ngày</span> <span className="num font-semibold">{fmtMoney(total, currency)}</span></span>
        <StatusBadge tone="neutral">Tạo ở trạng thái Tạm dừng</StatusBadge>
      </div>

      {validation && (
        <div className="mb-3 overflow-hidden rounded-lg border border-border">
          {validation.ok ? (
            <Banner tone="success">
              Google xác nhận hợp lệ {draft.rows.length - exists}/{draft.rows.length} quốc gia{exists ? ` · ${exists} camp đã có sẵn sẽ được bỏ qua` : ''}.
            </Banner>
          ) : (
            <Banner tone="danger" action={<Button size="sm" variant="primary" onClick={onFix}>Sửa trên bảng</Button>}>
              {failed} quốc gia bị Google từ chối — ô lỗi đã được tô đỏ ở bước Cấu hình.
            </Banner>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr className="text-left">
              <th className="h-row px-3 font-medium">Quốc gia</th>
              <th className="px-3 font-medium">Tên camp</th>
              <th className="px-3 font-medium">Mục tiêu</th>
              <th className="px-3 text-right font-medium">Ngân sách/ngày</th>
              <th className="px-3 font-medium">Kiểm tra</th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((r) => {
              const v = validation?.rows[r.countryCode];
              return (
                <tr key={r.countryCode} className="border-t border-border/60 align-top">
                  <td className="h-row px-3 py-2 whitespace-nowrap">
                    <span aria-hidden>{flag(r.countryCode)}</span> <span className="font-mono text-xs">{r.countryCode}</span> {getCountry(r.countryCode)?.name}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" data-selectable>{names.data?.[r.countryCode] ?? '…'}</td>
                  <td className="px-3 py-2 text-muted">{GOALS[r.goal].short}{r.target != null && ` · ${GOALS[r.goal].target === 'ratio' ? `${Math.round(r.target * 100)}%` : fmtMoney(r.target, currency)}`}</td>
                  <td className="num px-3 py-2 text-right">{fmtMoney(r.dailyBudget, currency)}</td>
                  <td className="px-3 py-2">
                    {busy === 'validate' ? (
                      <Loader2 className="size-4 animate-spin text-muted" aria-label="Đang kiểm tra" />
                    ) : v ? (
                      <div className="flex flex-col gap-1">
                        <StatusBadge tone={ROW_TONE[v.state][0]}>{v.state === 'exists' ? 'Đã có — bỏ qua' : ROW_TONE[v.state][1]}</StatusBadge>
                        {v.errors?.map((e, k) => (
                          <span key={k} className="text-xs text-danger" data-selectable>
                            {e.field && <span className="font-mono">{e.field}: </span>}
                            {e.message}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Chưa kiểm tra</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
        <Button icon={ArrowLeft} onClick={onBack}>Quay lại</Button>
        <Button variant="ghost" icon={RotateCcw} onClick={() => window.confirm('Xóa bản nháp và bắt đầu lại?') && onReset()}>
          Bắt đầu lại
        </Button>
        <div className="flex-1" />
        {!online && <span className="text-sm text-warning">Mất mạng — chưa thể kiểm tra/tạo</span>}
        <Button icon={ShieldCheck} loading={busy === 'validate'} disabled={!online || !!busy} onClick={() => void validate()}>
          {validation ? 'Kiểm tra lại' : 'Kiểm tra với Google'}
        </Button>
        <Button variant="primary" icon={Rocket} loading={busy === 'create'} disabled={!online || !!busy || !validation?.ok}
          title={!validation?.ok ? 'Cần kiểm tra hợp lệ trước khi tạo' : undefined} onClick={() => void create()}>
          Tạo {draft.rows.length - exists} camp
        </Button>
      </div>
    </Card>
  );
}

// ── Kết quả: tiến trình từng quốc gia, link Google Ads, thử lại quốc gia lỗi ──
export function PlanResults({ initial, onNew }: { initial: PlanRecord; onNew?: () => void }) {
  const onError = useErrorHandler();
  const online = useUi((s) => s.online);
  // Sự kiện 'plan' từ main cập nhật cache ['plan', id] mỗi khi một quốc gia xong
  const { data: rec = initial } = useQuery({ queryKey: ['plan', initial.id], queryFn: () => api.plans.get(initial.id), initialData: initial });
  const results = Object.entries(rec.results);
  const finished = results.filter(([, r]) => r.state === 'done' || r.state === 'exists' || r.state === 'failed').length;
  const ok = results.filter(([, r]) => r.state === 'done' || r.state === 'exists').length;
  const failed = results.filter(([, r]) => r.state === 'failed').length;
  const running = finished < results.length;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-3">
        {running ? <Loader2 className="size-5 animate-spin text-accent" aria-hidden /> : failed ? <XCircle className="size-5 text-danger" aria-hidden /> : <CheckCircle2 className="size-5 text-success" aria-hidden />}
        <div className="flex-1">
          <p className="font-semibold">
            {running ? 'Đang tạo camp…' : failed ? `${ok}/${results.length} quốc gia thành công` : `Đã tạo xong ${results.length} quốc gia`}
          </p>
          <p className="text-sm text-muted">{rec.appName} · tài khoản <span className="num">{rec.customerId}</span> · bản {rec.version}</p>
        </div>
        <span className="num text-lg font-semibold" aria-live="polite">{finished}/{results.length}</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={results.length} aria-valuenow={finished}>
        <div className="brand-gradient h-full transition-[width]" style={{ width: `${(finished / Math.max(1, results.length)) * 100}%` }} />
      </div>

      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {results.map(([code, r]) => (
          <li key={code} className="flex items-start gap-3 px-3 py-2 text-sm">
            <span className="w-16 shrink-0 pt-0.5"><span aria-hidden>{flag(code)}</span> <span className="font-mono text-xs">{code}</span></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs" data-selectable>{r.name}</p>
              {r.errors?.map((e, k) => (
                <p key={k} className="text-xs text-danger" data-selectable>
                  {e.field && <span className="font-mono">{e.field}: </span>}{e.message}
                  {e.code && <span className="ml-1 font-mono text-muted">{e.code}</span>}
                </p>
              ))}
              {r.requestId && <p className="font-mono text-xs text-muted" data-selectable>request_id {r.requestId}</p>}
            </div>
            <StatusBadge tone={ROW_TONE[r.state][0]}>{r.state === 'done' ? 'Đã tạo' : r.state === 'exists' ? 'Đã có sẵn' : ROW_TONE[r.state][1]}</StatusBadge>
            {r.campaignId && (
              <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => void api.app.openExternal(adsCampaignUrl(rec.customerId, r.campaignId!))}>
                Google Ads
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        {failed > 0 && !running && (
          <Button variant="primary" icon={RotateCcw} disabled={!online} onClick={() => api.plans.retry(rec.id).catch((e) => onError(e))}>
            Thử lại {failed} quốc gia lỗi
          </Button>
        )}
        <div className="flex-1" />
        {onNew && <Button icon={FilePlus2} onClick={onNew}>Kế hoạch mới</Button>}
      </div>
    </Card>
  );
}
