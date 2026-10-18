// Firebase Remote Config: mô hình template, tìm & thay thế hàng loạt, so sánh phiên bản, dựng điều kiện, A/B tự quản.
// Dùng chung main + renderer. Template giữ nguyên cấu trúc REST v1 để ghi lại không mất trường.
import { z } from 'zod';

// ── Template (REST v1) ──────────────────────────────────────────────────────
export interface RcValue {
  value?: string;
  useInAppDefault?: boolean;
  personalizationValue?: Record<string, unknown>; // do Firebase Personalization quản lý
  rolloutValue?: Record<string, unknown>; // do Rollout / A/B Testing trên Console quản lý
}
export type RcValueType = 'STRING' | 'BOOLEAN' | 'NUMBER' | 'JSON' | 'PARAMETER_VALUE_TYPE_UNSPECIFIED';

export interface RcParameter {
  defaultValue?: RcValue;
  conditionalValues?: Record<string, RcValue>;
  description?: string;
  valueType?: RcValueType;
}

export interface RcCondition {
  name: string;
  expression: string;
  tagColor?: string;
}

export interface RcTemplate {
  conditions?: RcCondition[];
  parameters?: Record<string, RcParameter>;
  parameterGroups?: Record<string, { description?: string; parameters?: Record<string, RcParameter> }>;
  version?: RcVersion;
}

export interface RcVersion {
  versionNumber?: string;
  updateTime?: string;
  updateUser?: { email?: string; name?: string };
  updateOrigin?: string; // CONSOLE | REST_API | ADMIN_SDK_NODE …
  updateType?: string; // INCREMENTAL_UPDATE | FORCED_UPDATE | ROLLBACK
  description?: string;
  rollbackSource?: string;
}

export interface RcFetched {
  projectId: string;
  template: RcTemplate;
  etag: string;
  fetchedAt: string;
}

// Project + app Firebase đọc được (lưu ở danh mục tài khoản)
export interface RcApp {
  appId: string; // 1:123:android:abc
  platform: 'ANDROID' | 'IOS' | 'WEB';
  displayName: string;
  packageName: string | null; // Android package / iOS bundle id
  appStoreId: string | null; // iOS
}
export interface RcProject {
  projectId: string;
  displayName: string;
  projectNumber: string;
  accountId: string;
  apps: RcApp[];
}

export const TAG_COLORS = ['BLUE', 'BROWN', 'CYAN', 'DEEP_ORANGE', 'GREEN', 'INDIGO', 'LIME', 'ORANGE', 'PINK', 'PURPLE', 'TEAL'] as const;

// ── Duyệt mọi ô giá trị ─────────────────────────────────────────────────────
// slot = 'default' hoặc tên điều kiện
export interface RcSlotRef {
  key: string;
  group: string | null;
  slot: string;
}
export const slotId = (r: RcSlotRef) => `${r.group ?? ''}\u0000${r.key}\u0000${r.slot}`;

export interface RcEntry extends RcSlotRef {
  valueType: RcValueType;
  value: RcValue;
}

export function allParameters(t: RcTemplate): { key: string; group: string | null; param: RcParameter }[] {
  const out = Object.entries(t.parameters ?? {}).map(([key, param]) => ({ key, group: null as string | null, param }));
  for (const [group, g] of Object.entries(t.parameterGroups ?? {})) {
    for (const [key, param] of Object.entries(g.parameters ?? {})) out.push({ key, group, param });
  }
  return out.sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.key.localeCompare(b.key));
}

export function entriesOf(t: RcTemplate): RcEntry[] {
  return allParameters(t).flatMap(({ key, group, param }) => {
    const valueType = param.valueType ?? 'STRING';
    const out: RcEntry[] = [];
    if (param.defaultValue) out.push({ key, group, slot: 'default', valueType, value: param.defaultValue });
    for (const [slot, value] of Object.entries(param.conditionalValues ?? {})) out.push({ key, group, slot, valueType, value });
    return out;
  });
}

