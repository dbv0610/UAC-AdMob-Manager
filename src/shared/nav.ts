// Thứ tự sidebar = phím tắt Ctrl/⌘ + 1–8. Mục cuối (Cài đặt) nằm riêng ở đáy sidebar.
export const NAV_ROUTES = [
  { path: '/campaigns', label: 'Campaigns' },
  { path: '/creatives', label: 'Creatives' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/rules', label: 'Rules' },
  { path: '/play', label: 'Google Play' },
  { path: '/remote-config', label: 'Remote Config' },
  { path: '/logs', label: 'Nhật ký' },
  { path: '/settings', label: 'Cài đặt' },
] as const;

export type NavPath = (typeof NAV_ROUTES)[number]['path'] | '/onboarding';
