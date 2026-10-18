import { eq, inArray } from 'drizzle-orm';
import { enums, type MutateOperation } from 'google-ads-api';
import { db } from '../../db';
import { auditLog, campaigns } from '../../db/schema';
import { getCountry } from '@shared/geo';
import { addDays, daysBetween, isoDate } from '@shared/analytics';
import type { CampaignChange, CampaignRow, CampaignStatus, ConversionAction, RangePreset } from '@shared/types';
import { addUsage } from '../quota';
import { assertOnline, customerById, withRetry, wrapAdsError } from './client';

// Kết quả query trả enum dạng số; đổi về tên để UI và log dễ đọc.
const enumName = (e: Record<string | number, string | number>, v: unknown) =>
  typeof v === 'number' ? String(e[v]) : v == null ? null : String(v);

// all = từ trước đến nay: bỏ điều kiện ngày, Google Ads trả số liệu trọn đời của camp
const DURING: Record<RangePreset, string | null> = { last7: 'LAST_7_DAYS', last14: 'LAST_14_DAYS', last30: 'LAST_30_DAYS', all: null };

// Quốc gia: ưu tiên lịch sử tạo trong app, sau đó tách hậu tố _XX có biên trong tên (tránh _USA, _RUSSIA)
function countryOf(id: string, name: string, known: Map<string, string>) {
  if (known.has(id)) return known.get(id)!;
  for (const m of name.matchAll(/(?:^|_)([A-Z]{2})(?=_|$)/g)) if (getCountry(m[1]) && m[1] !== 'GP') return m[1];
  return null;
}

export async function listCampaigns(customerId: string, range: RangePreset): Promise<CampaignRow[]> {
  const { customer, row } = customerById(customerId);
  try {
    const attrs = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.status, campaign.start_date_time,
             campaign.app_campaign_setting.bidding_strategy_goal_type, campaign.app_campaign_setting.app_id,
             campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas,
             campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared
      FROM campaign
      WHERE campaign.advertising_channel_sub_type = 'APP_CAMPAIGN' AND campaign.status IN ('ENABLED', 'PAUSED')`);
    // Metrics query riêng: camp không có số liệu trong kỳ vẫn phải hiện trong danh sách
    const metrics = await customer.query(`
      SELECT campaign.id, metrics.cost_micros, metrics.conversions, metrics.impressions
      FROM campaign
      WHERE campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'${DURING[range] ? ` AND segments.date DURING ${DURING[range]}` : ''}`);
    const m = new Map(metrics.map((r) => [String(r.campaign!.id), r.metrics!]));
    const ids = attrs.map((r) => String(r.campaign!.id));
    const known = new Map(
      ids.length ? db.select().from(campaigns).where(inArray(campaigns.id, ids)).all().map((c) => [c.id, c.country]) : [],
    );

    return attrs.map((r) => {
      const c = r.campaign!;
      const id = String(c.id);
      const mm = m.get(id);
      return {
        id,
        customerId,
        name: c.name ?? id,
        status: enumName(enums.CampaignStatus, c.status) as CampaignStatus,
        country: countryOf(id, c.name ?? '', known),
        goalType: enumName(enums.AppCampaignBiddingStrategyGoalType, c.app_campaign_setting?.bidding_strategy_goal_type),
        appId: c.app_campaign_setting?.app_id ?? null,
        budgetResource: r.campaign_budget?.resource_name ?? '',
        budgetMicros: Number(r.campaign_budget?.amount_micros ?? 0),
        budgetShared: !!r.campaign_budget?.explicitly_shared,
        targetCpaMicros: c.target_cpa?.target_cpa_micros != null ? Number(c.target_cpa.target_cpa_micros) : null,
        targetRoas: c.target_roas?.target_roas ?? null,
        activeDays: c.start_date_time ? Math.max(1, daysBetween(String(c.start_date_time).slice(0, 10), addDays(isoDate(new Date()), -1))) : null,
        costMicros: Number(mm?.cost_micros ?? 0),
        conversions: Number(mm?.conversions ?? 0),
        impressions: Number(mm?.impressions ?? 0),
      };
    });
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

export async function listConversionActions(customerId: string): Promise<ConversionAction[]> {
  const { customer, row } = customerById(customerId);
  try {
    const rows = await customer.query(`
      SELECT conversion_action.id, conversion_action.name, conversion_action.category
      FROM conversion_action WHERE conversion_action.status = 'ENABLED'`);
    return rows.map((r) => ({
      id: String(r.conversion_action!.id),
      name: r.conversion_action!.name ?? '',
      category: enumName(enums.ConversionActionCategory, r.conversion_action!.category) ?? '',
    }));
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

// ── Sửa hàng loạt: gộp thay đổi theo resource, 1 mutate, ghi audit_log ───────
export async function applyChanges(customerId: string, changes: CampaignChange[], actor = 'user') {
  assertOnline();
  const { customer, row } = customerById(customerId);
  const byResource = new Map<string, { entity: 'campaign' | 'campaign_budget'; resource: Record<string, unknown> }>();
  const touch = (entity: 'campaign' | 'campaign_budget', rn: string) => {
    if (!byResource.has(rn)) byResource.set(rn, { entity, resource: { resource_name: rn } });
    return byResource.get(rn)!.resource;
  };

  for (const ch of changes) {
    const camp = `customers/${customerId}/campaigns/${ch.campaignId}`;
    if (ch.field === 'budget') touch('campaign_budget', ch.budgetResource!).amount_micros = Number(ch.after);
    if (ch.field === 'status') touch('campaign', camp).status = enums.CampaignStatus[ch.after as CampaignStatus];
    if (ch.field === 'targetCpa') touch('campaign', camp).target_cpa = { target_cpa_micros: Number(ch.after) };
    if (ch.field === 'targetRoas') touch('campaign', camp).target_roas = { target_roas: Number(ch.after) };
  }
  const ops: MutateOperation<Record<string, unknown>>[] = [...byResource.values()].map((v) => ({ entity: v.entity, operation: 'update', resource: v.resource }));

  let requestId: string | undefined;
  try {
    const res = await withRetry(() => customer.mutateResources(ops, { partial_failure: false }));
    requestId = (res as { request_id?: string }).request_id;
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
  addUsage('ads.operations', ops.length);

  db.transaction((tx) => {
    for (const ch of changes) {
      tx.insert(auditLog)
        .values({ actor, entity: `campaign.${ch.field}`, entityId: ch.campaignId, before: JSON.stringify(ch.before), after: JSON.stringify(ch.after), requestId })
        .run();
      if (ch.field === 'status') tx.update(campaigns).set({ status: String(ch.after) }).where(eq(campaigns.id, ch.campaignId)).run();
    }
  });
  return { applied: changes.length, operations: ops.length };
}