export const valueKind = (v: RcValue | undefined): 'value' | 'inApp' | 'rollout' | 'personalization' | 'none' =>
  !v ? 'none' : v.rolloutValue ? 'rollout' : v.personalizationValue ? 'personalization' : v.useInAppDefault ? 'inApp' : 'value';

export function displayValue(v: RcValue | undefined) {
  const k = valueKind(v);
  if (k === 'value') return v!.value ?? '';
  return { inApp: '(dùng mặc định trong app)', rollout: '(rollout trên Console)', personalization: '(personalization)', none: '—' }[k];
}

// Kiểm tra giá trị theo kiểu tham số
export function checkValue(type: RcValueType, value: string): string | null {
  if (type === 'NUMBER' && (value.trim() === '' || !Number.isFinite(Number(value)))) return 'Không phải số';
  if (type === 'BOOLEAN' && !/^(true|false)$/i.test(value.trim())) return 'Phải là true / false';
  if (type === 'JSON') {
    try {
      JSON.parse(value);
    } catch {
      return 'JSON không hợp lệ';
    }
  }
  return null;
}

// ── Tìm & thay thế ──────────────────────────────────────────────────────────
export const ReplaceQuerySchema = z.object({
  find: z.string().min(1, 'Nhập chuỗi cần tìm').max(2000),
  replace: z.string().max(10000),
  mode: z.enum(['text', 'exact', 'regex']), // chứa · cả giá trị · biểu thức chính quy
  caseSensitive: z.boolean(),
  keyFilter: z.string().max(200), // lọc tên tham số (chứa, không phân biệt hoa thường); '' = mọi tham số
  slots: z.enum(['all', 'default', 'conditional']),
  conditionFilter: z.string().max(200), // chỉ điều kiện có tên chứa chuỗi này; '' = mọi điều kiện
  jsonKey: z.string().max(200), // chỉ thay giá trị của khóa này bên trong JSON (mọi cấp); '' = thay trên cả chuỗi
});
export type ReplaceQuery = z.infer<typeof ReplaceQuerySchema>;

export interface RcChange extends RcSlotRef {
  valueType: RcValueType;
  before: string;
  after: string;
  error: string | null; // giá trị mới sai kiểu → không cho ghi
}

export interface RcSkip extends RcSlotRef {
  reason: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replacer(q: ReplaceQuery): ((s: string) => string | null) | string {
  const flags = q.caseSensitive ? 'g' : 'gi';
  if (q.mode === 'exact') return (s) => (q.caseSensitive ? s === q.find : s.toLowerCase() === q.find.toLowerCase()) ? q.replace : null;
  let re: RegExp;
  try {
    re = new RegExp(q.mode === 'regex' ? q.find : escapeRe(q.find), flags);
  } catch (e) {
    return `Biểu thức chính quy lỗi: ${(e as Error).message}`;
  }
  return (s) => {
    re.lastIndex = 0;
    if (!re.test(s)) return null;
    re.lastIndex = 0;
    return s.replace(re, q.mode === 'regex' ? q.replace : q.replace.replace(/\$/g, '$$$$'));
  };
}

// Thay bên trong JSON: chỉ các giá trị nguyên thủy của khóa jsonKey ở mọi cấp, giữ kiểu số / boolean nếu được
function replaceInJson(raw: string, jsonKey: string, fn: (s: string) => string | null): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  let hit = false;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => {
          if (k === jsonKey && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
            const r = fn(String(v));
            if (r == null) return [k, v];
            hit = true;
            if (typeof v === 'number' && r.trim() !== '' && Number.isFinite(Number(r))) return [k, Number(r)];
            if (typeof v === 'boolean' && /^(true|false)$/i.test(r)) return [k, r.toLowerCase() === 'true'];
            return [k, r];
          }
          return [k, walk(v)];
        }),
      );
    }
    return node;
  };
  const next = walk(doc);
  if (!hit) return null;
  // Giữ cách thụt lề gần giống bản gốc: gốc nhiều dòng thì in 2 khoảng trắng
  return raw.includes('\n') ? JSON.stringify(next, null, 2) : JSON.stringify(next);
}

