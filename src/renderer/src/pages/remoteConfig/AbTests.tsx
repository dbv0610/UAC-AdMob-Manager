import { useMemo, useState } from 'react';
import { FlaskConical, Plus, Trash2, X } from 'lucide-react';
import { abConditionName, abExperiments, allParameters, applyAbPlan, checkAbPlan, consoleManaged, removeAbExperiment, type AbPlan, type ConditionRule } from '@shared/remoteConfig';
import { Banner, Button, Card, EmptyState, Field, Input, Select } from '@/components/ui';
import { RulesBuilder } from './Conditions';
import type { Draft } from '.';

// A/B tự quản: chia nhóm bằng percent(seed) trong điều kiện Remote Config.
// A/B Testing chính thức của Firebase không có API tạo thí nghiệm — chỉ tạo được trên Console.
export function AbTests({ d }: { d: Draft }) {
  const [creating, setCreating] = useState(false);
  const exps = useMemo(() => abExperiments(d.template), [d.template]);
  const managed = consoleManaged(d.template);
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <Banner tone="info">
          Chia người dùng ngẫu nhiên theo % bằng điều kiện <span className="font-mono text-xs">percent('seed')</span> — cùng seed thì một người luôn ở cùng nhóm. Firebase không tự phân tích kết quả như A/B Testing trên Console:
          để so sánh, ghi user property theo nhóm trong code app (đọc từ chính tham số) rồi xem trong Analytics. A/B Testing / Rollout chính thức vẫn tạo trên Firebase Console{managed.rollout ? ` — template đang có ${managed.rollout} giá trị do chúng quản lý (chỉ đọc)` : ''}.
        </Banner>
      </Card>
      <div className="flex items-center">
        <h3 className="text-sm font-semibold">Thí nghiệm tự quản ({exps.length})</h3>
        <span className="flex-1" />
        {!creating && <Button icon={Plus} onClick={() => setCreating(true)}>Tạo thí nghiệm</Button>}
      </div>
      {creating && <AbForm d={d} onDone={() => setCreating(false)} />}
      {exps.length ? (
        exps.map((e) => (
          <Card key={e.experiment} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-accent" aria-hidden />
              <b className="font-mono text-sm">{e.experiment}</b>
              <span className="text-xs text-muted">{e.variants.length} nhóm · {e.parameters.length} tham số: {e.parameters.join(', ')}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" icon={Trash2}
                onClick={() => window.confirm(`Kết thúc thí nghiệm ${e.experiment}? Xóa ${e.variants.length} điều kiện và giá trị theo nhóm, mọi người dùng về giá trị mặc định (trong bản nháp, chưa publish).`) && d.set(removeAbExperiment(d.template, e.experiment))}>
                Kết thúc
              </Button>
            </div>
            <ul className="flex flex-col gap-1 text-xs">
              {e.variants.map((v) => (
                <li key={v.name}><span className="mr-2 rounded-sm bg-accent/10 px-1.5 text-accent">{abConditionName(e.experiment, v.name)}</span><span className="font-mono text-muted">{v.expression}</span></li>
              ))}
            </ul>
          </Card>
        ))
      ) : !creating && <EmptyState icon={FlaskConical} title="Chưa có thí nghiệm tự quản">Tạo thí nghiệm để chia người dùng thành các nhóm nhận giá trị khác nhau.</EmptyState>}
    </div>
  );
}

