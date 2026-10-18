import { and, between, eq } from 'drizzle-orm';
import { enums, type Customer } from 'google-ads-api';
import { db } from '../../db';
import { campaignMeta, spendDaily } from '../../db/schema';
import { getJson, setJson } from '../settingsStore';
import { countryFromGeoId } from '@shared/geo';
import { customerById, withRetry, wrapAdsError } from './client';

// Chi phí theo (ngày, camp, quốc gia) từ geographic_view.
// LOCATION_OF_PRESENCE: một lượt hiển thị không bị đếm hai lần (vị trí thực tế và vị trí quan tâm).
const SPEND_GAQL = (from: string, to: string) => `
  SELECT segments.date, campaign.id, campaign.app_campaign_setting.app_id,
         geographic_view.country_criterion_id, metrics.cost_micros, metrics.impressions,
         metrics.clicks, metrics.conversions, metrics.biddable_app_install_conversions
  FROM geographic_view
  WHERE campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'
    AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
    AND segments.date BETWEEN '${from}' AND '${to}'`;

const META_GAQL = `
  SELECT campaign.id, campaign.name, campaign.status, campaign.app_campaign_setting.app_id,
         campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas,
         campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared
  FROM campaign
  WHERE campaign.advertising_channel_sub_type = 'APP_CAMPAIGN' AND campaign.status != 'REMOVED'`;

// criterion ID → ISO-2: bảng geo.ts trước, ID lạ thì hỏi geo_target_constant một lần rồi cache vĩnh viễn
async function countryResolver(customer: Customer, ids: string[]) {
  const cache = getJson<Record<string, string>>('geoCache') ?? {};
  const unknown = [...new Set(ids)].filter((id) => !countryFromGeoId(id) && !cache[id]);
  if (unknown.length) {
    const rows = await customer.query(`
      SELECT geo_target_constant.id, geo_target_constant.country_code
      FROM geo_target_constant WHERE geo_target_constant.id IN (${unknown.join(',')})`);
    for (const r of rows) {
      const g = r.geo_target_constant!;
      if (g.id && g.country_code) cache[String(g.id)] = g.country_code;
    }
    setJson('geoCache', cache);
  }
  return (id: string) => countryFromGeoId(id) ?? cache[id] ?? 'ZZ'; // ZZ = không xác định
}

export async function syncSpend(customerId: string, from: string, to: string) {
  const { customer, row } = customerById(customerId);
  try {
    const [rows, meta] = await Promise.all([
      withRetry(() => customer.query(SPEND_GAQL(from, to))),
      withRetry(() => customer.query(META_GAQL)),
    ]);
    const toCountry = await countryResolver(customer, rows.map((r) => String(r.geographic_view?.country_criterion_id ?? '')).filter(Boolean));

    // Gộp theo khóa: geographic_view có thể trả nhiều dòng cùng (ngày, camp, nước) theo loại vị trí con
    const agg = new Map<string, typeof spendDaily.$inferInsert>();
    for (const r of rows) {
      const date = r.segments!.date!;
      const campaignId = String(r.campaign!.id);
      const country = toCountry(String(r.geographic_view!.country_criterion_id));
      const k = `${date}|${campaignId}|${country}`;
      const m = r.metrics!;
      const cur = agg.get(k) ?? {
        date, campaignId, country, customerId, currency: row.currency,
        appId: r.campaign!.app_campaign_setting?.app_id ?? '',
        costMicros: 0, installs: 0, clicks: 0, impressions: 0, conversions: 0,
      };
      cur.costMicros! += Number(m.cost_micros ?? 0);
      cur.installs! += Number(m.biddable_app_install_conversions ?? 0);
      cur.clicks! += Number(m.clicks ?? 0);
      cur.impressions! += Number(m.impressions ?? 0);
      cur.conversions! += Number(m.conversions ?? 0);
      agg.set(k, cur);
    }

    const now = new Date().toISOString();
    db.transaction((tx) => {
      // Đồng bộ lại cả kỳ: xóa số cũ của customer trong kỳ rồi ghi mới (số Google sửa lùi cũng khớp)
      tx.delete(spendDaily).where(and(eq(spendDaily.customerId, customerId), between(spendDaily.date, from, to))).run();
      for (const v of agg.values()) {
        tx.insert(spendDaily).values(v).onConflictDoUpdate({ target: [spendDaily.date, spendDaily.campaignId, spendDaily.country], set: v }).run();
      }
      for (const r of meta) {
        const c = r.campaign!;
        const v = {
          campaignId: String(c.id),
          customerId,
          name: c.name ?? String(c.id),
          appId: c.app_campaign_setting?.app_id ?? null,
          status: typeof c.status === 'number' ? enums.CampaignStatus[c.status] : String(c.status ?? ''),
          targetCpaMicros: c.target_cpa?.target_cpa_micros ? Number(c.target_cpa.target_cpa_micros) : null,
          targetRoas: c.target_roas?.target_roas ?? null,
          budgetMicros: r.campaign_budget?.amount_micros != null ? Number(r.campaign_budget.amount_micros) : null,
          budgetResource: r.campaign_budget?.resource_name ?? null,
          budgetShared: !!r.campaign_budget?.explicitly_shared,
          updatedAt: now,
        };
        tx.insert(campaignMeta).values(v).onConflictDoUpdate({ target: campaignMeta.campaignId, set: v }).run();
      }
    });
    return { rows: agg.size, campaigns: meta.length, currency: row.currency };
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}
