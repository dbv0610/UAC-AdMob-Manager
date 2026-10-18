import { ListTodo, Video, Wifi, WifiOff, Zap } from 'lucide-react';
import { useUi } from '@/lib/store';
import { runCommand } from '@/lib/commands';
import { fmtNumber } from '@/lib/format';
import { cx } from '../ui';

export function StatusBar() {
  const online = useUi((s) => s.online);
  const version = useUi((s) => s.info?.version);
  const jobs = useUi((s) => s.jobs);
  const quota = useUi((s) => s.quota);
  const running = jobs.filter((j) => j.state === 'running' || j.state === 'queued').length;
  const route = useUi((s) => s.route);
  const ads = route !== '/play' && route !== '/remote-config'; // quota YouTube / Ads không liên quan màn Google Play / Remote Config

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-surface-2 px-3 text-xs text-muted">
      {ads && <>
      <span className="flex items-center gap-1" title="Lượt upload YouTube hôm nay (theo giờ PT)">
        <Video className="size-3.5" aria-hidden /> Upload YouTube <span className={cx('num', (quota?.youtubeUploads ?? 0) >= 90 && 'text-warning')}>{quota?.youtubeUploads ?? 0}/100</span>
      </span>
      <span className="flex items-center gap-1" title="Số operation Google Ads hôm nay">
        <Zap className="size-3.5" aria-hidden /> Ads ops hôm nay <span className="num">{fmtNumber(quota?.adsOperations ?? 0)}</span>
      </span>
      </>}
      <button className="flex items-center gap-1 hover:text-text" onClick={() => runCommand('toggleJobs')}>
        <ListTodo className="size-3.5" aria-hidden /> {running ? `${running} job đang chạy` : 'Không có job'}
      </button>
      <div className="flex-1" />
      <span className={cx('flex items-center gap-1', online ? 'text-success' : 'text-warning')}>
        {online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
        {online ? 'Online' : 'Offline'}
      </span>
      <span>v{version}</span>
    </footer>
  );
}
