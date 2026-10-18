import { useMemo, useState } from 'react';
import { FlaskConical, Plus, Save, Trash2 } from 'lucide-react';
import { ACTIONS, MAX_CHANGE_PCT, METRICS, RuleSchema, WINDOWS, type Condition, type Metric, type Rule, type RuleTestResult } from '@shared/rules';
import { flag } from '@shared/geo';
import { api } from '@/lib/api';
import { useApps } from '@/lib/queries';
import { Dialog } from '@/components/dialog';
import { Banner, Button, Field, Input, Select } from '@/components/ui';
import { useErrorHandler } from '@/components/connect';
import { fmtChangeValue } from '@/components/DiffPreview';

// Dựng rule bằng câu: "Nếu [ROAS] [<] [30%] (7 ngày) thì [Tạm dừng camp]" — không cần viết JSON.
// Số nhập theo đơn vị người dùng quen: ROAS bằng %, tiền bằng đơn vị tiền tệ.

const toInput = (m: Metric, v: number | undefined) => (v == null ? '' : METRICS[m].kind === 'ratio' ? String(Math.round(v * 1000) / 10) : String(v));
const fromInput = (m: Metric, s: string) => {
  const n = Number(s.trim().replace(',', '.'));
  if (!s.trim() || !Number.isFinite(n)) return undefined;
  return METRICS[m].kind === 'ratio' ? n / 100 : n;
};
const unit = (m: Metric) => (METRICS[m].kind === 'ratio' ? '%' : METRICS[m].kind === 'money' ? 'tiền' : '');

