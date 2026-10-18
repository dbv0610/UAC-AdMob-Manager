import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { TAG_COLORS, buildExpression, checkConditionName, conditionUsage, type ConditionRule, type RcApp, type RcCondition, type RcTemplate } from '@shared/remoteConfig';
import { Button, Card, Field, Input, Select, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import type { Draft } from '.';

// Màu nhãn điều kiện giống Firebase Console
export const TAG_CLASS: Record<string, string> = {
  BLUE: 'bg-blue-500', BROWN: 'bg-amber-800', CYAN: 'bg-cyan-500', DEEP_ORANGE: 'bg-orange-600', GREEN: 'bg-green-600', INDIGO: 'bg-indigo-500',
  LIME: 'bg-lime-500', ORANGE: 'bg-orange-400', PINK: 'bg-pink-500', PURPLE: 'bg-purple-500', TEAL: 'bg-teal-500',
};

export function Conditions({ d }: { d: Draft }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const conds = d.template.conditions ?? [];
  const set = (next: RcCondition[], t: RcTemplate = d.template) => d.set({ ...structuredClone(t), conditions: next });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...conds];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    set(next);
  };
  const remove = (i: number) => {
    const name = conds[i].name;
    const used = conditionUsage(d.template, name);
    if (!window.confirm(used.length ? `Điều kiện ${name} đang dùng ở ${used.length} tham số (${used.slice(0, 5).join(', ')}…). Xóa cả các giá trị theo điều kiện này?` : `Xóa điều kiện ${name}?`)) return;
    const t = structuredClone(d.template);
    for (const p of Object.values(t.parameters ?? {})) delete p.conditionalValues?.[name];
    for (const g of Object.values(t.parameterGroups ?? {})) for (const p of Object.values(g.parameters ?? {})) delete p.conditionalValues?.[name];
    set(conds.filter((_, j) => j !== i), t);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted">Thứ tự = độ ưu tiên: người dùng khớp nhiều điều kiện thì nhận giá trị của điều kiện đứng trên.</p>
        <span className="flex-1" />
        <Button icon={Plus} onClick={() => setEditing('new')}>Thêm điều kiện</Button>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {conds.map((c, i) => (
            <li key={c.name} className="flex items-start gap-3 px-3 py-2.5">
              <span className="num w-6 pt-0.5 text-right text-xs text-muted">{i + 1}</span>
              <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', TAG_CLASS[c.tagColor ?? ''] ?? 'bg-muted')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.name} <span className="text-xs font-normal text-muted">· {conditionUsage(d.template, c.name).length} tham số</span></p>
                <p className="font-mono text-xs break-all text-muted" data-selectable>{c.expression}</p>
              </div>
              <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="Xuống" disabled={i === conds.length - 1} onClick={() => move(i, 1)} />
              <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Sửa ${c.name}`} onClick={() => setEditing(i)} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Xóa ${c.name}`} onClick={() => remove(i)} />
            </li>
          ))}
          {!conds.length && <li className="px-3 py-8 text-center text-sm text-muted">Chưa có điều kiện nào.</li>}
        </ul>
      </Card>
      {editing != null && (
        <ConditionDialog apps={d.project.apps} existing={conds.map((c) => c.name)} initial={editing === 'new' ? null : conds[editing]} onClose={() => setEditing(null)}
          onSave={(c) => {
            if (editing === 'new') set([...conds, c]);
            else {
              // Đổi tên điều kiện: chuyển cả giá trị theo điều kiện sang tên mới
              const old = conds[editing].name;
              const t = structuredClone(d.template);
              if (old !== c.name) {
                const all = [...Object.values(t.parameters ?? {}), ...Object.values(t.parameterGroups ?? {}).flatMap((g) => Object.values(g.parameters ?? {}))];
                for (const p of all) {
                  if (!p.conditionalValues?.[old]) continue;
                  p.conditionalValues = Object.fromEntries(Object.entries(p.conditionalValues).map(([k, v]) => [k === old ? c.name : k, v]));
                }
              }
              set(conds.map((x, j) => (j === editing ? c : x)), t);
            }
            setEditing(null);
          }} />
      )}
    </div>
  );
}