function AbForm({ d, onDone }: { d: Draft; onDone: () => void }) {
  const params = allParameters(d.template);
  const [plan, setPlan] = useState<AbPlan>({
    experiment: '',
    baseRules: d.project.apps[0] ? [{ type: 'app', appIds: [d.project.apps[0].appId] } as ConditionRule] : [],
    variants: [{ name: 'A', weight: 50, values: {} }, { name: 'B', weight: 50, values: {} }],
    parameters: [],
  });
  const errs = checkAbPlan(plan, d.template);
  const set = (p: Partial<AbPlan>) => setPlan({ ...plan, ...p });
  const total = plan.variants.reduce((s, v) => s + v.weight, 0);
  const defaultOf = (key: string, group: string | null) => params.find((p) => p.key === key && p.group === group)?.param.defaultValue?.value ?? '';

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Field label="Tên thí nghiệm (seed)" htmlFor="abn" hint="a-z, 0-9, _ · đổi tên = chia lại nhóm"><Input id="abn" className="font-mono" value={plan.experiment} onChange={(e) => set({ experiment: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="inter_freq_oct" /></Field>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Áp cho ai (để trống = mọi người dùng)</span>
          <RulesBuilder rules={plan.baseRules} apps={d.project.apps} onChange={(baseRules) => set({ baseRules: baseRules.filter((r) => r.type !== 'percent') })} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Tham số thử nghiệm</span>
        <Select className="w-80" aria-label="Thêm tham số" value="" onChange={(e) => {
          const p = params.find((x) => `${x.group ?? ''}|${x.key}` === e.target.value);
          if (!p) return;
          set({
            parameters: [...plan.parameters, { key: p.key, group: p.group, valueType: p.param.valueType ?? 'STRING' }],
            variants: plan.variants.map((v) => ({ ...v, values: { ...v.values, [p.key]: p.param.defaultValue?.value ?? '' } })),
          });
        }}>
          <option value="">+ Chọn tham số…</option>
          {params.filter((p) => !plan.parameters.some((x) => x.key === p.key && x.group === p.group)).map((p) => <option key={`${p.group}|${p.key}`} value={`${p.group ?? ''}|${p.key}`}>{p.group ? `${p.group} · ` : ''}{p.key}</option>)}
        </Select>
      </div>
      {plan.parameters.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Nhóm</th>
                <th className="py-1 pr-2 font-medium">Tỉ lệ %</th>
                {plan.parameters.map((p) => (
                  <th key={p.key} className="py-1 pr-2 font-medium">
                    <span className="font-mono">{p.key}</span>
                    <Button size="sm" variant="ghost" icon={X} aria-label={`Bỏ ${p.key}`} onClick={() => set({ parameters: plan.parameters.filter((x) => x !== p) })} />
                    <span className="block font-normal">mặc định: <span className="font-mono">{defaultOf(p.key, p.group) || '—'}</span></span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {plan.variants.map((v, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2"><Input className="w-16 font-mono" aria-label="Tên nhóm" value={v.name} onChange={(e) => set({ variants: plan.variants.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9]/g, '') } : x)) })} /></td>
                  <td className="py-1 pr-2"><Input className="w-20" type="number" min={1} max={100} aria-label={`Tỉ lệ nhóm ${v.name}`} value={v.weight} onChange={(e) => set({ variants: plan.variants.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })} /></td>
                  {plan.parameters.map((p) => (
                    <td key={p.key} className="py-1 pr-2">
                      <Input className="min-w-32 font-mono" aria-label={`${p.key} nhóm ${v.name}`} value={v.values[p.key] ?? ''} onChange={(e) => set({ variants: plan.variants.map((x, j) => (j === i ? { ...x, values: { ...x.values, [p.key]: e.target.value } } : x)) })} />
                    </td>
                  ))}
                  <td>{plan.variants.length > 2 && <Button size="sm" variant="ghost" icon={X} aria-label="Bỏ nhóm" onClick={() => set({ variants: plan.variants.filter((_, j) => j !== i) })} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 flex items-center gap-3 text-xs">
            <Button size="sm" icon={Plus} disabled={plan.variants.length >= 6} onClick={() => set({ variants: [...plan.variants, { name: String.fromCharCode(65 + plan.variants.length), weight: 0, values: Object.fromEntries(plan.parameters.map((p) => [p.key, defaultOf(p.key, p.group)])) }] })}>Thêm nhóm</Button>
            <span className={total > 100 ? 'text-danger' : 'text-muted'}>Tổng {total}%{total < 100 ? ` · ${100 - total}% còn lại nhận giá trị mặc định (nhóm đối chứng)` : ''}</span>
          </div>
        </div>
      )}
      {errs.length > 0 && plan.experiment && <ul className="list-disc pl-5 text-xs text-danger">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={errs.length > 0} onClick={() => { d.set(applyAbPlan(d.template, plan)); onDone(); }}>Thêm vào bản nháp</Button>
        <Button variant="ghost" onClick={onDone}>Hủy</Button>
        <span className="self-center text-xs text-muted">Điều kiện của thí nghiệm được đặt lên đầu danh sách (ưu tiên cao nhất). Xem lại rồi bấm Publish.</span>
      </div>
    </Card>
  );
}
