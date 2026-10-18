import { LogIn, RotateCw } from 'lucide-react';
import { useUi } from '@/lib/store';
import { TitleBar } from '@/components/shell/TitleBar';
import { Sidebar } from '@/components/shell/Sidebar';
import { ContextBar } from '@/components/shell/ContextBar';
import { JobDrawer } from '@/components/shell/JobDrawer';
import { StatusBar } from '@/components/shell/StatusBar';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { Toaster } from '@/components/toast';
import { Banner, Button } from '@/components/ui';
import { useErrorHandler, useSignIn } from '@/components/connect';
import { api } from '@/lib/api';
import { Onboarding } from '@/pages/Onboarding';
import { Settings } from '@/pages/Settings';
import { Logs } from '@/pages/Placeholders';
import { Rules } from '@/pages/rules';
import { Analytics } from '@/pages/analytics';
import { Creatives } from '@/pages/creatives';
import { Campaigns } from '@/pages/campaigns';
import { Play } from '@/pages/play';
import { RemoteConfig } from '@/pages/remoteConfig';

const PAGES = {
  '/onboarding': Onboarding,
  '/campaigns': Campaigns,
  '/creatives': Creatives,
  '/analytics': Analytics,
  '/rules': Rules,
  '/play': Play,
  '/remote-config': RemoteConfig,
  '/logs': Logs,
  '/settings': Settings,
};

// Banner trạng thái toàn app: cần đăng nhập lại (đỏ) và mất mạng (vàng).
function GlobalBanners() {
  const online = useUi((s) => s.online);
  const accounts = useUi((s) => s.accounts);
  const reauth = accounts.filter((a) => a.status === 'reauth');
  const { signIn, pending } = useSignIn();
  const update = useUi((s) => s.updateVersion);
  const onError = useErrorHandler();
  return (
    <>
      {update && (
        <Banner tone="info" action={<Button size="sm" variant="primary" icon={RotateCw} onClick={() => api.app.installUpdate().catch((e) => onError(e))}>Khởi động lại để cập nhật</Button>}>
          Đã tải xong phiên bản {update}. Cài khi bạn sẵn sàng — app sẽ tự cài lúc thoát nếu bạn chưa bấm.
        </Banner>
      )}
      {reauth.map((a) => (
        <Banner key={a.id} tone="danger"
          action={<Button size="sm" variant="primary" icon={LogIn} loading={pending === a.kind} onClick={() => signIn(a.kind)}>Đăng nhập lại</Button>}>
          <b>{a.email}</b> cần đăng nhập lại — các job dùng tài khoản này đang tạm dừng.
        </Banner>
      ))}
      {!online && (
        <Banner tone="warning">Mất mạng: đang đọc dữ liệu đã lưu trên máy; các thao tác ghi lên Google bị khóa và job chờ có mạng.</Banner>
      )}
    </>
  );
}

export function App() {
  const route = useUi((s) => s.route);
  const Page = PAGES[route];
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <ContextBar />
          <GlobalBanners />
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1 overflow-y-auto p-6">
              <Page />
            </main>
            <JobDrawer />
          </div>
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
