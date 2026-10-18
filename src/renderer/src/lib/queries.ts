import { QueryClient, useQuery } from '@tanstack/react-query';
import type { RangePreset } from '@shared/types';
import type { AnalyticsRange, Dim } from '@shared/analytics';
import { api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
});

export const qk = {
  apps: ['apps'] as const,
  adsCustomers: ['directory', 'ads'] as const,
  publishers: ['directory', 'admob'] as const,
  channels: ['directory', 'youtube'] as const,
  secrets: ['secrets'] as const,
  campaigns: (cid: string | null, range: RangePreset) => ['ads', 'campaigns', cid, range] as const,
  conversionActions: (cid: string | null) => ['ads', 'conversionActions', cid] as const,
  plans: ['plans'] as const,
  playListing: (acc: string | null, pkg: string | null) => ['play', 'listing', acc, pkg] as const,
  playImages: (acc: string | null, pkg: string | null, lang: string | null) => ['play', 'images', acc, pkg, lang] as const,
  playTracks: (acc: string | null, pkg: string | null) => ['play', 'tracks', acc, pkg] as const,
  playVitals: (pkg: string | null) => ['play', 'vitals', pkg] as const,
  playReviews: (acc: string | null, pkg: string | null) => ['play', 'reviews', acc, pkg] as const,
  playOverview: ['play', 'overview'] as const,
  creatives: ['creatives'] as const,
  analytics: (appId: string | null, range: AnalyticsRange) => ['analytics', appId, range] as const,
  analyticsCountry: (appId: string | null, range: AnalyticsRange, c: string) => ['analytics', 'country', appId, range, c] as const,
  analyticsUnit: (appId: string | null, range: AnalyticsRange, unit: string) => ['analytics', 'unit', appId, range, unit] as const,
  analyticsBreakdown: (appId: string | null, range: AnalyticsRange, dim: Dim, c: string | null) => ['analytics', 'breakdown', appId, range, dim, c] as const,
};

export const useApps = () => useQuery({ queryKey: qk.apps, queryFn: () => api.apps.list() });
export const useAdsCustomers = () => useQuery({ queryKey: qk.adsCustomers, queryFn: () => api.directory.adsCustomers() });
export const usePublishers = () => useQuery({ queryKey: qk.publishers, queryFn: () => api.directory.admobPublishers() });
export const useChannels = () => useQuery({ queryKey: qk.channels, queryFn: () => api.directory.youtubeChannels() });
export const useSecrets = () => useQuery({ queryKey: qk.secrets, queryFn: () => api.secrets.status() });

export const useCampaigns = (cid: string | null, range: RangePreset) =>
  useQuery({ queryKey: qk.campaigns(cid, range), queryFn: () => api.ads.campaigns(cid!, range), enabled: !!cid });
export const useConversionActions = (cid: string | null) =>
  useQuery({ queryKey: qk.conversionActions(cid), queryFn: () => api.ads.conversionActions(cid!), enabled: !!cid, staleTime: 5 * 60_000 });
export const usePlans = () => useQuery({ queryKey: qk.plans, queryFn: () => api.plans.list() });
export const useCreatives = () => useQuery({ queryKey: qk.creatives, queryFn: () => api.creatives.list(), staleTime: Infinity });
