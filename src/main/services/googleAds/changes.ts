import { and, between, desc, eq, inArray } from 'drizzle-orm';
import { enums } from 'google-ads-api';
import { db } from '../../db';
import { campaignMeta, changeEvents } from '../../db/schema';
import { addDays, isoDate } from '@shared/analytics';
import { CLIENT_LABEL, type ChangeDetail, type ChangeEventRow } from '@shared/insights';
import { customerById, withRetry, wrapAdsError } from './client';

// Nhật ký thay đổi của tài khoản (change_event): Google chỉ giữ 30 ngày, nên mỗi lần đồng bộ kéo 28 ngày gần nhất rồi lưu lại.

const enumName = (e: Record<string | number, string | number>, v: unknown) => (typeof v === 'number' ? String(e[v] ?? v) : String(v ?? ''));
const idFrom = (rn: string | null | undefined) => rn?.split('/').pop() ?? null;
const pathsOf = (m: unknown): string[] =>
  typeof m === 'string' ? m.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray((m as { paths?: string[] })?.paths) ? (m as { paths: string[] }).paths : [];

type Obj = Record<string, unknown> | undefined;
// Lấy giá trị cũ/mới của các trường app quan tâm (trạng thái, ngân sách, tCPI, tROAS, tên)
function detailsOf(type: string, oldR: Obj, newR: Obj, fields: string[]): ChangeDetail[] {
  const out: ChangeDetail[] = [];
  const has = (p: string) => fields.some((f) => f === p || f.startsWith(`${p}.`));
  if (type === 'CAMPAIGN') {
    const o = (oldR?.campaign ?? {}) as Record<string, any>;
    const n = (newR?.campaign ?? {}) as Record<string, any>;
    if (has('status')) out.push({ field: 'status', before: o.status != null ? enumName(enums.CampaignStatus, o.status) : null, after: n.status != null ? enumName(enums.CampaignStatus, n.status) : null, kind: 'text' });
    if (has('target_cpa')) out.push({ field: 'targetCpa', before: o.target_cpa?.target_cpa_micros != null ? Number(o.target_cpa.target_cpa_micros) : null, after: n.target_cpa?.target_cpa_micros != null ? Number(n.target_cpa.target_cpa_micros) : null, kind: 'money' });
    if (has('target_roas')) out.push({ field: 'targetRoas', before: o.target_roas?.target_roas ?? null, after: n.target_roas?.target_roas ?? null, kind: 'pct' });
    if (has('name')) out.push({ field: 'name', before: o.name ?? null, after: n.name ?? null, kind: 'text' });
  } else if (type === 'CAMPAIGN_BUDGET' && has('amount_micros')) {
    const o = (oldR?.campaign_budget ?? {}) as Record<string, any>;
    const n = (newR?.campaign_budget ?? {}) as Record<string, any>;
    out.push({ field: 'budget', before: o.amount_micros != null ? Number(o.amount_micros) : null, after: n.amount_micros != null ? Number(n.amount_micros) : null, kind: 'money' });
  }
  return out;
}

export async function syncChanges(customerId: string, today = isoDate(new Date())) {
  const { customer, row } = customerById(customerId);
  const from = addDays(today, -28);
  try {
    const rows = await withRetry(() =>
      customer.query(`
        SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_type,
               change_event.change_resource_name, change_event.resource_change_operation, change_event.client_type,
               change_event.user_email, change_event.changed_fields, change_event.old_resource, change_event.new_resource,
               change_event.campaign
        FROM change_event
        WHERE change_event.change_date_time >= '${from}' AND change_event.change_date_time <= '${today} 23:59:59'
        ORDER BY change_event.change_date_time DESC
        LIMIT 2000`),
    );
    const budgetToCampaign = new Map(
      db.select({ id: campaignMeta.campaignId, b: campaignMeta.budgetResource }).from(campaignMeta).where(eq(campaignMeta.customerId, customerId)).all().filter((x) => x.b).map((x) => [x.b!, x.id]),
    );
    db.transaction((tx) => {
      for (const r of rows) {
        const e = r.change_event!;
        const type = enumName(enums.ChangeEventResourceType, e.change_resource_type);
        const fields = pathsOf(e.changed_fields);
        const when = String(e.change_date_time ?? '');
        const campaignId = idFrom(e.campaign as string | undefined) ?? (type === 'CAMPAIGN_BUDGET' ? (budgetToCampaign.get(String(e.change_resource_name)) ?? null) : null);
        const v = {
          id: String(e.resource_name),
          customerId,
          at: new Date(when.replace(' ', 'T')).toISOString(),
          date: when.slice(0, 10),
          campaignId,
          resourceType: type,
          operation: enumName(enums.ResourceChangeOperation, e.resource_change_operation),
          clientType: enumName(enums.ChangeClientType, e.client_type),
          userEmail: e.user_email ?? null,
          fields: JSON.stringify(fields),
          details: JSON.stringify(detailsOf(type, e.old_resource as Obj, e.new_resource as Obj, fields)),
        };
        tx.insert(changeEvents).values(v).onConflictDoUpdate({ target: changeEvents.id, set: v }).run();
      }
    });
    return rows.length;
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

export function listChanges(filter: { customerIds: string[]; from: string; to: string; campaignId?: string | null }): ChangeEventRow[] {
  if (!filter.customerIds.length) return [];
  const names = new Map(db.select({ id: campaignMeta.campaignId, name: campaignMeta.name }).from(campaignMeta).all().map((x) => [x.id, x.name]));
  return db
    .select()
    .from(changeEvents)
    .where(and(inArray(changeEvents.customerId, filter.customerIds), between(changeEvents.date, filter.from, filter.to), filter.campaignId ? eq(changeEvents.campaignId, filter.campaignId) : undefined))
    .orderBy(desc(changeEvents.at))
    .limit(1000)
    .all()
    .map((r) => ({
      id: r.id,
      customerId: r.customerId,
      at: r.at,
      date: r.date,
      campaignId: r.campaignId,
      campaignName: r.campaignId ? (names.get(r.campaignId) ?? null) : null,
      resourceType: r.resourceType,
      operation: r.operation,
      source: CLIENT_LABEL[r.clientType] ?? r.clientType,
      user: r.userEmail,
      details: JSON.parse(r.details) as ChangeDetail[],
      fields: JSON.parse(r.fields) as string[],
    }));
}
