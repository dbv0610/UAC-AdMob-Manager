import { enums, type MutateOperation } from 'google-ads-api';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { addUsage } from '../quota';
import { emit, byYoutubeIds } from '../creatives/library';
import { assertOnline, customerById, withRetry, wrapAdsError } from './client';
import { rememberAsset, resolveVideoAssets } from './campaignBuilder';
import { pickReplacements, type AttachPreview, type LowVideo } from '@shared/creative';
import { listCreatives } from '../creatives/library';
import { campaignMeta } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { setJson } from '../settingsStore';

// "Thêm video vào camp" cho camp đang chạy: gộp video cũ + mới (tối đa 20), không thay toàn bộ.

export const MAX_VIDEOS = 20;

interface AdRow {
  campaignId: string;
  campaignName: string;
  adResource: string;
  videos: string[]; // asset resource name
}

// Thuần: video mới chưa có trong ad thì nối vào cuối, cắt ở 20.
export function mergeVideos(existing: string[], additions: { videoId: string; asset: string | null }[], limit = MAX_VIDEOS) {
  const have = new Set(existing);
  const fresh = additions.filter((a) => !a.asset || !have.has(a.asset));
  const room = Math.max(0, limit - existing.length);
  return { kept: fresh.slice(0, room), dropped: fresh.slice(room), overLimit: fresh.length > room };
}

export async function loadAds(customerId: string, campaignIds: string[]) {
  const { customer } = customerById(customerId);
  const rows = await customer.query(`
    SELECT campaign.id, campaign.name, ad_group_ad.ad.resource_name, ad_group_ad.ad.app_ad.youtube_videos
    FROM ad_group_ad
    WHERE campaign.id IN (${campaignIds.join(',')})
      AND ad_group_ad.status != 'REMOVED'
      AND campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'`);
  return rows.map(
    (r): AdRow => ({
      campaignId: String(r.campaign!.id),
      campaignName: r.campaign!.name ?? '',
      adResource: r.ad_group_ad!.ad!.resource_name!,
      videos: (r.ad_group_ad!.ad!.app_ad?.youtube_videos ?? []).map((v) => v.asset!).filter(Boolean),
    }),
  );
}

