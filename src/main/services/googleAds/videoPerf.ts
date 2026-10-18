import { enums } from 'google-ads-api';
import { getJson, setJson } from '../settingsStore';
import { customerById, withRetry, wrapAdsError } from './client';
import { rankVideos, type GoogleLabel, type VideoPerfResult } from '@shared/insights';

// Hiệu quả từng video YouTube trong App campaign: ad_group_ad_asset_view theo (camp, video) trong kỳ.
// Lưu kết quả lần quét gần nhất để mở lại màn không phải gọi API.

const enumName = <T extends Record<string | number, string | number>>(e: T, v: unknown) => (typeof v === 'number' ? String(e[v as keyof T] ?? v) : String(v ?? 'UNKNOWN'));

export async function scanVideoPerf(customerId: string, from: string, to: string): Promise<VideoPerfResult> {
  const { customer, row } = customerById(customerId);
  try {
    const rows = await withRetry(() =>
      customer.query(`
        SELECT campaign.id, campaign.name, asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title,
               ad_group_ad_asset_view.performance_label, ad_group_ad_asset_view.enabled,
               metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM ad_group_ad_asset_view
        WHERE campaign.advertising_channel_sub_type = 'APP_CAMPAIGN'
          AND campaign.status != 'REMOVED'
          AND ad_group_ad_asset_view.field_type = 'YOUTUBE_VIDEO'
          AND segments.date BETWEEN '${from}' AND '${to}'`),
    );
    const flat = rows
      .filter((r) => r.asset?.youtube_video_asset?.youtube_video_id)
      .map((r) => {
        const name = r.campaign!.name ?? String(r.campaign!.id);
        const label = enumName(enums.AssetPerformanceLabel, r.ad_group_ad_asset_view?.performance_label) as GoogleLabel;
        return {
          videoId: r.asset!.youtube_video_asset!.youtube_video_id!,
          title: r.asset!.youtube_video_asset!.youtube_video_title ?? '',
          campaignId: String(r.campaign!.id),
          campaignName: name,
          country: name.match(/_([A-Z]{2})(?=_|$)/)?.[1] ?? null,
          label: (['BEST', 'GOOD', 'LOW', 'LEARNING', 'PENDING'].includes(label) ? label : 'UNKNOWN') as GoogleLabel,
          enabled: r.ad_group_ad_asset_view?.enabled !== false,
          impressions: Number(r.metrics?.impressions ?? 0),
          clicks: Number(r.metrics?.clicks ?? 0),
          costMicros: Number(r.metrics?.cost_micros ?? 0),
          conversions: Number(r.metrics?.conversions ?? 0),
        };
      });
    // Một video có thể nằm ở nhiều ad group của cùng camp: gộp theo (camp, video)
    const merged = new Map<string, (typeof flat)[number]>();
    for (const r of flat) {
      const k = `${r.campaignId}|${r.videoId}`;
      const m = merged.get(k);
      if (!m) merged.set(k, { ...r });
      else {
        m.impressions += r.impressions;
        m.clicks += r.clicks;
        m.costMicros += r.costMicros;
        m.conversions += r.conversions;
        m.enabled ||= r.enabled;
        if (m.label === 'UNKNOWN' || m.label === 'PENDING') m.label = r.label;
      }
    }
    const result: VideoPerfResult = { at: new Date().toISOString(), from, to, items: rankVideos([...merged.values()]) };
    setJson(`videoPerf:${customerId}`, result);
    return result;
  } catch (err) {
    throw wrapAdsError(row.accountId, err);
  }
}

export const videoPerfCached = (customerId: string) => getJson<VideoPerfResult>(`videoPerf:${customerId}`);