export function RuleEditor({ initial, isNew, onClose, onSaved }: { initial: Rule; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const { data: apps = [] } = useApps();
  const onError = useErrorHandler();
  const [r, setR] = useState<Rule>(initial);
  const [countryText, setCountryText] = useState(initial.scope.countries.join(', '));
  const [valueText, setValueText] = useState(() => initial.when.all.map((c) => toInput(c.metric, c.value)));
  const [test, setTest] = useState<RuleTestResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);

  // Ghép giá trị đang gõ vào rule rồi kiểm tra bằng đúng schema của main
  const candidate: Rule = useMemo(
    () => ({
      ...r,
      scope: { ...r.scope, countries: countryText.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) },
      when: { all: r.when.all.map((c, i) => (c.ref ? { ...c, value: undefined } : { ...c, value: fromInput(c.metric, valueText[i] ?? '') })) },
    }),
    [r, countryText, valueText],
  );
  const parsed = RuleSchema.safeParse(candidate);
  const issues = new Map(parsed.success ? [] : parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
  const issue = (path: string) => [...issues].find(([k]) => k === path || k.startsWith(`${path}.`))?.[1];

  const setCond = (i: number, patch: Partial<Condition>) => setR({ ...r, when: { all: r.when.all.map((c, k) => (k === i ? { ...c, ...patch } : c)) } });
  const addCond = () => {
    setR({ ...r, when: { all: [...r.when.all, { metric: 'spend', op: '>=', value: 0 }] } });
    setValueText([...valueText, '']);
  };
  const removeCond = (i: number) => {
    setR({ ...r, when: { all: r.when.all.filter((_, k) => k !== i) } });
    setValueText(valueText.filter((_, k) => k !== i));
  };

  const runTest = async () => {
    if (!parsed.success) return;
    setBusy('test');
    try {
      setTest(await api.rules.test(parsed.data));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!parsed.success) return;
    setBusy('save');
    try {
      await api.rules.save(parsed.data);
      onSaved();
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const action = r.then.action;
  return (
    <Dialog
      title={isNew ? 'Rule mới' : `Sửa rule · ${initial.name}`}
      onClose={onClose}
      width="w-[860px]"
      footer={
        <>
          <Button icon={FlaskConical} loading={busy === 'test'} disabled={!parsed.success} onClick={runTest} className="mr-auto">
            Chạy thử với dữ liệu hôm nay
          </Button>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" icon={Save} loading={busy === 'save'} disabled={!parsed.success} onClick={save}>Lưu rule</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tên rule" htmlFor="rn" error={issue('name')}>
          <Input id="rn" value={r.name} invalid={!!issue('name')} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Pause quốc gia ROAS thấp" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="App" htmlFor="ra">
            <Select id="ra" value={r.scope.appId ?? ''} onChange={(e) => setR({ ...r, scope: { ...r.scope, appId: e.target.value || null } })}>
              <option value="">Mọi app</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Quốc gia (mã, cách nhau dấu phẩy)" htmlFor="rc" error={issue('scope')} hint="Bỏ trống = mọi quốc gia">
            <Input id="rc" className="font-mono" value={countryText} invalid={!!issue('scope')} onChange={(e) => setCountryText(e.target.value)} placeholder="US, VN, BR" />
          </Field>
          <Field label="Xét số liệu" htmlFor="rw">
            <Select id="rw" value={r.window} onChange={(e) => setR({ ...r, window: e.target.value as Rule['window'] })}>
              {Object.entries(WINDOWS).map(([k, n]) => <option key={k} value={k}>{n} ngày gần nhất (trọn ngày)</option>)}
            </Select>
          </Field>
        </div>

        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-sm font-semibold">Nếu <span className="font-normal text-muted">(tất cả điều kiện đều đúng)</span></p>
          <div className="flex flex-col gap-2">
            {r.when.all.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                {i > 0 && <span className="w-6 text-xs text-muted">và</span>}
                {i === 0 && <span className="w-6" />}
                <Select className="w-40" aria-label={`Chỉ số ${i + 1}`} value={c.metric}
                  onChange={(e) => {
                    const m = e.target.value as Metric;
                    setCond(i, { metric: m, ref: m === 'cpi' ? c.ref : m === 'roas' && c.ref ? 'targetRoas' : undefined });
                  }}>
                  {Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </Select>
                <Select className="w-20" aria-label={`Phép so sánh ${i + 1}`} value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Condition['op'] })}>
                  {['>', '>=', '<', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
                {(c.metric === 'cpi' || c.metric === 'roas') && (
                  <Select className="w-44" aria-label={`So với ${i + 1}`} value={c.ref ?? ''}
                    onChange={(e) => setCond(i, e.target.value ? { ref: e.target.value as Condition['ref'], factor: c.factor ?? 1 } : { ref: undefined, factor: undefined })}>
                    <option value="">một con số</option>
                    <option value={c.metric === 'cpi' ? 'targetCpi' : 'targetRoas'}>{c.metric === 'cpi' ? 'tCPI của camp ×' : 'tROAS của camp ×'}</option>
                  </Select>
                )}
                {c.ref ? (
                  <Input className="num w-24" aria-label={`Hệ số ${i + 1}`} value={String(c.factor ?? 1)} onChange={(e) => setCond(i, { factor: Number(e.target.value.replace(',', '.')) || undefined })} />
                ) : (
                  <span className="flex items-center gap-1">
                    <Input className="num w-28" aria-label={`Giá trị ${i + 1}`} value={valueText[i] ?? ''} invalid={!!issue(`when.all.${i}`)}
                      onChange={(e) => setValueText(valueText.map((v, k) => (k === i ? e.target.value : v)))} />
                    <span className="text-xs text-muted">{unit(c.metric)}</span>
                  </span>
                )}
                {r.when.all.length > 1 && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Bỏ điều kiện ${i + 1}`} onClick={() => removeCond(i)} />}
              </div>
            ))}
            {issue('when') && <p className="text-xs text-danger">{issue('when')}</p>}
            {r.when.all.length < 6 && <Button size="sm" variant="ghost" icon={Plus} className="self-start" onClick={addCond}>Thêm điều kiện</Button>}
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-sm font-semibold">Thì</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Hành động" htmlFor="rt">
              <Select id="rt" className="w-52" value={action}
                onChange={(e) => setR({ ...r, then: { action: e.target.value as Rule['then']['action'], ...(e.target.value === 'PAUSE_CAMPAIGN' ? {} : { changePct: r.then.changePct ?? -10 }) } })}>
                {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            {action !== 'PAUSE_CAMPAIGN' && (
              <>
                <Field label={`Thay đổi (%, tối đa ±${MAX_CHANGE_PCT})`} htmlFor="rp" error={issue('then.changePct')}>
                  <Input id="rp" className="num w-28" value={r.then.changePct ?? ''} invalid={!!issue('then.changePct')}
                    onChange={(e) => setR({ ...r, then: { ...r.then, changePct: e.target.value === '' || e.target.value === '-' ? undefined : Number(e.target.value) } })} />
                </Field>
                <Field label="Sàn (không thấp hơn)" htmlFor="rf" hint={action === 'ADJUST_BUDGET' ? 'Ngân sách/ngày' : 'tCPI (tiền) hoặc tROAS (tỉ lệ)'}>
                  <Input id="rf" className="num w-28" value={r.then.floor ?? ''} onChange={(e) => setR({ ...r, then: { ...r.then, floor: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                </Field>
                <Field label="Trần (không cao hơn)" htmlFor="rce">
                  <Input id="rce" className="num w-28" value={r.then.ceiling ?? ''} onChange={(e) => setR({ ...r, then: { ...r.then, ceiling: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                </Field>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Chế độ" htmlFor="rm">
            <Select id="rm" value={r.mode} onChange={(e) => setR({ ...r, mode: e.target.value as Rule['mode'] })}>
              <option value="SUGGEST">Đề xuất — chờ tôi duyệt</option>
              <option value="AUTO">Tự áp dụng</option>
            </Select>
          </Field>
          <Field label="Nghỉ sau mỗi lần chỉnh (giờ)" htmlFor="rcd" hint="Tránh đổi liên tục khi camp đang học" error={issue('cooldownHours')}>
            <Input id="rcd" className="num" value={r.cooldownHours} onChange={(e) => setR({ ...r, cooldownHours: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Tối đa số lần chỉnh / 7 ngày" htmlFor="rmx" error={issue('maxChangesPerWeek')}>
            <Input id="rmx" className="num" value={r.maxChangesPerWeek} onChange={(e) => setR({ ...r, maxChangesPerWeek: Number(e.target.value) || 1 })} />
          </Field>
        </div>
        {r.mode === 'AUTO' && (
          <Banner tone="warning">Tự áp dụng sẽ ghi thẳng lên Google Ads sau mỗi lần đồng bộ, không hỏi lại. Nên chạy ở chế độ Đề xuất vài ngày, thấy đúng rồi mới bật.</Banner>
        )}

        {test && <TestResult result={test} />}
      </div>
    </Dialog>
  );
}

function TestResult({ result }: { result: RuleTestResult }) {
  const { suggestions, skipped, campaigns, currency } = result;
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
      <p className="mb-2 font-semibold">
        Chạy thử trên {campaigns} camp: <span className="text-accent">{suggestions.length} camp sẽ bị tác động</span>
        {skipped.length > 0 && <span className="font-normal text-muted"> · {skipped.length} khớp điều kiện nhưng bị bỏ qua</span>}
      </p>
      {campaigns === 0 && <p className="text-muted">Chưa có số liệu camp — đồng bộ báo cáo ở màn Analytics trước.</p>}
      {suggestions.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr><th className="py-1 text-left font-medium">Camp</th><th className="text-left font-medium">Thay đổi</th><th className="text-left font-medium">Vì</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {suggestions.map((s) => (
              <tr key={s.campaignId}>
                <td className="max-w-56 truncate py-1.5 pr-2" title={s.name}>{s.country && <span aria-hidden>{flag(s.country)} </span>}{s.name}</td>
                <td className="pr-2 whitespace-nowrap">
                  <span className="num">{fmtChangeValue(s.change.field, s.change.before, currency)}</span> → <b className="num">{fmtChangeValue(s.change.field, s.change.after, currency)}</b>
                </td>
                <td className="text-muted">{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {skipped.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">Xem {skipped.length} camp bị bỏ qua</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {skipped.map((s) => <li key={s.campaignId}>{s.name}: {s.reason}</li>)}
          </ul>
        </details>
      )}
      <p className="mt-2 text-xs text-muted">Chạy thử không ghi gì lên Google Ads. Số tiền tính theo {currency}.</p>
    </div>
  );
}