export function planReplace(t: RcTemplate, q: ReplaceQuery): { changes: RcChange[]; skipped: RcSkip[]; error: string | null } {
  const fn = replacer(q);
  if (typeof fn === 'string') return { changes: [], skipped: [], error: fn };
  const kf = q.keyFilter.trim().toLowerCase();
  const cf = q.conditionFilter.trim().toLowerCase();
  const changes: RcChange[] = [];
  const skipped: RcSkip[] = [];
  for (const e of entriesOf(t)) {
    if (kf && !e.key.toLowerCase().includes(kf)) continue;
    if (q.slots === 'default' && e.slot !== 'default') continue;
    if (q.slots === 'conditional' && e.slot === 'default') continue;
    if (cf && e.slot !== 'default' && !e.slot.toLowerCase().includes(cf)) continue;
    const kind = valueKind(e.value);
    if (kind === 'rollout' || kind === 'personalization') {
      // Không đụng giá trị do Rollout / A/B Testing / Personalization trên Console quản lý
      skipped.push({ key: e.key, group: e.group, slot: e.slot, reason: kind === 'rollout' ? 'Đang chạy rollout / A/B test trên Console' : 'Do Personalization quản lý' });
      continue;
    }
    if (kind !== 'value') continue;
    const before = e.value.value ?? '';
    const after = q.jsonKey.trim() ? replaceInJson(before, q.jsonKey.trim(), fn) : fn(before);
    if (after == null || after === before) continue;
    changes.push({ key: e.key, group: e.group, slot: e.slot, valueType: e.valueType, before, after, error: checkValue(e.valueType, after) });
  }
  return { changes, skipped, error: null };
}

function paramAt(t: RcTemplate, key: string, group: string | null): RcParameter | undefined {
  return group ? t.parameterGroups?.[group]?.parameters?.[key] : t.parameters?.[key];
}

// Áp thay đổi lên bản sao template; kiểm tra lại "before" để không ghi đè giá trị vừa bị người khác sửa
export function applyChanges(t: RcTemplate, changes: Pick<RcChange, 'key' | 'group' | 'slot' | 'before' | 'after'>[]): { template: RcTemplate; conflicts: string[] } {
  const next = structuredClone(t);
  const conflicts: string[] = [];
  for (const c of changes) {
    const p = paramAt(next, c.key, c.group);
    const v = !p ? undefined : c.slot === 'default' ? p.defaultValue : p.conditionalValues?.[c.slot];
    if (!v || valueKind(v) !== 'value' || (v.value ?? '') !== c.before) {
      conflicts.push(`${c.key} · ${c.slot === 'default' ? 'mặc định' : c.slot}`);
      continue;
    }
    v.value = c.after;
  }
  return { template: next, conflicts };
}

// ── So sánh hai template ────────────────────────────────────────────────────
export interface RcDiffRow {
  kind: 'added' | 'removed' | 'changed';
  what: 'value' | 'parameter' | 'condition';
  key: string; // tên tham số hoặc điều kiện
  group: string | null;
  slot: string | null;
  before: string | null;
  after: string | null;
}

