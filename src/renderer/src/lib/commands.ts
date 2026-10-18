import { api, parseError } from './api';
import { getState, navigate, setState } from './store';
import { queryClient } from './queries';
import { updatePrefs } from './prefs';
import { toast, toastError } from '@/components/toast';

export type CommandName = 'sync' | 'newPlan' | 'toggleJobs' | 'palette';

// Đồng bộ dữ liệu của màn hiện tại (Ctrl/⌘ R).
async function syncCurrent() {
  const { route, accounts, online } = getState();
  if (!online) return toast({ tone: 'warning', title: 'Đang mất mạng — chưa thể đồng bộ' });
  if (route === '/campaigns' && getState().campaignsTab === 'list') {
    void queryClient.invalidateQueries({ queryKey: ['ads', 'campaigns'] });
    return toast({ tone: 'info', title: 'Đang tải lại danh sách camp' });
  }
  if (route === '/analytics') {
    try {
      const days = getState().reportSync?.at ? 3 : 30;
      await api.analytics.sync(days);
      return toast({ tone: 'info', title: `Đang đồng bộ báo cáo ${days} ngày gần nhất` });
    } catch (err) {
      return toastError(parseError(err));
    }
  }
  if (route === '/creatives') {
    void queryClient.invalidateQueries({ queryKey: ['creatives'] });
    await api.creatives.refreshStatus().catch((err) => toastError(parseError(err)));
    return toast({ tone: 'info', title: 'Đã kiểm tra lại trạng thái video trên YouTube' });
  }
  if (route === '/remote-config') {
    void queryClient.invalidateQueries({ queryKey: ['rc'] });
    return toast({ tone: 'info', title: 'Đã tải lại Remote Config — bản nháp chưa publish được giữ nếu template không đổi' });
  }
  if (route === '/play') {
    void queryClient.invalidateQueries({ queryKey: ['play', 'tracks'] });
    void queryClient.invalidateQueries({ queryKey: ['play', 'reviews'] });
    return toast({ tone: 'info', title: 'Đã tải lại release và review — Store listing dùng nút “Tải lại từ Play” để không mất bản nháp' });
  }
  if (route === '/settings' || route === '/onboarding' || route === '/campaigns') {
    const active = accounts.filter((a) => a.status === 'active');
    if (!active.length) return toast({ tone: 'info', title: 'Chưa có tài khoản nào để đồng bộ' });
    try {
      for (const a of active) await api.directory.refresh(a.id);
    } catch (err) {
      toastError(parseError(err));
    }
    return;
  }
  toast({ tone: 'info', title: 'Màn này không có dữ liệu cần đồng bộ' });
}

export function runCommand(name: CommandName) {
  switch (name) {
    case 'palette':
      return setState({ paletteOpen: !getState().paletteOpen });
    case 'toggleJobs':
      return updatePrefs({ jobDrawerOpen: !getState().prefs?.jobDrawerOpen });
    case 'newPlan':
      setState({ campaignsTab: 'new' });
      return navigate('/campaigns');
    case 'sync':
      return void syncCurrent();
  }
}
