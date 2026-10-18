import { Building2, CalendarDays, Flame, Globe, RefreshCw, Smartphone, UserRound } from 'lucide-react';
import { useRcProjects } from '@/pages/remoteConfig/useRc';
import { useSignIn } from '../connect';
import type { ReactNode } from 'react';
import type { RangePreset } from '@shared/types';
import { RANGE_LABEL } from '@shared/analytics';
import { useAdsCustomers, useApps } from '@/lib/queries';
import { setState, useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { runCommand } from '@/lib/commands';
import { fmtDateTime } from '@/lib/format';
import { Button, cx } from '../ui';


function Ctx({ icon: Icon, label, children }: { icon: typeof Building2; label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <Icon className="size-4 text-muted" aria-hidden />
      <span className="sr-only">{label}</span>
      {children}
    </label>
  );
}

const sel =
  'h-7 max-w-56 truncate rounded-sm border border-transparent bg-transparent px-1.5 text-sm font-medium hover:border-border focus:border-accent outline-none';

// Ngữ cảnh luôn hiển thị (nguyên tắc 3): tài khoản · app · kỳ · lần đồng bộ.
export function ContextBar() {
  const prefs = useUi((s) => s.prefs);
  const route = useUi((s) => s.route);
  const online = useUi((s) => s.online);
  const sync = useUi((s) => s.reportSync);
  const stale = sync?.at ? Date.now() - Date.parse(sync.at) > 24 * 3600_000 : false;
  const { data: customers = [] } = useAdsCustomers();
  const { data: apps = [] } = useApps();
  const leafCustomers = customers.filter((c) => !c.manager);
  const hasAdsLogin = useUi((s) => s.accounts.some((a) => a.kind === 'ads'));

  if (!prefs) return null;
  if (route === '/play') return <PlayContextBar />;
  if (route === '/remote-config') return <RcContextBar />;
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <Ctx icon={Building2} label="Tài khoản Google Ads">
        <select
          className={sel}
          value={prefs.currentAdsCustomerId ?? ''}
          onChange={(e) => updatePrefs({ currentAdsCustomerId: e.target.value || null })}
        >
          <option value="">{leafCustomers.length ? 'Chọn tài khoản…' : hasAdsLogin ? 'Không đọc được tài khoản Ads — xem Nhật ký' : 'Chưa có tài khoản Ads'}</option>
          {leafCustomers.map((c) => (
            <option key={c.customerId} value={c.customerId}>
              {c.name} · {c.customerId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')} · {c.currency}
            </option>
          ))}
        </select>
      </Ctx>
      <Ctx icon={Smartphone} label="App">
        <select className={sel} value={prefs.currentAppId ?? ''} onChange={(e) => updatePrefs({ currentAppId: e.target.value || null })}>
          <option value="">{apps.length ? 'Tất cả app' : 'Chưa map app'}</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Ctx>
      {/* Analytics có bộ chọn kỳ riêng (thêm 90 ngày, theo tháng, tự chọn) */}
      {route !== '/analytics' && <Ctx icon={CalendarDays} label="Kỳ báo cáo">
        <select className={sel} value={prefs.range} onChange={(e) => { setState({ analyticsRange: null }); void updatePrefs({ range: e.target.value as RangePreset }); }}>
          {Object.entries(RANGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Ctx>}
      <div className="flex-1" />
      <span className={cx('text-xs', stale ? 'text-warning' : 'text-muted')} title={sync?.from ? `Kỳ: ${sync.from} → ${sync.to}` : undefined}>
        {sync?.at ? `Báo cáo đồng bộ lúc ${fmtDateTime(sync.at)}` : 'Chưa đồng bộ báo cáo'}
      </span>
      <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!online} onClick={() => runCommand('sync')} title="Đồng bộ (Ctrl/⌘ R)">
        Đồng bộ
      </Button>
    </div>
  );
}

// Màn Google Play độc lập với quảng cáo: chỉ app Google Play + tài khoản Play, không có tài khoản Ads / kỳ báo cáo.
function PlayContextBar() {
  const currentAppId = useUi((s) => s.prefs?.currentAppId ?? null);
  const online = useUi((s) => s.online);
  const accounts = useUi((s) => s.accounts).filter((a) => a.kind === 'play');
  const { data: apps = [] } = useApps();
  const gp = apps.filter((a) => a.store === 'GOOGLE_PLAY');
  const value = gp.some((a) => a.id === currentAppId) ? currentAppId! : '';
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <Ctx icon={Smartphone} label="App Google Play">
        <select className={sel} value={value} onChange={(e) => updatePrefs({ currentAppId: e.target.value || null })}>
          <option value="">{gp.length ? `Tất cả app Google Play (${gp.length})` : 'Chưa map app Google Play'}</option>
          {gp.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Ctx>
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <Globe className="size-4" aria-hidden />
        {accounts.length ? accounts.map((a) => a.email).join(' · ') : 'Chưa đăng nhập Google Play'}
      </span>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!online || !accounts.length} onClick={() => runCommand('sync')} title="Tải lại release và review (Ctrl/⌘ R)">
        Tải lại
      </Button>
    </div>
  );
}

// Màn Remote Config độc lập: chọn tài khoản Firebase (nhiều tài khoản) + project, không có tài khoản Ads / kỳ báo cáo.
function RcContextBar() {
  const projectId = useUi((s) => s.rcProjectId);
  const online = useUi((s) => s.online);
  const { accounts, accountId, projects, countOf } = useRcProjects();
  const { signIn, pending } = useSignIn();
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <Ctx icon={UserRound} label="Tài khoản Firebase">
        <select className={sel} value={accountId ?? ''} disabled={pending === 'firebase'}
          onChange={(e) => {
            if (e.target.value === '__add') return void signIn('firebase');
            setState({ rcAccountId: e.target.value || null });
          }}>
          <option value="">{accounts.length ? `Tất cả tài khoản (${accounts.length})` : 'Chưa đăng nhập Firebase'}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={a.status !== 'active'}>
              {a.email} · {countOf(a.id)} project{a.status !== 'active' ? ' (cần đăng nhập lại)' : ''}
            </option>
          ))}
          <option value="__add">+ Thêm tài khoản Firebase…</option>
        </select>
      </Ctx>
      <Ctx icon={Flame} label="Project Firebase">
        <select className={sel} value={projects.some((p) => p.projectId === projectId) ? projectId! : ''} onChange={(e) => setState({ rcProjectId: e.target.value || null })}>
          <option value="">{projects.length ? `Chọn project (${projects.length})` : 'Chưa có project'}</option>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName} · {p.projectId}</option>)}
        </select>
      </Ctx>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!online || !accounts.length} onClick={() => runCommand('sync')} title="Tải lại template (Ctrl/⌘ R)">
        Tải lại
      </Button>
    </div>
  );
}
