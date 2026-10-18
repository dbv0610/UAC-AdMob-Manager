import { and, eq, inArray } from 'drizzle-orm';
import { enums, type Customer, type MutateOperation } from 'google-ads-api';
import { db } from '../../db';
import { assets } from '../../db/schema';
import { geoTargetId, languageId } from '@shared/geo';
import { GOALS, toMicros, type CellError, type CountryRow } from '@shared/plan';
import type { Store } from '@shared/types';
import { failureOf, isTransient, type FailureItem } from './client';

// Một quốc gia = một mutate nguyên tử: budget + campaign + criterion + ad group + ad (+ asset video còn thiếu).

type PathEl = { field_name?: string; index?: number };
type CellOf = (rest: PathEl[]) => string;

export interface CountryInput {
  customerId: string;
  appStoreId: string;
  store: Store;
  name: string;
  row: CountryRow;
  videoAssets: Map<string, string | null>; // videoId → asset resource name (null = tạo mới trong mutate)
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const ytKey = (videoId: string) => `yt:${videoId}`;

// ── Asset video dùng chung: SQLite trước, rồi hỏi Google, chỉ tạo cái chưa có ─────
export async function resolveVideoAssets(customer: Customer, customerId: string, videoIds: string[]) {
  const ids = [...new Set(videoIds)];
  const out = new Map<string, string | null>(ids.map((id) => [id, null]));
  if (!ids.length) return out;

  const cached = db
    .select()
    .from(assets)
    .where(and(eq(assets.customerId, customerId), inArray(assets.creativeId, ids.map(ytKey))))
    .all();
  for (const a of cached) out.set(a.creativeId.slice(3), a.assetResourceName);

  const missing = ids.filter((id) => !out.get(id));
  if (missing.length) {
    const rows = await customer.query(`
      SELECT asset.resource_name, asset.youtube_video_asset.youtube_video_id
      FROM asset
      WHERE asset.type = 'YOUTUBE_VIDEO'
        AND asset.youtube_video_asset.youtube_video_id IN (${missing.map((m) => `'${esc(m)}'`).join(',')})`);
    for (const r of rows) {
      const vid = r.asset?.youtube_video_asset?.youtube_video_id;
      if (vid && r.asset?.resource_name) {
        out.set(vid, r.asset.resource_name);
        rememberAsset(customerId, vid, r.asset.resource_name);
      }
    }
  }
  return out;
}

export function rememberAsset(customerId: string, videoId: string, resourceName: string) {
  db.insert(assets)
    .values({ customerId, creativeId: ytKey(videoId), assetResourceName: resourceName, type: 'YOUTUBE_VIDEO' })
    .onConflictDoUpdate({ target: [assets.customerId, assets.creativeId], set: { assetResourceName: resourceName } })
    .run();
}

// Camp trùng tên (chưa xóa) → coi như đã tạo, bấm "Tạo" hai lần không sinh hai camp.
export async function existingCampaigns(customer: Customer, names: string[]) {
  const found = new Map<string, string>();
  if (!names.length) return found;
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name FROM campaign
    WHERE campaign.status != 'REMOVED' AND campaign.name IN (${names.map((n) => `'${esc(n)}'`).join(',')})`);
  for (const r of rows) found.set(r.campaign!.name!, String(r.campaign!.id));
  return found;
}

function biddingFor(row: CountryRow) {
  const g = GOALS[row.goal];
  if (g.bidding === 'target_cpa') return { target_cpa: { target_cpa_micros: toMicros(row.target ?? 0) } };
  if (g.bidding === 'target_roas') return { target_roas: { target_roas: row.target ?? 0 } };
  return { maximize_conversions: {} };
}

export function buildCountryOps(input: CountryInput) {
  const { customerId: cid, row } = input;
  const tmp = (kind: string, n: number) => `customers/${cid}/${kind}/-${n}`;
  const budget = tmp('campaignBudgets', 1);
  const campaign = tmp('campaigns', 2);
  const adGroup = tmp('adGroups', 3);
  const g = GOALS[row.goal];

  const ops: MutateOperation<Record<string, unknown>>[] = [];
  const cells: CellOf[] = [];
  const newVideos = new Map<number, string>(); // op index → videoId vừa tạo
  const push = (op: MutateOperation<Record<string, unknown>>, cell: CellOf) => {
    ops.push(op);
    cells.push(cell);
  };

  const videoResources = row.videoIds.map((vid, j) => {
    const known = input.videoAssets.get(vid);
    if (known) return known;
    const rn = tmp('assets', 100 + j);
    newVideos.set(ops.length, vid);
    push(
      { entity: 'asset', operation: 'create', resource: { resource_name: rn, type: enums.AssetType.YOUTUBE_VIDEO, youtube_video_asset: { youtube_video_id: vid } } },
      () => `videoIds.${j}`,
    );
    return rn;
  });

  push(
    {
      entity: 'campaign_budget',
      operation: 'create',
      resource: {
        resource_name: budget,
        name: `Budget_${input.name}`,
        amount_micros: toMicros(row.dailyBudget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    },
    () => 'dailyBudget',
  );

  push(
    {
      entity: 'campaign',
      operation: 'create',
      resource: {
        resource_name: campaign,
        name: input.name,
        status: enums.CampaignStatus.PAUSED, // quy tắc an toàn: luôn tạo ở trạng thái tạm dừng
        advertising_channel_type: enums.AdvertisingChannelType.MULTI_CHANNEL,
        advertising_channel_sub_type: enums.AdvertisingChannelSubType.APP_CAMPAIGN,
        campaign_budget: budget,
        contains_eu_political_advertising: enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...biddingFor(row),
        ...(g.conversions
          ? { selective_optimization: { conversion_actions: row.conversionActions.map((id) => `customers/${cid}/conversionActions/${id}`) } }
          : {}),
        app_campaign_setting: {
          app_id: input.appStoreId,
          app_store: input.store === 'GOOGLE_PLAY' ? enums.AppCampaignAppStore.GOOGLE_APP_STORE : enums.AppCampaignAppStore.APPLE_APP_STORE,
          bidding_strategy_goal_type: enums.AppCampaignBiddingStrategyGoalType[g.goalType as keyof typeof enums.AppCampaignBiddingStrategyGoalType],
        },
      },
    },
    (rest) => {
      const names = rest.map((p) => p.field_name);
      if (names.includes('target_cpa') || names.includes('target_roas')) return 'target';
      if (names.includes('selective_optimization')) return 'conversionActions';
      if (names.includes('name')) return 'name';
      return '';
    },
  );

  push(
    { entity: 'campaign_criterion', operation: 'create', resource: { campaign, location: { geo_target_constant: `geoTargetConstants/${geoTargetId(row.countryCode)}` } } },
    () => 'countryCode',
  );
  row.languages.forEach((l, k) =>
    push(
      { entity: 'campaign_criterion', operation: 'create', resource: { campaign, language: { language_constant: `languageConstants/${languageId(l)}` } } },
      () => `languages.${k}`,
    ),
  );

  push(
    { entity: 'ad_group', operation: 'create', resource: { resource_name: adGroup, name: `AG_${row.countryCode}`, campaign, status: enums.AdGroupStatus.ENABLED } },
    () => '',
  );

  const AD_FIELDS: Record<string, string> = { headlines: 'headlines', descriptions: 'descriptions', youtube_videos: 'videoIds', images: 'imageAssetIds' };
  push(
    {
      entity: 'ad_group_ad',
      operation: 'create',
      resource: {
        ad_group: adGroup,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          app_ad: {
            headlines: row.headlines.map((text) => ({ text })),
            descriptions: row.descriptions.map((text) => ({ text })),
            youtube_videos: videoResources.map((asset) => ({ asset })),
            images: row.imageAssetIds.map((asset) => ({ asset })),
          },
        },
      },
    },
    (rest) => {
      const el = rest.find((p) => p.field_name && AD_FIELDS[p.field_name]);
      if (!el) return '';
      return el.index != null ? `${AD_FIELDS[el.field_name!]}.${el.index}` : AD_FIELDS[el.field_name!];
    },
  );

  return { ops, cells, newVideos };
}

// Lỗi Google → ô trên bảng: mutate_operations[i] cho biết op nào, phần còn lại cho biết trường nào.
export function mapFailure(err: unknown, cells: CellOf[]): { errors: CellError[]; requestId?: string } | null {
  const f = failureOf(err);
  if (!f) return null;
  const toCell = (item: FailureItem): CellError => {
    const [head, ...rest] = item.path;
    const cellOf = head?.field_name === 'mutate_operations' && head.index != null ? cells[head.index] : undefined;
    return { field: cellOf ? cellOf(rest) : '', message: item.message, code: item.code };
  };
  return { errors: f.items.map(toCell), requestId: f.requestId };
}

export async function mutateCountry(customer: Customer, input: CountryInput, validateOnly: boolean) {
  const { ops, cells, newVideos } = buildCountryOps(input);
  try {
    const res = await customer.mutateResources(ops, { validate_only: validateOnly, partial_failure: false });
    const responses = res.mutate_operation_responses ?? [];
    const campaignRn = responses.map((r) => r.campaign_result?.resource_name).find(Boolean);
    if (!validateOnly) {
      for (const [i, vid] of newVideos) {
        const rn = responses[i]?.asset_result?.resource_name;
        if (rn) rememberAsset(input.customerId, vid, rn);
      }
    }
    return { ok: true as const, opCount: ops.length, campaignId: campaignRn ? campaignRn.split('/').pop()! : undefined };
  } catch (err) {
    // Lỗi tạm thời ném ra để withRetry thử lại; lỗi dữ liệu trả về để tô ô
    const mapped = isTransient(err) ? null : mapFailure(err, cells);
    if (mapped) return { ok: false as const, opCount: ops.length, ...mapped, cause: err };
    throw err;
  }
}