export function diffTemplates(a: RcTemplate, b: RcTemplate): RcDiffRow[] {
  const out: RcDiffRow[] = [];
  const condA = new Map((a.conditions ?? []).map((c) => [c.name, c]));
  const condB = new Map((b.conditions ?? []).map((c) => [c.name, c]));
  for (const [name, c] of condB) {
    const p = condA.get(name);
    if (!p) out.push({ kind: 'added', what: 'condition', key: name, group: null, slot: null, before: null, after: c.expression });
    else if (p.expression !== c.expression || (p.tagColor ?? '') !== (c.tagColor ?? '')) out.push({ kind: 'changed', what: 'condition', key: name, group: null, slot: null, before: p.expression, after: c.expression });
  }
  for (const [name, c] of condA) if (!condB.has(name)) out.push({ kind: 'removed', what: 'condition', key: name, group: null, slot: null, before: c.expression, after: null });
  const orderA = (a.conditions ?? []).map((c) => c.name).filter((n) => condB.has(n)).join('|');
  const orderB = (b.conditions ?? []).map((c) => c.name).filter((n) => condA.has(n)).join('|');
  if (orderA !== orderB) out.push({ kind: 'changed', what: 'condition', key: '(thứ tự ưu tiên)', group: null, slot: null, before: orderA.replaceAll('|', ' › '), after: orderB.replaceAll('|', ' › ') });

  const pk = (x: { key: string; group: string | null }) => `${x.group ?? ''}\u0000${x.key}`;
  const pa = new Map(allParameters(a).map((x) => [pk(x), x]));
  const pb = new Map(allParameters(b).map((x) => [pk(x), x]));
  for (const [id, x] of pb) {
    const p = pa.get(id);
    if (!p) {
      out.push({ kind: 'added', what: 'parameter', key: x.key, group: x.group, slot: null, before: null, after: displayValue(x.param.defaultValue) });
      continue;
    }
    const slots = new Set(['default', ...Object.keys(p.param.conditionalValues ?? {}), ...Object.keys(x.param.conditionalValues ?? {})]);
    for (const s of slots) {
      const va = s === 'default' ? p.param.defaultValue : p.param.conditionalValues?.[s];
      const vb = s === 'default' ? x.param.defaultValue : x.param.conditionalValues?.[s];
      if (JSON.stringify(va ?? null) === JSON.stringify(vb ?? null)) continue;
      out.push({ kind: !va ? 'added' : !vb ? 'removed' : 'changed', what: 'value', key: x.key, group: x.group, slot: s, before: va ? displayValue(va) : null, after: vb ? displayValue(vb) : null });
    }
    if ((p.param.valueType ?? 'STRING') !== (x.param.valueType ?? 'STRING') || (p.param.description ?? '') !== (x.param.description ?? '')) {
      out.push({ kind: 'changed', what: 'parameter', key: x.key, group: x.group, slot: null, before: `${p.param.valueType ?? 'STRING'} · ${p.param.description ?? ''}`, after: `${x.param.valueType ?? 'STRING'} · ${x.param.description ?? ''}` });
    }
  }
  for (const [id, x] of pa) if (!pb.has(id)) out.push({ kind: 'removed', what: 'parameter', key: x.key, group: x.group, slot: null, before: displayValue(x.param.defaultValue), after: null });
  return out;
}

// ── Dựng điều kiện ─────────────────────────────────────────────────────────
export type ConditionRule =
  | { type: 'app'; appIds: string[] }
  | { type: 'platform'; os: 'android' | 'ios' }
  | { type: 'version'; op: '>=' | '<=' | '==' | '>' | '<'; version: string }
  | { type: 'country'; codes: string[] }
  | { type: 'language'; codes: string[] }
  | { type: 'userProperty'; name: string; op: '==' | '!=' | '>' | '<' | '>=' | '<='; value: string }
  | { type: 'percent'; seed: string; from: number; to: number };

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const list = (xs: string[]) => `[${xs.map(q).join(', ')}]`;

export function ruleExpression(r: ConditionRule): string {
  switch (r.type) {
    case 'app':
      return r.appIds.length === 1 ? `app.id == ${q(r.appIds[0])}` : `(${r.appIds.map((id) => `app.id == ${q(id)}`).join(' || ')})`;
    case 'platform':
      return `device.os == ${q(r.os)}`;
    case 'version':
      return r.op === '==' ? `app.version.exactlyMatches([${q(r.version)}])` : `app.version.${r.op}([${q(r.version)}])`;
    case 'country':
      return `device.country in ${list(r.codes.map((c) => c.toLowerCase()))}`;
    case 'language':
      return `device.language in ${list(r.codes)}`;
    case 'userProperty': {
      const num = r.value.trim() !== '' && Number.isFinite(Number(r.value));
      if (num && r.op !== '==' && r.op !== '!=') return `app.userProperty[${q(r.name)}] ${r.op} ${Number(r.value)}`;
      const m = `app.userProperty[${q(r.name)}].exactlyMatches([${q(r.value)}])`;
      return r.op === '!=' ? `!${m}` : m;
    }
    case 'percent':
      return `percent(${q(r.seed)}) between ${r.from} and ${r.to}`;
  }
}

