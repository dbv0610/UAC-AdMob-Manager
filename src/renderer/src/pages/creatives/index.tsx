import { useRef, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { YT_DAILY_UPLOADS } from '@shared/creative';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { Button, PageHeader, cx } from '@/components/ui';
import { Library, useImport } from './Library';
import { Matrix } from './Matrix';
import { LowVideos } from './LowVideos';
import { VideoPerfTab } from './VideoPerf';
import { UploaderBanner } from './dialogs';

type Tab = 'library' | 'perf' | 'matrix' | 'low';

export function Creatives() {
  const [tab, setTab] = useState<Tab>('library');
  const quota = useUi((s) => s.quota);
  const uploader = useUi((s) => s.uploader);
  const imp = useImport();
  const [drag, setDrag] = useState(false);
  const depth = useRef(0);
  const left = Math.max(0, YT_DAILY_UPLOADS - (quota?.youtubeUploads ?? 0));

  // Kéo thả file/thư mục từ hệ điều hành: lấy đường dẫn thật qua preload rồi nhập tại chỗ
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDrag(false);
    const paths = [...e.dataTransfer.files].map((f) => api.files.pathFor(f)).filter(Boolean);
    if (paths.length) void imp.paths(paths);
  };

  return (
    <div
      className="relative mx-auto flex min-h-full max-w-[1400px] flex-col"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        depth.current++;
        setDrag(true);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDrag(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <PageHeader title="Creatives">
        <span className="text-sm text-muted" title="Lượt videos.insert còn lại hôm nay, reset 0h giờ Thái Bình Dương">
          Còn <b className={cx('num', left < 10 ? 'text-warning' : 'text-text')}>{left}</b>/{YT_DAILY_UPLOADS} lượt upload hôm nay
          {uploader?.running && ' · đang upload'}
          {!!uploader?.queued && <> · <span className="num">{uploader.queued}</span> chờ</>}
        </span>
        <Button size="sm" variant="ghost" icon={RefreshCw} title="Kiểm tra lại trạng thái xử lý trên YouTube (Ctrl/⌘ R)" onClick={() => void api.creatives.refreshStatus()}>
          Kiểm tra YouTube
        </Button>
      </PageHeader>
      <div className="mb-3 -mt-1"><UploaderBanner /></div>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {([['library', 'Thư viện'], ['perf', 'Hiệu quả video'], ['matrix', 'Ma trận quốc gia × tỉ lệ'], ['low', 'Thay video LOW']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'library' ? <Library /> : tab === 'perf' ? <VideoPerfTab onOpenLow={() => setTab('low')} /> : tab === 'matrix' ? <Matrix onOpen={() => setTab('library')} /> : <LowVideos />}

      {drag && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10">
          <div className="flex flex-col items-center gap-2 rounded-lg bg-surface px-6 py-4 shadow-lg">
            <Upload className="size-6 text-accent" aria-hidden />
            <p className="font-medium">Thả để nhập vào thư viện</p>
            <p className="text-xs text-muted">File và cả thư mục con · không sao chép file</p>
          </div>
        </div>
      )}
    </div>
  );
}
