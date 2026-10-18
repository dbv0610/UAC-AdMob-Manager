import { describe, expect, it } from 'vitest';
import {
  abExperiments,
  applyAbPlan,
  applyChanges,
  buildExpression,
  checkAbPlan,
  conditionUsage,
  diffTemplates,
  planReplace,
  removeAbExperiment,
  type RcTemplate,
  type ReplaceQuery,
} from '@shared/remoteConfig';

const T: RcTemplate = {
  conditions: [{ name: 'vn', expression: "device.country in ['vn']", tagColor: 'GREEN' }],
  parameters: {
    inter_unit: { valueType: 'STRING', defaultValue: { value: 'ca-app-pub-111/222' }, conditionalValues: { vn: { value: 'ca-app-pub-111/333' } } },
    inter_interval: { valueType: 'NUMBER', defaultValue: { value: '30' } },
    ads_config: { valueType: 'JSON', defaultValue: { value: '{"banner":{"unit":"ca-app-pub-111/222","refresh":30},"enabled":true}' } },
    rollout_flag: { valueType: 'BOOLEAN', defaultValue: { value: 'false' }, conditionalValues: { vn: { rolloutValue: { rolloutId: 'r1', value: 'true', percent: 10 } } } },
    in_app: { valueType: 'STRING', defaultValue: { useInAppDefault: true } },
  },
  parameterGroups: { ui: { parameters: { theme_color: { valueType: 'STRING', defaultValue: { value: '#FF0000' } } } } },
};
const Q = (p: Partial<ReplaceQuery>): ReplaceQuery => ({ find: '', replace: '', mode: 'text', caseSensitive: false, keyFilter: '', slots: 'all', conditionFilter: '', jsonKey: '', ...p });

describe('tìm & thay thế', () => {
  it('thay chuỗi ở mọi ô, kể cả trong JSON và nhóm; bỏ qua ô rollout / dùng mặc định trong app', () => {
    const r = planReplace(T, Q({ find: 'ca-app-pub-111', replace: 'ca-app-pub-999' }));
    expect(r.changes.map((c) => `${c.key}@${c.slot}`)).toEqual(['ads_config@default', 'inter_unit@default', 'inter_unit@vn']);
    expect(r.changes[0].after).toBe('{"banner":{"unit":"ca-app-pub-999/222","refresh":30},"enabled":true}');
  });
  it('lọc theo tên tham số, ô mặc định / điều kiện', () => {
    expect(planReplace(T, Q({ find: '111', replace: 'x', keyFilter: 'inter' })).changes).toHaveLength(2);
    expect(planReplace(T, Q({ find: '111', replace: 'x', slots: 'conditional' })).changes.map((c) => c.slot)).toEqual(['vn']);
    expect(planReplace(T, Q({ find: '111', replace: 'x', slots: 'default', keyFilter: 'inter_unit' })).changes.map((c) => c.slot)).toEqual(['default']);
  });
  it('khớp cả giá trị và regex có nhóm bắt', () => {
    expect(planReplace(T, Q({ find: '30', replace: '45', mode: 'exact' })).changes.map((c) => c.key)).toEqual(['inter_interval']);
    const r = planReplace(T, Q({ find: '(ca-app-pub-\\d+)/222', replace: '$1/777', mode: 'regex' }));
    expect(r.changes.find((c) => c.key === 'inter_unit')?.after).toBe('ca-app-pub-111/777');
    expect(planReplace(T, Q({ find: '(', mode: 'regex' })).error).toContain('Biểu thức chính quy lỗi');
  });
  it('chỉ khóa JSON: giữ kiểu số, không đụng khóa khác', () => {
    const r = planReplace(T, Q({ find: '30', replace: '60', mode: 'exact', jsonKey: 'refresh' }));
    expect(r.changes).toHaveLength(1);
    expect(JSON.parse(r.changes[0].after)).toEqual({ banner: { unit: 'ca-app-pub-111/222', refresh: 60 }, enabled: true });
  });
  it('giá trị mới sai kiểu bị đánh lỗi; rollout bị liệt kê bỏ qua', () => {
    const r = planReplace(T, Q({ find: '30', replace: 'abc', mode: 'exact' }));
    expect(r.changes[0]).toMatchObject({ key: 'inter_interval', error: 'Không phải số' });
    expect(planReplace(T, Q({ find: 'true', replace: 'false' })).skipped).toEqual([{ key: 'rollout_flag', group: null, slot: 'vn', reason: 'Đang chạy rollout / A/B test trên Console' }]);
  });
  it('áp thay đổi: kiểm tra lại giá trị cũ, báo xung đột nếu đã bị sửa', () => {
    const { changes } = planReplace(T, Q({ find: '#FF0000', replace: '#00FF00', mode: 'exact' }));
    const ok = applyChanges(T, changes);
    expect(ok.conflicts).toEqual([]);
    expect(ok.template.parameterGroups!.ui.parameters!.theme_color.defaultValue!.value).toBe('#00FF00');
    expect(T.parameterGroups!.ui.parameters!.theme_color.defaultValue!.value).toBe('#FF0000'); // không sửa bản gốc
    expect(applyChanges(ok.template, changes).conflicts).toEqual(['theme_color · mặc định']);
  });
});

describe('so sánh template', () => {
  it('liệt kê thêm / sửa / xóa ở tham số, giá trị và điều kiện', () => {
    const b = structuredClone(T);
    b.parameters!.inter_interval.defaultValue = { value: '45' };
    delete b.parameters!.in_app;
    b.parameters!.new_flag = { valueType: 'BOOLEAN', defaultValue: { value: 'true' } };
    b.conditions = [...b.conditions!, { name: 'ios', expression: "device.os == 'ios'" }];
    const rows = diffTemplates(T, b).map((r) => `${r.kind}:${r.what}:${r.key}${r.slot ? `@${r.slot}` : ''}`);
    expect(rows).toEqual(expect.arrayContaining(['added:condition:ios', 'changed:value:inter_interval@default', 'removed:parameter:in_app', 'added:parameter:new_flag']));
    expect(diffTemplates(T, structuredClone(T))).toEqual([]);
  });
});

