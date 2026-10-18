import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCheck, Pause, Play as PlayIcon, Rocket, TrendingUp } from 'lucide-react';
import { DEFAULT_VITALS_ALERTS, ROLLOUT_STEPS, STATUS_LABEL, applyReleaseAction, describeAction, trackLabel, type PlayRelease, type PlayTrack, type ReleaseAction, type VitalsAlertPrefs, type VitalsVersion } from '@shared/playOps';
import { api, parseError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { Banner, Button, Card, EmptyState, Input, Select, Skeleton, cx } from '@/components/ui';
import { fmtNumber } from '@/lib/format';
import { Dialog } from '@/components/dialog';
import { toast, toastError } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { ReleaseBadge, RolloutBar, fraction, ratePct, releaseName } from './parts';

interface Pending {
  track: PlayTrack;
  release: PlayRelease;
  action: ReleaseAction;
}

export function Releases({ accountId, pkg }: { accountId: string; pkg: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.playTracks(accountId, pkg), queryFn: () => api.play.tracks(accountId, pkg) });
  // Vitals theo phiên bản (cache trên máy) đặt cạnh từng bản để quyết định tăng/dừng rollout
  const vitalsQ = useQuery({ queryKey: qk.playVitals(pkg), queryFn: () => api.play.vitals(pkg), staleTime: Infinity });
  const prefsQ = useQuery({ queryKey: ['play', 'vitalsAlerts'], queryFn: () => api.play.vitalsAlerts(), staleTime: Infinity });
  const byVersion = new Map((vitalsQ.data?.versions ?? []).map((v) => [v.versionCode, v]));
  const prefs = prefsQ.data ?? DEFAULT_VITALS_ALERTS;
  const [pending, setPending] = useState<Pending | null>(null);

  // Kiểm tra trước trên dữ liệu đang có; main kiểm tra lại trên dữ liệu mới nhất trong edit
  const ask = (track: PlayTrack, release: PlayRelease, action: ReleaseAction) => {
    const r = applyReleaseAction(track.releases, release.key, action);
    if ('error' in r) return toastError({ message: r.error, action: 'fix' });
    setPending({ track, release, action });
  };

  const done = (t: PlayTrack) => {
    qc.setQueryData<PlayTrack[]>(qk.playTracks(accountId, pkg), (old) => old?.map((x) => (x.track === t.track ? t : x)));
    void qc.invalidateQueries({ queryKey: qk.playOverview });
    setPending(null);
  };

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) {
    return (
      <Card className="overflow-hidden">
        <Banner tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>{parseError(q.error).message}</Banner>
      </Card>
    );
  }
  const tracks = (q.data ?? []).filter((t) => t.releases.length);
  if (!tracks.length) return <EmptyState icon={Rocket} title="Chưa có bản phát hành nào">Tạo bản phát hành đầu tiên trên Play Console; sau đó quản lý rollout ở đây.</EmptyState>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Tạo bản phát hành mới (upload AAB, ghi chú phát hành) vẫn làm trên Play Console. Ở đây điều khiển rollout của bản đã có: tăng %, tạm dừng, tiếp tục, phát hành 100%.</p>
      {tracks.map((t) => (
        <Card key={t.track} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2">
            <h2 className="font-semibold">{trackLabel(t.track)}</h2>
            <span className="font-mono text-xs text-muted">{t.track}</span>
          </div>
          <ul className="divide-y divide-border">
            {t.releases.map((r) => <ReleaseRow key={r.key} release={r} vitals={r.versionCodes.map((c) => byVersion.get(c)).filter((x) => !!x)} prefs={prefs} onAction={(a) => ask(t, r, a)} />)}
          </ul>
        </Card>
      ))}
      {pending && <ConfirmDialog accountId={accountId} pkg={pkg} pending={pending} onClose={() => setPending(null)} onDone={done} />}
    </div>
  );
}