export const buildExpression = (rules: ConditionRule[]) => rules.map(ruleExpression).join(' && ');

export function checkConditionName(name: string, existing: string[]) {
  if (!name.trim()) return 'Nhập tên điều kiện';
  if (name.length > 100) return 'Tối đa 100 ký tự';
  if (existing.includes(name)) return 'Tên đã có';
  return null;
}

// Tham số đang dùng điều kiện (để chặn xóa nhầm)
export const conditionUsage = (t: RcTemplate, name: string) => allParameters(t).filter((p) => p.param.conditionalValues?.[name]).map((p) => p.key);

// ── A/B tự quản ─────────────────────────────────────────────────────────────
// Chia người dùng bằng percent(seed) — cùng seed thì một người luôn rơi vào cùng nhóm.
// Phân tích kết quả không có sẵn như A/B Testing trên Console: gắn user property theo nhóm trong app để so.
export interface AbVariant {
  name: string; // A, B, …
  weight: number; // %
  values: Record<string, string>; // tham số → giá trị của nhóm
}
export interface AbPlan {
  experiment: string; // dùng làm seed và tiền tố tên điều kiện
  baseRules: ConditionRule[]; // điều kiện chung (app, quốc gia, phiên bản…)
  variants: AbVariant[];
  parameters: { key: string; group: string | null; valueType: RcValueType }[];
}

export const abConditionName = (exp: string, variant: string) => `ab_${exp}_${variant}`;

export function checkAbPlan(p: AbPlan, t: RcTemplate): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9_]{2,40}$/.test(p.experiment)) errs.push('Tên thí nghiệm: 2–40 ký tự a-z, 0-9, _');
  if (p.variants.length < 2) errs.push('Cần ít nhất 2 nhóm');
  const total = p.variants.reduce((s, v) => s + v.weight, 0);
  if (Math.abs(total - 100) > 1e-9 && total > 100) errs.push(`Tổng tỉ lệ ${total}% vượt 100%`);
  if (p.variants.some((v) => !(v.weight > 0))) errs.push('Mỗi nhóm phải có tỉ lệ > 0%');
  const names = new Set((t.conditions ?? []).map((c) => c.name));
  for (const v of p.variants) if (names.has(abConditionName(p.experiment, v.name))) errs.push(`Điều kiện ${abConditionName(p.experiment, v.name)} đã có`);
  if (!p.parameters.length) errs.push('Chọn ít nhất 1 tham số');
  for (const v of p.variants) {
    for (const prm of p.parameters) {
      const val = v.values[prm.key] ?? '';
      const e = checkValue(prm.valueType, val);
      if (e) errs.push(`Nhóm ${v.name} · ${prm.key}: ${e}`);
    }
  }
  return errs;
}

// Sinh điều kiện (đặt lên đầu để được ưu tiên) + giá trị theo nhóm; phần còn lại (nếu tổng < 100%) dùng giá trị mặc định
export function applyAbPlan(t: RcTemplate, p: AbPlan): RcTemplate {
  const next = structuredClone(t);
  const base = buildExpression(p.baseRules);
  let from = 0;
  const conds: RcCondition[] = p.variants.map((v, i) => {
    const to = from + v.weight;
    const pct = ruleExpression({ type: 'percent', seed: p.experiment, from, to });
    from = to;
    return { name: abConditionName(p.experiment, v.name), expression: base ? `${base} && ${pct}` : pct, tagColor: TAG_COLORS[i % TAG_COLORS.length] };
  });
  next.conditions = [...conds, ...(next.conditions ?? [])];
  for (const prm of p.parameters) {
    const param = paramAt(next, prm.key, prm.group);
    if (!param) continue;
    param.conditionalValues = {
      ...Object.fromEntries(p.variants.map((v) => [abConditionName(p.experiment, v.name), { value: v.values[prm.key] ?? '' }])),
      ...(param.conditionalValues ?? {}),
    };
  }
  return next;
}