const RULE_LABEL: Record<ConditionRule['type'], string> = {
  app: 'App', platform: 'Nền tảng', version: 'Phiên bản app', country: 'Quốc gia', language: 'Ngôn ngữ', userProperty: 'User property', percent: '% người dùng ngẫu nhiên',
};
const blank = (type: ConditionRule['type'], apps: RcApp[]): ConditionRule =>
  ({
    app: { type: 'app', appIds: apps[0] ? [apps[0].appId] : [] },
    platform: { type: 'platform', os: 'android' },
    version: { type: 'version', op: '>=', version: '1.0.0' },
    country: { type: 'country', codes: ['us'] },
    language: { type: 'language', codes: ['en-US'] },
    userProperty: { type: 'userProperty', name: '', op: '==', value: '' },
    percent: { type: 'percent', seed: 'seed', from: 0, to: 50 },
  })[type] as ConditionRule;

const csv = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

function RuleEditor({ r, apps, onChange }: { r: ConditionRule; apps: RcApp[]; onChange: (r: ConditionRule) => void }) {
  switch (r.type) {
    case 'app':
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {apps.map((a) => (
            <label key={a.appId} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={r.appIds.includes(a.appId)} onChange={(e) => onChange({ ...r, appIds: e.target.checked ? [...r.appIds, a.appId] : r.appIds.filter((x) => x !== a.appId) })} />
              {a.displayName} <span className="text-muted">({a.platform === 'ANDROID' ? 'Android' : a.platform === 'IOS' ? 'iOS' : 'Web'})</span>
            </label>
          ))}
          {!apps.length && <span className="text-xs text-muted">Project chưa có app nào</span>}
        </div>
      );
    case 'platform':
      return <Select className="w-32" aria-label="Nền tảng" value={r.os} onChange={(e) => onChange({ ...r, os: e.target.value as 'android' | 'ios' })}><option value="android">Android</option><option value="ios">iOS</option></Select>;
    case 'version':
      return (
        <div className="flex gap-2">
          <Select className="w-20" aria-label="So sánh" value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value as typeof r.op })}>{['>=', '>', '==', '<=', '<'].map((o) => <option key={o}>{o}</option>)}</Select>
          <Input className="w-32 font-mono" aria-label="Phiên bản" placeholder="1.2.3" value={r.version} onChange={(e) => onChange({ ...r, version: e.target.value })} />
        </div>
      );
    case 'country':
    case 'language':
      return <Input className="font-mono" aria-label={RULE_LABEL[r.type]} placeholder={r.type === 'country' ? 'us, gb, vn' : 'en-US, vi-VN'} value={r.codes.join(', ')} onChange={(e) => onChange({ ...r, codes: csv(e.target.value) })} />;
    case 'userProperty':
      return (
        <div className="flex gap-2">
          <Input className="w-40 font-mono" aria-label="Tên user property" placeholder="tên property" value={r.name} onChange={(e) => onChange({ ...r, name: e.target.value })} />
          <Select className="w-20" aria-label="So sánh" value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value as typeof r.op })}>{['==', '!=', '>', '>=', '<', '<='].map((o) => <option key={o}>{o}</option>)}</Select>
          <Input className="w-40 font-mono" aria-label="Giá trị" value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value })} />
        </div>
      );
    case 'percent':
      return (
        <div className="flex items-center gap-2 text-xs">
          seed <Input className="w-32 font-mono" aria-label="Seed" value={r.seed} onChange={(e) => onChange({ ...r, seed: e.target.value })} />
          từ <Input className="w-20" type="number" min={0} max={100} aria-label="Từ %" value={r.from} onChange={(e) => onChange({ ...r, from: Number(e.target.value) })} />
          đến <Input className="w-20" type="number" min={0} max={100} aria-label="Đến %" value={r.to} onChange={(e) => onChange({ ...r, to: Number(e.target.value) })} /> %
        </div>
      );
  }
}