function ReleaseRow({ release: r, vitals, prefs, onAction }: { release: PlayRelease; vitals: VitalsVersion[]; prefs: VitalsAlertPrefs; onAction: (a: ReleaseAction) => void }) {
  const online = useUi((s) => s.online);
  const [step, setStep] = useState('');
  const cur = r.userFraction ?? 0;
  const steps = ROLLOUT_STEPS.filter((s) => s > cur + 1e-9);
  const canRollout = r.versionCodes.length > 0 && r.status !== 'completed';
  const rollout = () => {
    const f = Number(step) / 100;
    if (f > 0) onAction({ kind: 'rollout', fraction: f });
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-56 flex-1">
        <p className="font-medium">{releaseName(r)}</p>
        <p className="text-xs text-muted">
          {r.versionCodes.length ? `Version code ${r.versionCodes.join(', ')}` : 'Chưa có bản build'}
          {r.notesLanguages.length > 0 && ` · ghi chú ${r.notesLanguages.length} ngôn ngữ`}
        </p>
        {vitals.map((v) => {
          const bad = (x: number | null, limit: number) => x != null && x >= limit && v.users >= prefs.minUsers;
          return (
            <p key={v.versionCode} className="text-xs" title="Vitals 7 ngày gần nhất của version code này">
              <span className="text-muted">Vitals #{v.versionCode}: </span>
              <span className={cx('num', bad(v.userCrashRate, prefs.crash) && 'font-semibold text-danger')}>crash {ratePct(v.userCrashRate)}</span>
              <span className="text-muted"> · </span>
              <span className={cx('num', bad(v.userAnrRate, prefs.anr) && 'font-semibold text-danger')}>ANR {ratePct(v.userAnrRate)}</span>
              <span className="text-muted"> · {fmtNumber(v.users)} người dùng/ngày</span>
            </p>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <ReleaseBadge r={r} />
        {r.userFraction != null && r.status !== 'completed' && <RolloutBar value={r.userFraction} halted={r.status === 'halted'} />}
      </div>
      {canRollout && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Select className="w-28" aria-label="Tỉ lệ rollout mới" value={step} onChange={(e) => setStep(e.target.value)}>
            <option value="">Chọn %…</option>
            {steps.map((s) => <option key={s} value={s * 100}>{+(s * 100).toFixed(2)}%</option>)}
          </Select>
          <Input className="w-20" type="number" min={0.01} max={99.99} step={0.01} placeholder="%" aria-label="Nhập % tùy ý" value={step} onChange={(e) => setStep(e.target.value)} />
          <Button size="sm" icon={TrendingUp} disabled={!online || !step} onClick={rollout}>{r.status === 'draft' ? 'Bắt đầu rollout' : 'Tăng rollout'}</Button>
          {r.status === 'inProgress' && <Button size="sm" icon={Pause} disabled={!online} onClick={() => onAction({ kind: 'halt' })}>Tạm dừng</Button>}
          {r.status === 'halted' && <Button size="sm" icon={PlayIcon} disabled={!online} onClick={() => onAction({ kind: 'resume' })}>Tiếp tục</Button>}
          <Button size="sm" variant="primary" icon={CheckCheck} disabled={!online} onClick={() => onAction({ kind: 'complete' })}>Phát hành 100%</Button>
        </div>
      )}
    </li>
  );
}

function ConfirmDialog({ accountId, pkg, pending, onClose, onDone }: { accountId: string; pkg: string; pending: Pending; onClose: () => void; onDone: (t: PlayTrack) => void }) {
  const { track, release, action } = pending;
  const [busy, setBusy] = useState(false);
  const onError = useErrorHandler();
  const after = (() => {
    const r = applyReleaseAction(track.releases, release.key, action);
    return 'error' in r ? null : r.releases.find((x) => x.key === release.key) ?? null;
  })();
  const stateText = (r: { status: PlayRelease['status']; userFraction?: number | null } | null) =>
    r ? `${STATUS_LABEL[r.status]}${r.userFraction != null && r.status !== 'completed' ? ` ${fraction(r.userFraction)}` : ''}` : '—';
  const replaces = action.kind === 'complete' ? track.releases.find((r) => r.status === 'completed' && r.key !== release.key) : undefined;

  const confirm = async () => {
    setBusy(true);
    try {
      const t = await api.play.updateRelease({ accountId, packageName: pkg, track: track.track, key: release.key, action });
      toast({ tone: 'success', title: `${describeAction(action)} · ${releaseName(release)}`, detail: `${trackLabel(track.track)} · ${pkg}` });
      onDone(t);
    } catch (err) {
      onError(err, () => void confirm());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={describeAction(action)} onClose={onClose} width="w-[520px]"
      footer={<><Button variant="ghost" onClick={onClose}>Hủy</Button><Button variant={action.kind === 'halt' ? 'danger' : 'primary'} loading={busy} onClick={confirm}>Xác nhận</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p><span className="text-muted">App: </span><span className="font-mono">{pkg}</span></p>
        <p><span className="text-muted">Kênh: </span>{trackLabel(track.track)} · <span className="text-muted">Bản: </span>{releaseName(release)}</p>
        <p className="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 p-3">
          <span className="text-muted line-through decoration-muted/40">{stateText(release)}</span>
          <ArrowRight className="size-4 text-muted" aria-hidden />
          <b>{stateText(after)}</b>
        </p>
        {replaces && <p className="text-warning">Bản đang phát hành {releaseName(replaces)} sẽ được thay hoàn toàn.</p>}
        {track.track === 'production' && action.kind !== 'halt' && <p className="text-xs text-muted">Kênh chính thức: người dùng thật nhận bản này ngay khi Google xử lý xong (thường vài phút đến vài giờ).</p>}
        {action.kind === 'halt' && <p className="text-xs text-muted">Người dùng mới sẽ không nhận bản này nữa; ai đã cập nhật thì giữ nguyên.</p>}
      </div>
    </Dialog>
  );
}