// Nhận diện các thí nghiệm tự quản đã tạo (theo tên điều kiện ab_<exp>_<nhóm>)
export function abExperiments(t: RcTemplate) {
  const by = new Map<string, { name: string; expression: string }[]>();
  for (const c of t.conditions ?? []) {
    const m = c.name.match(/^ab_([a-z0-9_]+?)_([^_]+)$/);
    if (m) by.set(m[1], [...(by.get(m[1]) ?? []), { name: m[2], expression: c.expression }]);
  }
  return [...by.entries()].map(([experiment, variants]) => ({ experiment, variants, parameters: allParameters(t).filter((p) => variants.some((v) => p.param.conditionalValues?.[abConditionName(experiment, v.name)])).map((p) => p.key) }));
}

// Xóa thí nghiệm tự quản: bỏ điều kiện + giá trị theo nhóm (giữ giá trị mặc định)
export function removeAbExperiment(t: RcTemplate, experiment: string): RcTemplate {
  const next = structuredClone(t);
  const names = new Set((next.conditions ?? []).filter((c) => c.name.startsWith(`ab_${experiment}_`)).map((c) => c.name));
  next.conditions = (next.conditions ?? []).filter((c) => !names.has(c.name));
  for (const { param } of allParameters(next)) for (const n of names) if (param.conditionalValues) delete param.conditionalValues[n];
  return next;
}

// Đếm giá trị do Console quản lý (rollout / A/B Testing / personalization) — chỉ đọc
export function consoleManaged(t: RcTemplate) {
  const e = entriesOf(t);
  return { rollout: e.filter((x) => valueKind(x.value) === 'rollout').length, personalization: e.filter((x) => valueKind(x.value) === 'personalization').length };
}

// ── Schema IPC ──────────────────────────────────────────────────────────────
const ValueSchema = z.object({ value: z.string().max(1_000_000).optional(), useInAppDefault: z.boolean().optional(), personalizationValue: z.record(z.string(), z.unknown()).optional(), rolloutValue: z.record(z.string(), z.unknown()).optional() }).passthrough();
const ParamSchema = z.object({ defaultValue: ValueSchema.optional(), conditionalValues: z.record(z.string(), ValueSchema).optional(), description: z.string().max(1000).optional(), valueType: z.string().optional() }).passthrough();
export const RcTemplateSchema = z
  .object({
    conditions: z.array(z.object({ name: z.string().min(1).max(100), expression: z.string().min(1).max(10000), tagColor: z.string().optional() }).passthrough()).max(2000).optional(),
    parameters: z.record(z.string().min(1).max(256), ParamSchema).optional(),
    parameterGroups: z.record(z.string(), z.object({ description: z.string().optional(), parameters: z.record(z.string(), ParamSchema).optional() }).passthrough()).optional(),
    version: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const ProjectIdSchema = z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/, 'Project ID Firebase không hợp lệ');

export const PublishSchema = z.object({
  accountId: z.string().min(1),
  projectId: ProjectIdSchema,
  etag: z.string().min(1),
  template: RcTemplateSchema,
  description: z.string().max(256).optional(),
});

const ChangeSchema = z.object({ key: z.string(), group: z.string().nullable(), slot: z.string(), before: z.string(), after: z.string() });
export const ApplyReplaceSchema = z.object({
  description: z.string().max(256).optional(),
  targets: z.array(z.object({ accountId: z.string().min(1), projectId: ProjectIdSchema, etag: z.string().min(1), changes: z.array(ChangeSchema).min(1).max(5000) })).min(1).max(100),
});
export type ApplyReplaceRequest = z.infer<typeof ApplyReplaceSchema>;

export interface ReplacePlan {
  projectId: string;
  accountId: string;
  etag: string | null;
  changes: RcChange[];
  skipped: RcSkip[];
  error: string | null;
}
