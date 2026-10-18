import { useQuery } from '@tanstack/react-query';
import type { Dim, UnitFlag } from '@shared/analytics';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { qk } from '@/lib/queries';
import { fmtPct } from '@/lib/format';
import { useAnalyticsRange } from './RangePicker';

// Mảnh giao diện dùng chung cho các ngăn chi tiết (quốc gia, camp, ad unit).

export interface DrawerNav {
  index: number;
  total: number;
  prev: () => void;
  next: () => void;
}

export const pctOf = (v: number | null) => (v == null ? '—' : fmtPct(v, v < 0.1 ? 1 : 0));
export const countFlags = (fl: UnitFlag[] = []) => ({ danger: fl.filter((f) => f.level === 'danger').length, warning: fl.filter((f) => f.level === 'warning').length });

export function useBreakdown(dim: Dim, country: string | null) {
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const range = useAnalyticsRange();
  return useQuery({ queryKey: qk.analyticsBreakdown(appId, range, dim, country), queryFn: () => api.analytics.breakdown(appId, range, dim, country), placeholderData: (p) => (p?.dim === dim ? p : undefined) });
}

export { CompactTable, DeltaSmall, FlagList, StatGrid, type Stat } from '@/components/kit';