export async function previewAttach(customerId: string, campaignIds: string[], videoIds: string[]): Promise<AttachPreview[]> {
  const { customer, row } = customerById(customerId);
  try {
    const [ads, assets] = await Promise.all([loadAds(customerId, campaignIds), resolveVideoAssets(customer, customerId, videoIds)]);
    const additions = videoIds.map((videoId) => ({ videoId, asset: assets.get(videoId) ?? null }));
    const byCampaign = new Map<string, AttachPreview>();
    for (const ad of ads) {
      if (byCampaign.has(ad.campaignId)) continue; // camp App thường 1 ad; xem trước theo ad đầu
      const m = mergeVideos(ad.videos, additions);
      byCampaign.set(ad.campaignId, {
        campaignId: ad.campaignId,
        name: ad.campaignName,
        before: ad.videos.length,
        after: ad.videos.length + m.kept.length,
        added: m.kept.map((k) => k.videoId),
        overLimit: m.overLimit,
      });
    }
    return campaignIds.map((id) => byCampaign.get(id) ?? { campaignId: id, name: id, before: 0, after: 0, added: [], overLimit: false });
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

export async function attachVideos(customerId: string, campaignIds: string[], videoIds: string[], actor = 'user') {
  assertOnline();
  const { customer, row } = customerById(customerId);
  try {
    const [ads, assets] = await Promise.all([loadAds(customerId, campaignIds), resolveVideoAssets(customer, customerId, videoIds)]);
    const ops: MutateOperation<Record<string, unknown>>[] = [];
    const newAssetIdx = new Map<number, string>(); // op index → videoId
    // Asset chưa có: tạo trong cùng mutate với ID tạm âm, các ad tham chiếu ID tạm đó
    const tmp = new Map<string, string>();
    videoIds.forEach((vid, j) => {
      if (assets.get(vid)) return;
      const rn = `customers/${customerId}/assets/-${j + 1}`;
      tmp.set(vid, rn);
      newAssetIdx.set(ops.length, vid);
      ops.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, type: enums.AssetType.YOUTUBE_VIDEO, youtube_video_asset: { youtube_video_id: vid } } });
    });
    const additions = videoIds.map((videoId) => ({ videoId, asset: assets.get(videoId) ?? null }));
    const changed: { ad: AdRow; added: string[] }[] = [];
    for (const ad of ads) {
      const m = mergeVideos(ad.videos, additions);
      if (!m.kept.length) continue;
      const list = [...ad.videos, ...m.kept.map((k) => k.asset ?? tmp.get(k.videoId)!)];
      ops.push({ entity: 'ad', operation: 'update', resource: { resource_name: ad.adResource, app_ad: { youtube_videos: list.map((asset) => ({ asset })) } } });
      changed.push({ ad, added: m.kept.map((k) => k.videoId) });
    }
    // Asset tạo ra mà không ad nào dùng thì khỏi tạo
    if (!changed.length) return { campaigns: 0, ads: 0, operations: 0 };

    const res = await withRetry(() => customer.mutateResources(ops, { partial_failure: false }));
    const responses = res.mutate_operation_responses ?? [];
    for (const [i, vid] of newAssetIdx) {
      const rn = responses[i]?.asset_result?.resource_name;
      if (rn) rememberAsset(customerId, vid, rn);
    }
    addUsage('ads.operations', ops.length);
    const requestId = (res as { request_id?: string }).request_id;
    db.transaction((tx) => {
      for (const c of changed) {
        tx.insert(auditLog)
          .values({ actor, entity: 'ad.youtube_videos', entityId: c.ad.adResource, before: JSON.stringify(c.ad.videos.length), after: JSON.stringify({ added: c.added }), requestId })
          .run();
      }
    });
    emit(byYoutubeIds(videoIds).map((r) => r.id)); // cập nhật huy hiệu "Đã gắn"
    return { campaigns: new Set(changed.map((c) => c.ad.campaignId)).size, ads: changed.length, operations: ops.length };
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

// ── Video hiệu quả thấp: quét ad_group_ad_asset_view, gợi ý video thay từ thư viện ──
export async function scanLowVideos(customerId: string): Promise<LowVideo[]> {
  const { customer, row } = customerById(customerId);
  try {
    const rows = await withRetry(() =>
      customer.query(`
        SELECT campaign.id, campaign.name, ad_group_ad.ad.resource_name, asset.resource_name,
               asset.youtube_video_asset.youtube_video_id, ad_group_ad_asset_view.performance_label
        FROM ad_group_ad_asset_view
        WHERE campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'
          AND campaign.status != 'REMOVED'
          AND ad_group_ad_asset_view.field_type = 'YOUTUBE_VIDEO'
          AND ad_group_ad_asset_view.performance_label = 'LOW'
          AND ad_group_ad_asset_view.enabled = TRUE`),
    );
    if (!rows.length) {
      setJson(`lowVideos:${customerId}`, { at: new Date().toISOString(), items: [] });
      return [];
    }
    const campaignIds = [...new Set(rows.map((r) => String(r.campaign!.id)))];
    const ads = await loadAds(customerId, campaignIds);
    // asset resource name → YouTube ID cho các video đang nằm trong ad
    const assetRns = [...new Set(ads.flatMap((a) => a.videos))];
    const idOf = new Map<string, string>();
    if (assetRns.length) {
      const res = await customer.query(`
        SELECT asset.resource_name, asset.youtube_video_asset.youtube_video_id
        FROM asset WHERE asset.resource_name IN (${assetRns.map((r) => `'${r}'`).join(',')})`);
      for (const a of res) if (a.asset?.resource_name && a.asset.youtube_video_asset?.youtube_video_id) idOf.set(a.asset.resource_name, a.asset.youtube_video_asset.youtube_video_id);
    }
    const library = listCreatives();
    const out: LowVideo[] = rows.map((r) => {
      const campaignId = String(r.campaign!.id);
      const adResource = r.ad_group_ad!.ad!.resource_name!;
      const lowVideoId = r.asset?.youtube_video_asset?.youtube_video_id ?? '';
      const meta = db.select().from(campaignMeta).where(eq(campaignMeta.campaignId, campaignId)).get();
      const name = r.campaign!.name ?? meta?.name ?? campaignId;
      const country = name.match(/_([A-Z]{2})(?=_|$)/)?.[1] ?? null;
      const lowAspect = library.find((c) => c.youtubeId === lowVideoId)?.aspect ?? null;
      const inAd = (ads.find((a) => a.adResource === adResource)?.videos ?? []).map((v) => idOf.get(v)).filter((x): x is string => !!x);
      return {
        customerId,
        campaignId,
        campaignName: name,
        country,
        adResource,
        lowAsset: r.asset!.resource_name!,
        lowVideoId,
        lowAspect,
        candidates: pickReplacements(library, country, lowAspect, inAd),
      };
    });
    setJson(`lowVideos:${customerId}`, { at: new Date().toISOString(), items: out });
    return out;
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

// Thay: bỏ asset LOW khỏi ad, thêm video mới (tạo asset nếu chưa có) — một mutate, ghi audit_log
export async function replaceVideos(customerId: string, items: { adResource: string; campaignId: string; removeAsset: string; addVideoId: string }[], actor = 'user') {
  assertOnline();
  const { customer, row } = customerById(customerId);
  try {
    const campaignIds = [...new Set(items.map((i) => i.campaignId))];
    const [ads, assets] = await Promise.all([loadAds(customerId, campaignIds), resolveVideoAssets(customer, customerId, items.map((i) => i.addVideoId))]);
    const ops: MutateOperation<Record<string, unknown>>[] = [];
    const tmp = new Map<string, string>();
    const newAssetIdx = new Map<number, string>();
    [...new Set(items.map((i) => i.addVideoId))].forEach((vid, j) => {
      if (assets.get(vid)) return;
      const rn = `customers/${customerId}/assets/-${j + 1}`;
      tmp.set(vid, rn);
      newAssetIdx.set(ops.length, vid);
      ops.push({ entity: 'asset', operation: 'create', resource: { resource_name: rn, type: enums.AssetType.YOUTUBE_VIDEO, youtube_video_asset: { youtube_video_id: vid } } });
    });
    const byAd = new Map<string, string[]>();
    for (const ad of ads) byAd.set(ad.adResource, [...ad.videos]);
    for (const it of items) {
      const list = byAd.get(it.adResource);
      if (!list) continue;
      const add = assets.get(it.addVideoId) ?? tmp.get(it.addVideoId)!;
      byAd.set(it.adResource, [...list.filter((v) => v !== it.removeAsset), ...(list.includes(add) ? [] : [add])]);
    }
    const touched = [...new Set(items.map((i) => i.adResource))].filter((a) => byAd.has(a));
    for (const ad of touched) ops.push({ entity: 'ad', operation: 'update', resource: { resource_name: ad, app_ad: { youtube_videos: byAd.get(ad)!.slice(0, MAX_VIDEOS).map((asset) => ({ asset })) } } });
    if (!touched.length) return { ads: 0, operations: 0 };

    const res = await withRetry(() => customer.mutateResources(ops, { partial_failure: false }));
    const responses = res.mutate_operation_responses ?? [];
    for (const [i, vid] of newAssetIdx) {
      const rn = responses[i]?.asset_result?.resource_name;
      if (rn) rememberAsset(customerId, vid, rn);
    }
    addUsage('ads.operations', ops.length);
    const requestId = (res as { request_id?: string }).request_id;
    db.transaction((tx) => {
      for (const it of items) {
        tx.insert(auditLog).values({ actor, entity: 'ad.youtube_videos.replace', entityId: it.campaignId, before: JSON.stringify(it.removeAsset), after: JSON.stringify(it.addVideoId), requestId }).run();
      }
    });
    emit(byYoutubeIds(items.map((i) => i.addVideoId)).map((r) => r.id));
    return { ads: touched.length, operations: ops.length };
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}
