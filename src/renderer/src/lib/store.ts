import { useSyncExternalStore } from 'react';
import type { Account, AppInfo, Job, Prefs, QuotaToday, UploaderState } from '@shared/types';
import type { NavPath } from '@shared/nav';
import type { AnalyticsRange, SyncStatus } from '@shared/analytics';

// Store nhỏ cho trạng thái toàn app; dữ liệu server-side dùng TanStack Query.
export interface UiState {
  route: NavPath;
  prefs: Prefs | null;
  info: AppInfo | null;
  online: boolean;
  accounts: Account[];
  jobs: Job[];
  paletteOpen: boolean;
  quota: QuotaToday | null;
  campaignsTab: CampaignsTab;
  uploader: UploaderState | null;
  uploadPct: Record<string, number>; // % upload theo creative id (không lưu DB)
  reportSync: SyncStatus | null;
  pendingSuggestions: number;
  updateVersion: string | null; // bản cập nhật đã tải xong
  analyticsRange: AnalyticsRange | null; // null = theo kỳ ở thanh ngữ cảnh
  rcProjectId: string | null; // project Firebase đang mở ở màn Remote Config
  rcAccountId: string | null; // tài khoản Firebase đang chọn; null = tất cả
}

export type CampaignsTab = 'list' | 'new' | 'history';

let state: UiState = {
  route: '/campaigns',
  prefs: null,
  info: null,
  online: navigator.onLine,
  accounts: [],
  jobs: [],
  paletteOpen: false,
  quota: null,
  campaignsTab: 'list',
  uploader: null,
  uploadPct: {},
  reportSync: null,
  pendingSuggestions: 0,
  updateVersion: null,
  analyticsRange: null,
  rcProjectId: null,
  rcAccountId: null,
};
const listeners = new Set<() => void>();

export function setState(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

export const getState = () => state;

// Selector phải trả về giá trị ổn định (field có sẵn hoặc primitive); lọc/map thì làm sau khi lấy ra,
// nếu không useSyncExternalStore sẽ render lặp vô hạn.
export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export const navigate = (route: NavPath) => setState({ route });

export function upsertJob(job: Job) {
  setState((s) => {
    const rest = s.jobs.filter((j) => j.id !== job.id);
    return { jobs: [job, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50) };
  });
}
