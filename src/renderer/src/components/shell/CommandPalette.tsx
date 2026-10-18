import { Command } from 'cmdk';
import { ArrowRight, ListTodo, Moon, Plus, RefreshCw, Smartphone, Sun } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { NAV_ROUTES } from '@shared/nav';
import { navigate, setState, useUi } from '@/lib/store';
import { runCommand } from '@/lib/commands';
import { updatePrefs } from '@/lib/prefs';
import { useApps } from '@/lib/queries';

function Item({ onSelect, icon, children, value }: { onSelect: () => void; icon: ReactNode; children: ReactNode; value: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={() => {
        setState({ paletteOpen: false });
        onSelect();
      }}
      className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm text-text data-[selected=true]:bg-accent data-[selected=true]:text-accent-fg"
    >
      {icon}
      {children}
    </Command.Item>
  );
}

const group = 'px-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted';

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const theme = useUi((s) => s.prefs?.theme);
  const { data: apps = [] } = useApps();

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setState({ paletteOpen: false });
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  if (!open) return null;
  const icon = 'size-4 shrink-0';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 pt-[12vh]" onMouseDown={() => setState({ paletteOpen: false })}>
      <Command
        label="Bảng lệnh"
        loop
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[560px] overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      >
        <div className="brand-gradient h-0.5" aria-hidden />
        <Command.Input autoFocus placeholder="Gõ để tìm màn, lệnh, app…" className="h-11 w-full border-b border-border bg-transparent px-4 text-base outline-none" />
        <Command.List className="max-h-80 overflow-y-auto py-1">
          <Command.Empty className="px-4 py-6 text-center text-sm text-muted">Không có kết quả</Command.Empty>
          <Command.Group heading="Chuyển màn" className={group}>
            {NAV_ROUTES.map((r) => (
              <Item key={r.path} value={`màn ${r.label}`} onSelect={() => navigate(r.path)} icon={<ArrowRight className={icon} />}>
                {r.label}
              </Item>
            ))}
            <Item value="màn onboarding kết nối" onSelect={() => navigate('/onboarding')} icon={<ArrowRight className={icon} />}>
              Kết nối tài khoản (Onboarding)
            </Item>
          </Command.Group>
          <Command.Group heading="Lệnh" className={group}>
            <Item value="tạo kế hoạch camp mới" onSelect={() => runCommand('newPlan')} icon={<Plus className={icon} />}>Kế hoạch camp mới</Item>
            <Item value="đồng bộ dữ liệu" onSelect={() => runCommand('sync')} icon={<RefreshCw className={icon} />}>Đồng bộ màn hiện tại</Item>
            <Item value="hàng đợi job" onSelect={() => runCommand('toggleJobs')} icon={<ListTodo className={icon} />}>Mở/đóng hàng đợi job</Item>
            <Item
              value="đổi giao diện sáng tối theme"
              onSelect={() => updatePrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
              icon={theme === 'dark' ? <Sun className={icon} /> : <Moon className={icon} />}
            >
              Chuyển sang giao diện {theme === 'dark' ? 'sáng' : 'tối'}
            </Item>
          </Command.Group>
          {apps.length > 0 && (
            <Command.Group heading="Đổi app" className={group}>
              {apps.map((a) => (
                <Item key={a.id} value={`app ${a.name} ${a.storeAppId}`} onSelect={() => updatePrefs({ currentAppId: a.id })} icon={<Smartphone className={icon} />}>
                  {a.name} <span className="text-xs opacity-70">{a.storeAppId}</span>
                </Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
