import { Search } from 'lucide-react';
import { Kbd, cx } from '../ui';
import { setState, useUi } from '@/lib/store';
import appIcon from '@/assets/app-icon.png';
import { APP_NAME } from '@shared/brand';

export function TitleBar() {
  const platform = useUi((s) => s.info?.platform);
  const isMac = platform === 'darwin';
  return (
    <header className={cx('drag relative flex h-10 shrink-0 items-center bg-surface-2', isMac ? 'pl-20' : 'pr-36 pl-3')}>
      <span className="brand-gradient absolute inset-x-0 bottom-0 h-0.5" aria-hidden />
      <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <img src={appIcon} alt="" className="size-5" draggable={false} />
        {APP_NAME}
      </span>
      <div className="flex flex-1 justify-center">
        <button
          onClick={() => setState({ paletteOpen: true })}
          className="no-drag flex h-7 w-80 items-center gap-2 rounded-sm border border-border bg-surface px-2 text-sm text-muted hover:text-text"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Tìm lệnh, màn, camp…</span>
          <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
        </button>
      </div>
      <span className={isMac ? 'w-4' : 'w-0'} />
    </header>
  );
}
