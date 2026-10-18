import { useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, CircleAlert, LogIn, RotateCcw, SkipForward } from 'lucide-react';
import type { AccountKind } from '@shared/types';
import { navigate, useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { useAdsCustomers, useApps, useChannels, usePublishers, useSecrets } from '@/lib/queries';
import { AccountList, AppList, AppMappingForm, SecretsForm, useSignIn } from '@/components/connect';
import { Button, Card, cx } from '@/components/ui';
import { Guide } from '@/components/guides';

type StepState = 'done' | 'todo' | 'error' | 'skipped';

function Step({ n, title, state, summary, children, open, onToggle }: {
  n: number; title: string; state: StepState; summary: ReactNode; children: ReactNode; open: boolean; onToggle: () => void;
}) {
  const icon = {
    done: <CheckCircle2 className="size-5 text-success" aria-label="Xong" />,
    error: <CircleAlert className="size-5 text-danger" aria-label="Có lỗi" />,
    skipped: <SkipForward className="size-5 text-muted" aria-label="Đã bỏ qua" />,
    todo: <Circle className="size-5 text-muted" aria-label="Chưa làm" />,
  }[state];
  return (
    <Card className={cx('overflow-hidden', open && 'ring-2 ring-accent/40')}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        {icon}
        <span className="num w-5 text-sm text-muted">{n}</span>
        <span className="flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-sm text-muted">{summary}</span>
        </span>
      </button>
      {open && <div className="space-y-3 border-t border-border px-4 py-4">{children}</div>}
    </Card>
  );
}

export function Onboarding() {
  const accounts = useUi((s) => s.accounts);
  const { data: secrets } = useSecrets();
  const { data: customers = [] } = useAdsCustomers();
  const { data: pubs = [] } = usePublishers();
  const { data: channels = [] } = useChannels();
  const { data: apps = [] } = useApps();
  const { signIn, pending } = useSignIn();
  const [ytSkipped, setYtSkipped] = useState(false);

  const has = (k: AccountKind) => accounts.filter((a) => a.kind === k);
  const stateOf = (k: AccountKind): StepState =>
    has(k).some((a) => a.status === 'reauth') ? 'error' : has(k).length ? 'done' : 'todo';

  const configured = !!secrets && secrets.oauthClient !== 'missing'; // developer token không còn bắt buộc (Google khai tử 9/9/2026)
  const steps: StepState[] = [
    stateOf('ads') === 'done' && customers.length ? 'done' : stateOf('ads'),
    stateOf('admob'),
    ytSkipped && stateOf('youtube') === 'todo' ? 'skipped' : stateOf('youtube'),
    apps.length ? 'done' : 'todo',
  ];
  const firstOpen = configured ? Math.max(0, steps.findIndex((s) => s === 'todo' || s === 'error')) + 1 : 0;
  const [open, setOpen] = useState<number | null>(null);
  const current = open ?? firstOpen;
  const doneCount = steps.filter((s) => s === 'done' || s === 'skipped').length;

  const connect = (kind: AccountKind, label: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" icon={LogIn} loading={pending === kind} disabled={!configured} onClick={() => signIn(kind)}>
        {has(kind).length ? `Thêm tài khoản ${label}` : `Đăng nhập Google cho ${label}`}
      </Button>
      {has(kind).length > 0 && <Button variant="ghost" icon={RotateCcw} onClick={() => signIn(kind)}>Làm lại</Button>}
      {!configured && <span className="text-sm text-warning">Cần cấu hình OAuth client ở bước 0</span>}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Kết nối tài khoản</h1>
        <p className="text-sm text-muted">Khoảng 5 phút. Trình duyệt hệ thống sẽ mở để đăng nhập Google; token được mã hóa bằng keychain của máy.</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={doneCount} aria-valuemax={4}>
            <div className="brand-gradient h-full transition-[width]" style={{ width: `${(doneCount / 4) * 100}%` }} />
          </div>
          <span className="num text-sm font-medium">{doneCount}/4</span>
        </div>
      </div>

      <Step n={0} title="Cấu hình Google Cloud" state={configured ? 'done' : 'todo'} open={current === 0} onToggle={() => setOpen(current === 0 ? -1 : 0)}
        summary={configured ? 'OAuth client đã lưu' : 'OAuth client loại Desktop app (quyền Google Ads API theo Cloud project)'}>
        <SecretsForm />
      </Step>

      <Step n={1} title="Google Ads" state={steps[0]} open={current === 1} onToggle={() => setOpen(current === 1 ? -1 : 1)}
        summary={has('ads').length ? `${customers.filter((c) => !c.manager).length} tài khoản · ${customers.filter((c) => c.manager).length} MCC` : 'Đăng nhập tài khoản có quyền MCC'}>
        <Guide id="adsSignIn" />
        {connect('ads', 'Google Ads')}
        <AccountList kind="ads" />
      </Step>

      <Step n={2} title="AdMob" state={steps[1]} open={current === 2} onToggle={() => setOpen(current === 2 ? -1 : 2)}
        summary={pubs.length ? pubs.map((p) => p.publisherId).join(', ') : 'Đọc publisher ID tự động, không cần nhập pub-…'}>
        <Guide id="admobSignIn" />
        {connect('admob', 'AdMob')}
        <AccountList kind="admob" />
      </Step>

      <Step n={3} title="YouTube (không bắt buộc)" state={steps[2]} open={current === 3} onToggle={() => setOpen(current === 3 ? -1 : 3)}
        summary={channels.length ? `Kênh nhận video: ${channels.map((c) => c.title).join(', ')}` : ytSkipped ? 'Đã bỏ qua — có thể dán video ID thủ công' : 'Kênh sẽ nhận video upload'}>
        <Guide id="youtube" />
        {connect('youtube', 'YouTube')}
        <AccountList kind="youtube" />
        {!has('youtube').length && (
          <Button variant="ghost" icon={SkipForward} onClick={() => { setYtSkipped(true); setOpen(4); }}>Bỏ qua bước này</Button>
        )}
      </Step>

      <Step n={4} title="Map app" state={steps[3]} open={current === 4} onToggle={() => setOpen(current === 4 ? -1 : 4)}
        summary={apps.length ? `${apps.length} app đã map` : 'Package name ↔ AdMob app ID ↔ tài khoản Google Ads'}>
        <Guide id="appIds" />
        <AppMappingForm />
        <AppList onEdit={() => navigate('/settings')} />
      </Step>

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={steps[0] !== 'done' || steps[3] !== 'done'}
          onClick={() => { void updatePrefs({ onboardingDone: true }); navigate('/campaigns'); }}
        >
          Hoàn tất
        </Button>
      </div>
    </div>
  );
}
