import { useState } from 'react';
import { BarChart3, Film, Globe, Megaphone, SlidersHorizontal, ScrollText, Settings, Workflow, PanelLeftClose, PanelLeftOpen, ChevronDown, LayoutGrid, Plus, UserRound, Users, type LucideIcon } from 'lucide-react';
import { NAV_ROUTES, type NavPath } from '@shared/nav';
import { navigate, setState, useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { useMediaQuery } from '@/lib/hooks';
import { Kbd, cx } from '../ui';
import { useSignIn } from '../connect';
import { useRcProjects } from '@/pages/remoteConfig/useRc';
import { useApps } from '@/lib/queries';
import { AppIcon } from '../AppIcon';

const SUBMENU: Partial<Record<NavPath, string>> = { '/play': 'Xổ danh sách app Google Play', '/remote-config': 'Xổ danh sách tài khoản Firebase' };

const subItem = (on: boolean) =>
  cx('flex h-7 w-full items-center gap-2 rounded-sm pr-2 pl-8 text-left text-[13px]', on ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-accent/10 hover:text-accent');

// Menu con của Google Play: chuyển nhanh giữa các app (một tài khoản Play, không thêm tài khoản ở đây)
function PlayAppsMenu({ active }: { active: boolean }) {
  const currentAppId = useUi((s) => s.prefs?.currentAppId ?? null);
  const { data: apps = [] } = useApps();
  const gp = apps.filter((a) => a.store === 'GOOGLE_PLAY');
  const pick = (id: string | null) => {
    void updatePrefs({ currentAppId: id });
    navigate('/play');
  };
  const isCurrent = (id: string) => gp.some((a) => a.id === currentAppId) && currentAppId === id;
  return (
    <ul className="mt-0.5 flex max-h-72 flex-col gap-0.5 overflow-y-auto" aria-label="Danh sách app Google Play">
      <li>
        <button className={subItem(active && !gp.some((a) => a.id === currentAppId))} onClick={() => pick(null)}>
          <LayoutGrid className="size-3.5 shrink-0" aria-hidden /><span className="flex-1 truncate">Tất cả app</span><span className="num text-[11px] opacity-70">{gp.length}</span>
        </button>
      </li>
      {gp.map((a) => (
        <li key={a.id}>
          <button className={subItem(active && isCurrent(a.id))} onClick={() => pick(a.id)} title={`${a.name} · ${a.storeAppId}`}>
            <AppIcon url={a.iconUrl} name={a.name} size="xs" />
            <span className="flex-1 truncate">{a.name}</span>
          </button>
        </li>
      ))}
      {!gp.length && <li className="pl-8 text-xs text-muted">Chưa map app Google Play</li>}
    </ul>
  );
}

// Menu con của Remote Config: chọn tài khoản Firebase (đồng bộ với ô chọn trên thanh ngữ cảnh)
function RcAccountsMenu({ active }: { active: boolean }) {
  const { accounts, accountId, countOf } = useRcProjects();
  const { signIn, pending } = useSignIn();
  const pick = (id: string | null) => {
    setState({ rcAccountId: id });
    navigate('/remote-config');
  };
  const sub = subItem;
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5" aria-label="Danh sách tài khoản Firebase">
      {accounts.length > 1 && (
        <li><button className={sub(active && !accountId)} onClick={() => pick(null)}><Users className="size-3.5 shrink-0" aria-hidden /><span className="flex-1 truncate">Tất cả tài khoản</span></button></li>
      )}
      {accounts.map((a) => (
        <li key={a.id}>
          <button className={sub(active && (accountId === a.id || (accounts.length === 1 && !accountId)))} disabled={a.status !== 'active'} onClick={() => pick(a.id)} title={a.email}>
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{a.email}</span>
            {a.status === 'active' ? <span className="num text-[11px] opacity-70">{countOf(a.id)}</span> : <span className="text-[11px] text-danger">đăng nhập lại</span>}
          </button>
        </li>
      ))}
      <li>
        <button className={sub(false)} disabled={pending === 'firebase'} onClick={() => void signIn('firebase')}>
          <Plus className="size-3.5 shrink-0" aria-hidden /><span className="flex-1 truncate">{pending === 'firebase' ? 'Đang mở đăng nhập…' : 'Thêm tài khoản Firebase'}</span>
        </button>
      </li>
    </ul>
  );
}

const ICONS: Record<string, LucideIcon> = {
  '/campaigns': Megaphone,
  '/creatives': Film,
  '/analytics': BarChart3,
  '/rules': Workflow,
  '/play': Globe,
  '/remote-config': SlidersHorizontal,
  '/logs': ScrollText,
  '/settings': Settings,
};

export function Sidebar() {
  const route = useUi((s) => s.route);
  const pinnedCollapsed = useUi((s) => s.prefs?.sidebarCollapsed ?? false);
  const mod = useUi((s) => (s.info?.platform === 'darwin' ? '⌘' : 'Ctrl'));
  const narrow = useMediaQuery('(max-width: 1099px)');
  const pending = useUi((s) => s.pendingSuggestions);
  const collapsed = narrow || pinnedCollapsed;
  // Google Play xổ danh sách app, Remote Config xổ danh sách tài khoản Firebase; mặc định mở khi đang ở màn đó
  const [open, setOpen] = useState<Partial<Record<NavPath, boolean>>>({});
  const isOpen = (p: NavPath) => open[p] ?? route === p;

  const item = (path: NavPath, label: string, i: number) => {
    const Icon = ICONS[path];
    const active = route === path;
    return (
      <li key={path}>
        <button
          onClick={() => navigate(path)}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          title={collapsed || path in SUBMENU ? `${label} (${mod}+${i + 1})` : undefined}
          className={cx(
            'group flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-sm',
            active ? 'bg-accent font-medium text-accent-fg shadow-sm' : 'text-muted hover:bg-accent/10 hover:text-accent',
          )}
        >
          <span className="relative">
            <Icon className="size-4 shrink-0" aria-hidden />
            {collapsed && path === '/rules' && pending > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-accent-2" aria-hidden />}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">{label}</span>
              {path in SUBMENU && (
                <span role="button" tabIndex={-1} aria-label={isOpen(path) ? `Thu gọn ${label}` : SUBMENU[path]}
                  onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [path]: !isOpen(path) }); }}
                  className={cx('rounded-sm p-0.5', active ? 'hover:bg-white/15' : 'hover:bg-accent/15')}>
                  <ChevronDown className={cx('size-3.5 transition-transform', isOpen(path) && 'rotate-180')} aria-hidden />
                </span>
              )}
              {path === '/rules' && pending > 0 && (
                <span className="num rounded-full bg-accent-2 px-1.5 text-[11px] font-semibold text-white" aria-label={`${pending} đề xuất chờ duyệt`}>{pending}</span>
              )}
              {/* Mục có menu con: chỗ đó dành cho mũi tên xổ xuống, phím tắt xem ở tooltip */}
              {!(path in SUBMENU) && (
                <span className={cx('opacity-0 group-hover:opacity-100', active && 'hidden')}>
                  <Kbd>{mod} {i + 1}</Kbd>
                </span>
              )}
            </>
          )}
        </button>
        {path === '/remote-config' && isOpen(path) && !collapsed && <RcAccountsMenu active={active} />}
        {path === '/play' && isOpen(path) && !collapsed && <PlayAppsMenu active={active} />}
      </li>
    );
  };

  const main = NAV_ROUTES.slice(0, -1);
  const settings = NAV_ROUTES[NAV_ROUTES.length - 1];

  return (
    <nav aria-label="Điều hướng chính" className={cx('flex shrink-0 flex-col border-r border-border bg-surface-2 p-2', collapsed ? 'w-12' : 'w-52')}>
      <ul className="flex flex-col gap-0.5">
        {main.map((r, i) => (
          // Google Play + Remote Config tách riêng khỏi nhóm quảng cáo
          r.path === '/play' ? [<li key="play-sep" role="separator" className="my-1.5 border-t border-border" />, item(r.path, r.label, i)] : item(r.path, r.label, i)
        ))}
      </ul>
      <div className="flex-1" />
      <ul className="flex flex-col gap-0.5">
        {item(settings.path, settings.label, NAV_ROUTES.length - 1)}
        {!narrow && (
          <li>
            <button
              onClick={() => updatePrefs({ sidebarCollapsed: !pinnedCollapsed })}
              className="flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-sm text-muted hover:bg-surface-2 hover:text-text"
              aria-label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && <span>Thu gọn</span>}
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
