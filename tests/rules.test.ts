import { describe, expect, it } from 'vitest';
import { RULE_TEMPLATES, RuleSchema, describeRule, evaluateRule, planChange, windowStats, type Rule, type RuleCampaign } from '@shared/rules';
import { addDays } from '@shared/analytics';

const f = { money: (v: number) => `$${v.toFixed(2)}`, pct: (v: number) => `${Math.round(v * 100)}%`, num: (v: number) => String(Math.round(v)) };
const now = new Date(2026, 9, 18, 9, 0); // 18/10/2026 09:00 giờ máy
const today = '2026-10-18';
const rule = (i: number, patch: Partial<Rule> = {}): Rule => ({ ...RULE_TEMPLATES[i], id: `r${i}`, ...patch });
const camp = (p: Partial<RuleCampaign> = {}, perDay = { spend: 10, installs: 5, revenue: 2 }): RuleCampaign => ({
  campaignId: '111', customerId: '1234567890', name: 'sw_GP_US', appId: 'app1', country: 'US', status: 'ENABLED',
  budgetMicros: 20_000_000, budgetResource: 'customers/1/campaignBudgets/9', budgetShared: false,
  targetCpaMicros: 1_500_000, targetRoas: null,
  days: Array.from({ length: 14 }, (_, i) => ({ date: addDays(today, -(i + 1)), ...perDay })),
  ...p,
});

describe('rules engine', () => {
  it('mẫu hợp lệ theo schema; % thay đổi > 20 bị chặn', () => {
    for (const t of RULE_TEMPLATES) expect(RuleSchema.safeParse({ ...t, id: 'x' }).success).toBe(true);
    const bad = RuleSchema.safeParse({ ...rule(1), then: { action: 'ADJUST_TARGET', changePct: -35 } });
    expect(bad.success).toBe(false);
    expect(RuleSchema.safeParse({ ...rule(1), then: { action: 'ADJUST_BUDGET' } }).success).toBe(false); // thiếu %
  });

  it('cửa sổ = N ngày trọn vẹn tới hôm qua, không tính hôm nay', () => {
    const c = camp({ days: [{ date: today, spend: 999, installs: 1, revenue: 0 }, { date: addDays(today, -1), spend: 10, installs: 5, revenue: 3 }] });
    const s = windowStats(c.days, 'LAST_7_DAYS', today);
    expect(s).toMatchObject({ spend: 10, installs: 5, cpi: 2, roas: 0.3 });
  });

  it('Pause ROAS thấp: khớp → đề xuất PAUSED, kèm lý do có số liệu', () => {
    const r = evaluateRule(rule(0), [camp()], [], now, f); // 7 ngày: chi 70, doanh thu 14 → ROAS 20%
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].change).toMatchObject({ field: 'status', before: 'ENABLED', after: 'PAUSED' });
    expect(r.suggestions[0].reason).toBe('Chi phí $70.00 >= $50.00 · ROAS 20% < 30%');
  });

  it('không khớp khi chi chưa đủ ngưỡng, hoặc camp đã tạm dừng', () => {
    expect(evaluateRule(rule(0), [camp({}, { spend: 5, installs: 1, revenue: 0 })], [], now, f).suggestions).toHaveLength(0);
    const paused = evaluateRule(rule(0), [camp({ status: 'PAUSED' })], [], now, f);
    expect(paused.suggestions).toHaveLength(0);
    expect(paused.skipped[0].reason).toBe('camp đã tạm dừng');
  });

  it('Hạ tCPI: so với tCPI × 1,3 của chính camp, hạ 10%, làm tròn micros', () => {
    // 3 ngày: chi 30, cài 15 → CPI 2 > 1,5 × 1,3 = 1,95; cài 15 < 30 → chưa đủ
    expect(evaluateRule(rule(1), [camp()], [], now, f).suggestions).toHaveLength(0);
    const r = evaluateRule(rule(1), [camp({}, { spend: 20, installs: 10, revenue: 0 })], [], now, f);
    expect(r.suggestions[0].change).toMatchObject({ field: 'targetCpa', before: 1_500_000, after: 1_350_000 });
    expect(r.suggestions[0].reason).toContain('CPI $2.00 > tCPI $1.50 × 1.3');
  });

  it('camp chưa có tCPI → không khớp điều kiện so với target', () => {
    const r = evaluateRule(rule(1), [camp({ targetCpaMicros: null }, { spend: 20, installs: 10, revenue: 0 })], [], now, f);
    expect(r.suggestions).toHaveLength(0);
  });

  it('cooldown và số lần/tuần chặn đổi liên tục', () => {
    const hist = [{ ruleId: 'r0', campaignId: '111', at: new Date(now.getTime() - 24 * 3600_000).toISOString() }];
    const r = evaluateRule(rule(0), [camp()], hist, now, f);
    expect(r.suggestions).toHaveLength(0);
    expect(r.skipped[0].reason).toContain('cooldown 72 giờ');
    const many = [4, 5, 6].map((d) => ({ ruleId: 'r0', campaignId: '111', at: new Date(now.getTime() - d * 24 * 3600_000).toISOString() }));
    const r2 = evaluateRule(rule(0, { maxChangesPerWeek: 3 }), [camp()], many, now, f);
    expect(r2.skipped[0].reason).toContain('đã chỉnh 3 lần trong 7 ngày');
    // lịch sử của rule khác không tính
    expect(evaluateRule(rule(0), [camp()], [{ ...hist[0], ruleId: 'other' }], now, f).suggestions).toHaveLength(1);
  });

  it('ngân sách: kẹp ±20%, sàn/trần, không đụng ngân sách dùng chung', () => {
    const r = rule(0, { then: { action: 'ADJUST_BUDGET', changePct: 15, ceiling: 22 } });
    expect(planChange(r, camp(), f)).toMatchObject({ change: { field: 'budget', before: 20_000_000, after: 22_000_000 } }); // 23 → trần 22
    expect(planChange(r, camp({ budgetShared: true }), f)).toMatchObject({ skip: expect.stringContaining('dùng chung') });
    const floor = rule(0, { then: { action: 'ADJUST_BUDGET', changePct: -20, floor: 20 } });
    expect(planChange(floor, camp(), f)).toMatchObject({ skip: expect.stringContaining('sàn') });
  });

  it('phạm vi app/quốc gia', () => {
    const r = rule(0, { scope: { appId: null, countries: ['VN'] } });
    expect(evaluateRule(r, [camp()], [], now, f).suggestions).toHaveLength(0);
    expect(evaluateRule(rule(0, { scope: { appId: 'app2', countries: [] } }), [camp()], [], now, f).suggestions).toHaveLength(0);
  });

  it('mô tả rule thành câu', () => {
    expect(describeRule(rule(0), f)).toBe('Nếu Chi phí >= $50.00 và ROAS < 30% (7 ngày) thì tạm dừng camp');
    expect(describeRule(rule(1), f)).toBe('Nếu Cài đặt >= 30 và CPI > tCPI × 1.3 (3 ngày) thì chỉnh tCPI/tROAS -10%');
  });
});