describe('dựng điều kiện', () => {
  it('ghép quy tắc bằng &&, đúng cú pháp Remote Config', () => {
    expect(buildExpression([
      { type: 'app', appIds: ['1:1:android:a'] },
      { type: 'country', codes: ['VN', 'th'] },
      { type: 'percent', seed: 'exp1', from: 0, to: 50 },
      { type: 'userProperty', name: 'vip', op: '==', value: 'yes' },
    ])).toBe("app.id == '1:1:android:a' && device.country in ['vn', 'th'] && percent('exp1') between 0 and 50 && app.userProperty['vip'].exactlyMatches(['yes'])");
    expect(buildExpression([{ type: 'app', appIds: ['a', 'b'] }])).toBe("(app.id == 'a' || app.id == 'b')");
    expect(buildExpression([{ type: 'userProperty', name: 'level', op: '>=', value: '5' }])).toBe("app.userProperty['level'] >= 5");
  });
});

describe('A/B tự quản', () => {
  const plan = {
    experiment: 'inter_freq',
    baseRules: [{ type: 'country' as const, codes: ['vn'] }],
    variants: [{ name: 'A', weight: 40, values: { inter_interval: '20' } }, { name: 'B', weight: 40, values: { inter_interval: '60' } }],
    parameters: [{ key: 'inter_interval', group: null, valueType: 'NUMBER' as const }],
  };
  it('kiểm tra kế hoạch', () => {
    expect(checkAbPlan(plan, T)).toEqual([]);
    expect(checkAbPlan({ ...plan, experiment: 'X Y' }, T)[0]).toContain('Tên thí nghiệm');
    expect(checkAbPlan({ ...plan, variants: [{ ...plan.variants[0], values: { inter_interval: 'abc' } }, plan.variants[1]] }, T)).toContain('Nhóm A · inter_interval: Không phải số');
  });
  it('sinh điều kiện chia % liền nhau, đặt lên đầu; nhận diện và xóa được', () => {
    const t = applyAbPlan(T, plan);
    expect(t.conditions!.slice(0, 2)).toEqual([
      { name: 'ab_inter_freq_A', expression: "device.country in ['vn'] && percent('inter_freq') between 0 and 40", tagColor: 'BLUE' },
      { name: 'ab_inter_freq_B', expression: "device.country in ['vn'] && percent('inter_freq') between 40 and 80", tagColor: 'BROWN' },
    ]);
    expect(t.parameters!.inter_interval.conditionalValues).toEqual({ ab_inter_freq_A: { value: '20' }, ab_inter_freq_B: { value: '60' } });
    expect(abExperiments(t)).toEqual([{ experiment: 'inter_freq', variants: [expect.objectContaining({ name: 'A' }), expect.objectContaining({ name: 'B' })], parameters: ['inter_interval'] }]);
    const back = removeAbExperiment(t, 'inter_freq');
    expect(back.conditions).toEqual(T.conditions);
    expect(conditionUsage(back, 'ab_inter_freq_A')).toEqual([]);
  });
});

describe('JSON trong giá trị', async () => {
  const { keepStyle, parseJson, prettyJson, isJsonLike } = await import('@shared/json');
  it('báo lỗi theo dòng:cột', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": }');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Dòng 3, cột \d+/);
  });
  it('giữ kiểu viết gốc; nội dung không đổi thì trả đúng chuỗi gốc', () => {
    const one = '{"a":1,"b":[1,2]}';
    expect(keepStyle(one, prettyJson(one))).toBe(one); // mở ra định dạng đẹp rồi lưu, không sửa gì
    expect(keepStyle(one, '{\n  "a": 2,\n  "b": [1, 2]\n}')).toBe('{"a":2,"b":[1,2]}');
    const multi = '{\n  "a": 1\n}';
    expect(keepStyle(multi, '{"a":3}')).toBe('{\n  "a": 3\n}');
    expect(keepStyle(one, '{"a":')).toBe('{"a":'); // JSON lỗi: giữ nguyên để người dùng sửa
  });
  it('nhận diện JSON', () => {
    expect(isJsonLike(' {"x":1}')).toBe(true);
    expect(isJsonLike('[1,2]')).toBe(true);
    expect(isJsonLike('30')).toBe(false);
    expect(isJsonLike('{bad')).toBe(false);
  });
});

describe('vị trí lỗi JSON', async () => {
  const { parseJson } = await import('@shared/json');
  const err = (s: string) => { const r = parseJson(s); return r.ok ? null : r.error; };
  it('chỉ đúng dòng, cột và nguyên nhân', () => {
    expect(err('{\n  "a": 1,\n  "b": }')).toBe('Dòng 3, cột 8: Ký tự không hợp lệ “}”');
    expect(err('{"a": 1,}')).toBe('Dòng 1, cột 9: Dư dấu phẩy trước “}”');
    expect(err('{"a" 1}')).toBe('Dòng 1, cột 6: Thiếu dấu “:” sau tên khóa');
    expect(err('{a: 1}')).toBe('Dòng 1, cột 2: Cần tên khóa trong ngoặc kép');
    expect(err('[1 2]')).toBe('Dòng 1, cột 4: Thiếu dấu phẩy hoặc “]”');
    expect(err('{"a": 1')).toBe('Dòng 1, cột 8: Thiếu dấu phẩy hoặc “}”');
  });
});
