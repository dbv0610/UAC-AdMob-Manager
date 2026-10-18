import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Globe, LogIn, Settings2 } from 'lucide-react';
import { navigate, useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { useApps } from '@/lib/queries';
import { api, parseError } from '@/lib/api';
import { Banner, Button, Card, EmptyState, PageHeader, Select, Skeleton, cx } from '@/components/ui';
import { useSignIn } from '@/components/connect';
import { Guide } from '@/components/guides';
import { AppIcon, useIconBackfill } from '@/components/AppIcon';
import { ListingTab } from './listing';
import { Overview } from './Overview';
import { Releases } from './Releases';
import { Vitals } from './Vitals';
import { Reviews } from './Reviews';

type Tab = 'overview' | 'listing' | 'releases' | 'vitals' | 'reviews';
type AppTab = Exclude<Tab, 'overview'>;
const TABS: [Tab, string][] = [
  ['overview', 'Tổng quan'],
  ['listing', 'Store listing'],
  ['releases', 'Release'],
  ['vitals', 'Vitals'],
  ['reviews', 'Review'],
];

// App đang chọn = ô App trên thanh ngữ cảnh (dùng chung mọi màn). "Tất cả app" → bảng tổng quan.
// Tài khoản Play tự dò theo package; chỉ hiện ô chọn khi có nhiều tài khoản.
export function Play() {
  const accounts = useUi((s) => s.accounts).filter((a) => a.kind === 'play');
  const currentAppId = useUi((s) => s.prefs?.currentAppId ?? null);
  const { data: allApps = [], isLoading } = useApps();
  const apps = allApps.filter((a) => a.store === 'GOOGLE_PLAY');
  const app = apps.find((a) => a.id === currentAppId) ?? null;
  const iosSelected = !!currentAppId && !app && allApps.some((a) => a.id === currentAppId);
  const [tab, setTab] = useState<Tab>(app ? 'listing' : 'overview');
  const [override, setOverride] = useState<Record<string, string>>({}); // package → tài khoản chọn tay
  const { signIn, pending } = useSignIn();
  useIconBackfill(apps);

  const pkg = app?.storeAppId ?? null;
  const resolved = useQuery({ queryKey: ['play', 'account', pkg], queryFn: () => api.play.resolveAccount(pkg!), enabled: !!pkg && accounts.length > 0, staleTime: Infinity, retry: false });
  const accountId = (pkg && override[pkg]) || resolved.data || null;

  // Tab đã mở thì giữ nguyên (ẩn đi) để không mất bản nháp Store listing khi chuyển tab
  const [seen, setSeen] = useState<Set<Tab>>(new Set([tab]));
  const open = (t: Tab) => {
    setTab(t);
    setSeen((s) => (s.has(t) ? s : new Set(s).add(t)));
  };
  const openApp = (appId: string, t: AppTab) => {
    void updatePrefs({ currentAppId: appId });
    open(t);
  };
  // Chọn app từ sidebar / thanh trên khi đang ở Tổng quan → mở luôn Store listing của app đó
  const appKey = app?.id ?? null;
  useEffect(() => {
    if (appKey && tab === 'overview') open('listing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appKey]);

  if (!accounts.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Google Play" />
        <EmptyState icon={Globe} title="Chưa kết nối Google Play"
          action={<Button variant="primary" icon={LogIn} loading={pending === 'play'} onClick={() => signIn('play')}>Đăng nhập Google Play</Button>}>
          Đăng nhập email có quyền trên Play Console để quản lý trang thông tin, release, vitals và review của các app.
        </EmptyState>
        <Guide id="playSignIn" defaultOpen />
      </div>
    );
  }
  if (isLoading) return <Skeleton className="h-64" />;
  if (!apps.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Google Play" />
        <EmptyState icon={Globe} title="Chưa map app Google Play" action={<Button icon={Settings2} onClick={() => navigate('/settings')}>Mở Cài đặt → App</Button>}>
          Thêm app với cửa hàng Google Play và package name để quản lý ở đây.
        </EmptyState>
      </div>
    );
  }

  const active: Tab = app ? tab : 'overview';
  const key = `${accountId}|${pkg}`;

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
      <PageHeader title={app ? `Google Play · ${app.name}` : 'Google Play'} leading={app && <AppIcon url={app.iconUrl} name={app.name} size="lg" />}>
        {app && (
          <>
            <span className="font-mono text-xs text-muted" data-selectable>{app.storeAppId}</span>
            {accounts.length > 1 ? (
              <Select className="w-56" aria-label="Tài khoản Google Play" value={accountId ?? ''} onChange={(e) => setOverride({ ...override, [app.storeAppId]: e.target.value })}>
                {!accountId && <option value="">Đang dò tài khoản…</option>}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
              </Select>
            ) : null}
            <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => { void updatePrefs({ currentAppId: null }); open('overview'); }}>Tất cả app</Button>
          </>
        )}
      </PageHeader>
      <div role="tablist" className="-mt-3 flex gap-1 border-b border-border">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={active === id} disabled={id !== 'overview' && !app} onClick={() => open(id)}
            title={id !== 'overview' && !app ? 'Chọn một app trong bảng hoặc ở ô App phía trên' : undefined}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm disabled:opacity-40', active === id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      {iosSelected && active === 'overview' && <p className="-mt-2 text-sm text-muted">App đang chọn ở thanh trên là app iOS — màn này chỉ quản lý app Google Play.</p>}

      {active === 'overview' && <Overview onOpen={(row, t) => openApp(row.appId, t)} />}
      {app && active !== 'overview' && !accountId && (
        resolved.isError ? (
          <Card className="overflow-hidden">
            <Banner tone="danger" action={<Button size="sm" onClick={() => void resolved.refetch()}>Thử lại</Button>}>{parseError(resolved.error).message}</Banner>
          </Card>
        ) : <Skeleton className="h-64" />
      )}
      {app && accountId && (
        <>
          {seen.has('listing') && <div key={key} className={cx(active !== 'listing' && 'hidden')}><ListingTab accountId={accountId} pkg={app.storeAppId} /></div>}
          {active === 'releases' && <Releases key={key} accountId={accountId} pkg={app.storeAppId} />}
          {active === 'vitals' && <Vitals key={key} accountId={accountId} pkg={app.storeAppId} />}
          {active === 'reviews' && <Reviews key={key} accountId={accountId} pkg={app.storeAppId} appName={app.name} />}
        </>
      )}
    </div>
  );
}