export function RulesBuilder({ rules, apps, onChange }: { rules: ConditionRule[]; apps: RcApp[]; onChange: (r: ConditionRule[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border border-border p-2">
          <span className="w-40 shrink-0 pt-1.5 text-xs font-medium">{i > 0 && <span className="mr-1 text-muted">VÀ</span>}{RULE_LABEL[r.type]}</span>
          <div className="flex-1"><RuleEditor r={r} apps={apps} onChange={(nr) => onChange(rules.map((x, j) => (j === i ? nr : x)))} /></div>
          <Button size="sm" variant="ghost" icon={X} aria-label="Bỏ quy tắc" onClick={() => onChange(rules.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Select className="w-64" aria-label="Thêm quy tắc" value="" onChange={(e) => e.target.value && onChange([...rules, blank(e.target.value as ConditionRule['type'], apps)])}>
        <option value="">+ Thêm quy tắc…</option>
        {(Object.keys(RULE_LABEL) as ConditionRule['type'][]).map((t) => <option key={t} value={t}>{RULE_LABEL[t]}</option>)}
      </Select>
    </div>
  );
}

function ConditionDialog({ apps, existing, initial, onClose, onSave }: { apps: RcApp[]; existing: string[]; initial: RcCondition | null; onClose: () => void; onSave: (c: RcCondition) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.tagColor ?? TAG_COLORS[existing.length % TAG_COLORS.length]);
  // Điều kiện có sẵn mở ở dạng biểu thức (không đoán ngược được quy tắc); tạo mới thì dùng trình dựng
  const [mode, setMode] = useState<'builder' | 'raw'>(initial ? 'raw' : 'builder');
  const [rules, setRules] = useState<ConditionRule[]>(apps[0] ? [blank('app', apps)] : []);
  const [raw, setRaw] = useState(initial?.expression ?? '');
  const expression = mode === 'builder' ? buildExpression(rules) : raw.trim();
  const nameErr = checkConditionName(name.trim(), existing.filter((n) => n !== initial?.name));
  return (
    <Dialog title={initial ? `Sửa điều kiện ${initial.name}` : 'Thêm điều kiện'} onClose={onClose} width="w-[760px]"
      footer={<><Button variant="ghost" onClick={onClose}>Hủy</Button><Button variant="primary" disabled={!!nameErr || !expression} onClick={() => onSave({ ...(initial ?? {}), name: name.trim(), expression, tagColor: color })}>Lưu vào bản nháp</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_200px] gap-3">
          <Field label="Tên điều kiện" htmlFor="cn" error={name ? (nameErr ?? undefined) : undefined}><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: android_vn_new_users" /></Field>
          <Field label="Màu nhãn" htmlFor="cc">
            <Select id="cc" value={color} onChange={(e) => setColor(e.target.value)}>{TAG_COLORS.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        </div>
        <div className="flex gap-1 text-sm">
          <Button size="sm" variant={mode === 'builder' ? 'primary' : 'ghost'} onClick={() => setMode('builder')}>Trình dựng</Button>
          <Button size="sm" variant={mode === 'raw' ? 'primary' : 'ghost'} onClick={() => { setRaw(expression); setMode('raw'); }}>Biểu thức</Button>
        </div>
        {mode === 'builder' ? (
          <>
            {initial && <p className="text-xs text-warning">Dựng lại sẽ thay toàn bộ biểu thức hiện có.</p>}
            <RulesBuilder rules={rules} apps={apps} onChange={setRules} />
            <p className="font-mono text-xs break-all text-muted" data-selectable>{expression || '(chưa có quy tắc)'}</p>
          </>
        ) : (
          <textarea aria-label="Biểu thức điều kiện" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="device.country in ['us', 'gb'] && app.version.>=(['2.0.0'])"
            className="min-h-28 w-full rounded-sm border border-border bg-surface p-2 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        )}
        <p className="text-xs text-muted">Firebase kiểm tra biểu thức lúc publish (validateOnly) — sai cú pháp sẽ báo lỗi, không ghi gì.</p>
      </div>
    </Dialog>
  );
}
