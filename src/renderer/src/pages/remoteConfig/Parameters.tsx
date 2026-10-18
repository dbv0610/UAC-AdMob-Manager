import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { allParameters, checkValue, displayValue, valueKind, type RcParameter, type RcTemplate, type RcValue, type RcValueType } from '@shared/remoteConfig';
import { Button, Card, Field, Input, Select, StatusBadge, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { JsonEditor, JsonView, isJsonLike, keepStyle, prettyJson } from './Json';
import type { Draft } from '.';

const TYPES: RcValueType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'];

// Ghi tham số vào bản sao template (đổi tên / đổi nhóm thì xóa chỗ cũ)
function putParam(t: RcTemplate, old: { key: string; group: string | null } | null, key: string, group: string | null, param: RcParameter | null): RcTemplate {
  const next = structuredClone(t);
  const bucket = (g: string | null) => {
    if (!g) return (next.parameters ??= {});
    next.parameterGroups ??= {};
    next.parameterGroups[g] ??= { parameters: {} };
    return (next.parameterGroups[g].parameters ??= {});
  };
  if (old) delete bucket(old.group)[old.key];
  if (param) bucket(group)[key] = param;
  return next;
}

function ValueCell({ v, type }: { v: RcValue | undefined; type?: RcValueType }) {
  const k = valueKind(v);
  const text = displayValue(v);
  if (k === 'value' && (type === 'JSON' || isJsonLike(text))) return <JsonView value={text} />;
  return (
    <span title={text} className={cx('line-clamp-2 font-mono text-xs break-all', k !== 'value' && 'text-muted italic', k === 'rollout' && 'text-warning')}>
      {k === 'value' && text === '' ? '(rỗng)' : text}
    </span>
  );
}

export function Parameters({ d }: { d: Draft }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ key: string; group: string | null } | 'new' | null>(null);
  const params = useMemo(() => allParameters(d.template), [d.template]);
  const s = search.trim().toLowerCase();
  const rows = params.filter((p) => !s || p.key.toLowerCase().includes(s) || (p.param.description ?? '').toLowerCase().includes(s) || JSON.stringify(p.param).toLowerCase().includes(s));
  const changedKeys = useMemo(() => {
    const o = new Map(allParameters(d.original).map((p) => [`${p.group}|${p.key}`, JSON.stringify(p.param)]));
    return new Set(params.filter((p) => o.get(`${p.group}|${p.key}`) !== JSON.stringify(p.param)).map((p) => `${p.group}|${p.key}`));
  }, [d.original, params]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
          <Input className="w-80 pl-8" placeholder="Tìm theo tên, mô tả hoặc giá trị…" aria-label="Tìm tham số" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="text-xs text-muted">{rows.length}/{params.length} tham số · {(d.template.conditions ?? []).length} điều kiện</span>
        <span className="flex-1" />
        <Button icon={Plus} onClick={() => setEditing('new')}>Thêm tham số</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Tham số</th>
              <th className="px-3 py-2 font-medium">Kiểu</th>
              <th className="px-3 py-2 font-medium">Mặc định</th>
              <th className="px-3 py-2 font-medium">Theo điều kiện</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => {
              const id = `${p.group}|${p.key}`;
              const cond = Object.entries(p.param.conditionalValues ?? {});
              return (
                <tr key={id} className={cx('align-top hover:bg-surface-2/50', changedKeys.has(id) && 'bg-warning/5')}>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs font-medium" data-selectable>{p.key}</span>
                    {p.group && <span className="ml-1.5 rounded-sm bg-surface-2 px-1 text-[11px] text-muted">{p.group}</span>}
                    {changedKeys.has(id) && <span className="ml-1.5"><StatusBadge tone="warning">Đã sửa</StatusBadge></span>}
                    {p.param.description && <p className="mt-0.5 text-xs text-muted">{p.param.description}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{p.param.valueType ?? 'STRING'}</td>
                  <td className="max-w-80 px-3 py-2"><ValueCell v={p.param.defaultValue} type={p.param.valueType} /></td>
                  <td className="max-w-96 px-3 py-2">
                    {cond.length ? (
                      <ul className="flex flex-col gap-1">
                        {cond.map(([c, v]) => (
                          <li key={c} className="flex min-w-0 items-start gap-1.5">
                            <span className="shrink-0 rounded-sm bg-accent/10 px-1 text-[11px] text-accent">{c}</span>
                            <ValueCell v={v} type={p.param.valueType} />
                          </li>
                        ))}
                      </ul>
                    ) : <span className="text-xs text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Sửa ${p.key}`} onClick={() => setEditing({ key: p.key, group: p.group })} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Xóa ${p.key}`}
                      onClick={() => window.confirm(`Xóa tham số ${p.key}? (chỉ trong bản nháp, chưa publish)`) && d.set(putParam(d.template, p, p.key, p.group, null))} />
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted">Không có tham số nào khớp.</td></tr>}
          </tbody>
        </table>
      </Card>
      {editing && (
        <ParamDialog d={d} target={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSave={(old, key, group, param) => {
            d.set(putParam(d.template, old, key, group, param));
            setEditing(null);
          }} />
      )}
    </div>
  );
}

function ParamDialog({ d, target, onClose, onSave }: {
  d: Draft;
  target: { key: string; group: string | null } | null;
  onClose: () => void;
  onSave: (old: { key: string; group: string | null } | null, key: string, group: string | null, p: RcParameter) => void;
}) {
  const cur = target ? allParameters(d.template).find((p) => p.key === target.key && p.group === target.group)?.param : undefined;
  const [key, setKey] = useState(target?.key ?? '');
  const [group, setGroup] = useState(target?.group ?? '');
  const [type, setType] = useState<RcValueType>(cur?.valueType && cur.valueType !== 'PARAMETER_VALUE_TYPE_UNSPECIFIED' ? cur.valueType : 'STRING');
  const [desc, setDesc] = useState(cur?.description ?? '');
  // JSON mở ở dạng nhiều dòng cho dễ đọc; lúc lưu trả về đúng kiểu viết gốc (keepStyle)
  const pretty = (v: RcValue): RcValue => (type === 'JSON' && valueKind(v) === 'value' ? { ...v, value: prettyJson(v.value ?? '') } : v);
  const [def, setDef] = useState<RcValue>(() => pretty(cur?.defaultValue ?? { value: '' }));
  const [conds, setConds] = useState<[string, RcValue][]>(() => Object.entries(cur?.conditionalValues ?? {}).map(([n, v]) => [n, pretty(v)]));
  const restyle = (v: RcValue, orig: RcValue | undefined): RcValue => (type === 'JSON' && valueKind(v) === 'value' ? { ...v, value: keepStyle(orig?.value ?? '', v.value ?? '') } : v);
  const conditions = (d.template.conditions ?? []).map((c) => c.name);
  const groups = Object.keys(d.template.parameterGroups ?? {});
  const unused = conditions.filter((c) => !conds.some(([n]) => n === c));

  const taken = allParameters(d.template).some((p) => p.key === key.trim() && !(target && p.key === target.key && p.group === target.group));
  const keyErr = !key.trim() ? 'Nhập tên tham số' : !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.trim()) ? 'Chỉ chữ, số, gạch dưới; không bắt đầu bằng số' : taken ? 'Tên đã có' : null;
  const errOf = (v: RcValue) => (valueKind(v) === 'value' ? checkValue(type, v.value ?? '') : null);
  const errors = [keyErr, errOf(def), ...conds.map(([, v]) => errOf(v))].filter(Boolean);

  const editor = (v: RcValue, set: (v: RcValue) => void, label: string) => {
    const k = valueKind(v);
    if (k === 'rollout' || k === 'personalization') {
      return <p className="text-xs text-warning">{displayValue(v)} — do Firebase Console quản lý, giữ nguyên</p>;
    }
    const err = errOf(v);
    return (
      <div className="flex flex-col gap-1">
        {k === 'inApp' ? (
          <p className="text-xs text-muted">Dùng giá trị mặc định trong app</p>
        ) : type === 'BOOLEAN' ? (
          <Select className="w-32" aria-label={label} value={v.value ?? ''} onChange={(e) => set({ value: e.target.value })}>
            <option value="">—</option><option value="true">true</option><option value="false">false</option>
          </Select>
        ) : type === 'JSON' ? (
          <JsonEditor label={label} value={v.value ?? ''} onChange={(value) => set({ value })} />
        ) : (v.value ?? '').length > 60 ? (
          <textarea aria-label={label} value={v.value ?? ''} onChange={(e) => set({ value: e.target.value })}
            className={cx('min-h-24 w-full rounded-sm border bg-surface p-2 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/30', err ? 'border-danger' : 'border-border')} />
        ) : (
          <Input aria-label={label} className="font-mono" invalid={!!err} value={v.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={k === 'inApp'} onChange={(e) => set(e.target.checked ? { useInAppDefault: true } : { value: '' })} /> Dùng mặc định trong app
        </label>
        {err && type !== 'JSON' && <span className="text-xs text-danger">{err}</span>}
      </div>
    );
  };

  return (
    <Dialog title={target ? `Sửa tham số ${target.key}` : 'Thêm tham số'} onClose={onClose} width="w-[720px]"
      footer={<><Button variant="ghost" onClick={onClose}>Hủy</Button><Button variant="primary" disabled={errors.length > 0}
        onClick={() => onSave(target, key.trim(), group || null, { ...(cur ?? {}), valueType: type, description: desc.trim() || undefined, defaultValue: restyle(def, cur?.defaultValue), conditionalValues: conds.length ? Object.fromEntries(conds.map(([n, v]) => [n, restyle(v, cur?.conditionalValues?.[n])])) : undefined })}>
        Lưu vào bản nháp</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_160px_160px] gap-3">
          <Field label="Tên tham số" htmlFor="pk" error={key ? (keyErr ?? undefined) : undefined}>
            <Input id="pk" className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="Kiểu" htmlFor="pt">
            <Select id="pt" value={type} onChange={(e) => setType(e.target.value as RcValueType)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
          <Field label="Nhóm" htmlFor="pg">
            <Select id="pg" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">(không nhóm)</option>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Mô tả" htmlFor="pd"><Input id="pd" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Giá trị mặc định" htmlFor="pdef">{editor(def, setDef, 'Giá trị mặc định')}</Field>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted">Giá trị theo điều kiện (theo thứ tự ưu tiên ở tab Điều kiện)</p>
          {conds.map(([name, v], i) => (
            <div key={name} className="flex gap-2 rounded-md border border-border p-2">
              <div className="w-44 shrink-0">
                <span className="rounded-sm bg-accent/10 px-1.5 py-0.5 text-xs text-accent">{name}</span>
              </div>
              <div className="flex-1">{editor(v, (nv) => setConds(conds.map((c, j) => (j === i ? [name, nv] : c))), `Giá trị khi ${name}`)}</div>
              <Button size="sm" variant="ghost" icon={X} aria-label={`Bỏ giá trị ${name}`} onClick={() => setConds(conds.filter((_, j) => j !== i))} />
            </div>
          ))}
          {unused.length > 0 ? (
            <Select className="w-72" aria-label="Thêm giá trị theo điều kiện" value="" onChange={(e) => e.target.value && setConds([...conds, [e.target.value, { value: def.value ?? '' }]])}>
              <option value="">+ Thêm giá trị theo điều kiện…</option>
              {unused.map((c) => <option key={c}>{c}</option>)}
            </Select>
          ) : !conditions.length && <p className="text-xs text-muted">Chưa có điều kiện — tạo ở tab Điều kiện.</p>}
        </div>
      </div>
    </Dialog>
  );
}
