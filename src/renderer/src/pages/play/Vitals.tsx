import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bug, RefreshCw, Timer, Users } from 'lucide-react';
import { DEFAULT_VITALS_ALERTS, VITALS_BAD, summarizeVitals, type VitalsAlertPrefs, type VitalsData, type VitalsLevel } from '@shared/playOps';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { Button, Card, EmptyState, Field, Input, Skeleton, cx } from '@/components/ui';
import { toast } from '@/components/toast';
import { SummaryCard } from '@/components/kit';
import { useErrorHandler } from '@/components/connect';
import { TrendChart } from '@/pages/analytics/Chart';
import { VITALS_LABEL, ratePct } from './parts';

const TONE: Record<VitalsLevel, 'success' | 'warning' | 'danger'> = { good: 'success', warn: 'warning', bad: 'danger' };

export function Vitals({ accountId, pkg }: { accountId: string; pkg: string }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const onError = useErrorHandler();
  const q = useQuery({ queryKey: qk.playVitals(pkg), queryFn: () => api.play.vitals(pkg), staleTime: Infinity });
  const [busy, setBusy] = useState(false);

  const sync = async () => {
    setBusy(true);
    try {
      qc.setQueryData(qk.playVitals(pkg), await api.play.syncVitals(accountId, pkg));
    } catch (err) {
      onError(err, () => void sync());
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Skeleton className="h-64" />;
  const data = q.data;
  if (!data?.days.length) {
    return (
      <EmptyState icon={Activity} title={data ? 'Play chưa có số liệu vitals cho app này' : 'Chưa đọc vitals'}
        action={<Button variant="primary" icon={RefreshCw} loading={busy} disabled={!online} onClick={sync}>Đọc từ Google Play</Button>}>
        Crash rate và ANR rate theo ngày (30 ngày) từ Play Developer Reporting API. App đang thử nghiệm kín/nội bộ thường chưa đủ người dùng để Play tính. Cần bật API này trong Google Cloud; tài khoản đăng nhập trước đây phải đăng nhập lại một lần để cấp quyền.
      </EmptyState>
    );
  }

  const s = summarizeVitals(data.days);
  const dates = data.days.map((d) => d.date);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <SummaryCard icon={Bug} tone={s.crash ? TONE[s.crash] : 'info'} label="Crash người dùng gặp · 28 ngày" value={ratePct(s.userCrash28)}
          sub={`${s.crash ? VITALS_LABEL[s.crash] : '—'} · ngưỡng ${ratePct(VITALS_BAD.userCrashRate)}`} />
        <SummaryCard icon={Timer} tone={s.anr ? TONE[s.anr] : 'info'} label="ANR người dùng gặp · 28 ngày" value={ratePct(s.userAnr28)}
          sub={`${s.anr ? VITALS_LABEL[s.anr] : '—'} · ngưỡng ${ratePct(VITALS_BAD.userAnrRate)}`} />
        <SummaryCard icon={Users} tone="accent" label={`Người dùng ngày ${s.latest?.date ?? '—'}`} value={s.latest?.users == null ? '—' : fmtNumber(s.latest.users)}
          sub={`crash ${ratePct(s.latest?.userCrashRate)} · ANR ${ratePct(s.latest?.userAnrRate)}`} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Số liệu Play trễ 1–2 ngày · đọc lúc {fmtDateTime(data.at)} · tự đọc lại mỗi ngày sau lần đồng bộ báo cáo, vượt ngưỡng thì báo Telegram (cảnh báo đỏ)</span>
        <span className="flex-1" />
        <Button size="sm" icon={RefreshCw} loading={busy} disabled={!online} onClick={sync}>Đọc lại</Button>
      </div>
      <VersionTable data={data} />
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">Crash rate theo ngày</h3>
        <TrendChart ariaLabel="Crash rate theo ngày" dates={dates} kind="pct" currency="" pctDigits={2}
          refLine={{ value: VITALS_BAD.userCrashRate, label: `Ngưỡng xấu ${ratePct(VITALS_BAD.userCrashRate)}`, tone: 'danger' }}
          series={[
            { label: 'Người dùng gặp', values: data.days.map((d) => d.userCrashRate), kind: 'line', color: 'accent' },
            { label: 'Tất cả crash', values: data.days.map((d) => d.crashRate), kind: 'line', color: 'muted', dashed: true },
          ]} />
      </Card>
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">ANR rate theo ngày</h3>
        <TrendChart ariaLabel="ANR rate theo ngày" dates={dates} kind="pct" currency="" pctDigits={2}
          refLine={{ value: VITALS_BAD.userAnrRate, label: `Ngưỡng xấu ${ratePct(VITALS_BAD.userAnrRate)}`, tone: 'danger' }}
          series={[
            { label: 'Người dùng gặp', values: data.days.map((d) => d.userAnrRate), kind: 'line', color: 'accent-2' },
            { label: 'Tất cả ANR', values: data.days.map((d) => d.anrRate), kind: 'line', color: 'muted', dashed: true },
          ]} />
      </Card>
      <AlertSettings />
    </div>
  );
}

// Crash/ANR riêng từng version code (7 ngày gần nhất) — để quyết định tăng hay dừng rollout bản mới
function VersionTable({ data }: { data: VitalsData }) {
  const prefsQ = useQuery({ queryKey: ['play', 'vitalsAlerts'], queryFn: () => api.play.vitalsAlerts(), staleTime: Infinity });
  const prefs = prefsQ.data ?? DEFAULT_VITALS_ALERTS;
  const versions = data.versions ?? [];
  const tone = (v: number | null, limit: number) => (v == null ? 'text-muted' : v >= limit ? 'font-semibold text-danger' : v >= limit * 0.8 ? 'text-warning' : '');
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-surface-2 px-4 py-2">
        <h3 className="text-sm font-semibold">Theo phiên bản · 7 ngày gần nhất</h3>
      </div>
      {!versions.length ? (
        <p className="px-4 py-3 text-sm text-muted">Chưa có số liệu theo phiên bản (bấm Đọc lại; app ít người dùng như đang thử nghiệm kín có thể chưa có).</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Version code</th>
              <th className="px-4 py-2 text-right font-medium">Crash người dùng gặp</th>
              <th className="px-4 py-2 text-right font-medium">ANR người dùng gặp</th>
              <th className="px-4 py-2 text-right font-medium">Người dùng/ngày (cao nhất)</th>
              <th className="px-4 py-2 font-medium">Ngày cuối có số liệu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {versions.map((v) => (
              <tr key={v.versionCode}>
                <td className="px-4 py-2 font-mono">{v.versionCode}</td>
                <td className={cx('num px-4 py-2 text-right', tone(v.userCrashRate, prefs.crash))}>{ratePct(v.userCrashRate)}</td>
                <td className={cx('num px-4 py-2 text-right', tone(v.userAnrRate, prefs.anr))}>{ratePct(v.userAnrRate)}</td>
                <td className={cx('num px-4 py-2 text-right', v.users < prefs.minUsers && 'text-muted')} title={v.users < prefs.minUsers ? 'Ít người dùng — không tính cảnh báo' : undefined}>{fmtNumber(v.users)}</td>
                <td className="px-4 py-2 text-xs text-muted">{v.lastDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// Ngưỡng cảnh báo dùng chung mọi app; tự tạm dừng rollout là tùy chọn
function AlertSettings() {
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const q = useQuery({ queryKey: ['play', 'vitalsAlerts'], queryFn: () => api.play.vitalsAlerts(), staleTime: Infinity });
  const [draft, setDraft] = useState<VitalsAlertPrefs | null>(null);
  const v = draft ?? q.data ?? DEFAULT_VITALS_ALERTS;
  const set = (patch: Partial<VitalsAlertPrefs>) => setDraft({ ...v, ...patch });
  const save = async () => {
    try {
      qc.setQueryData(['play', 'vitalsAlerts'], await api.play.setVitalsAlerts(v));
      setDraft(null);
      toast({ tone: 'success', title: 'Đã lưu ngưỡng cảnh báo Vitals' });
    } catch (err) {
      onError(err);
    }
  };
  const pctInput = (k: 'crash' | 'anr', label: string) => (
    <Field label={label} htmlFor={`va-${k}`}>
      <Input id={`va-${k}`} className="w-28" type="number" min={0.01} max={50} step={0.01} value={+(v[k] * 100).toFixed(3)}
        onChange={(e) => set({ [k]: Math.max(0.0001, Number(e.target.value) / 100) })} />
    </Field>
  );
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold">Cảnh báo Vitals (mọi app)</h3>
      <div className="flex flex-wrap items-end gap-4">
        {pctInput('crash', 'Ngưỡng crash (%)')}
        {pctInput('anr', 'Ngưỡng ANR (%)')}
        <Field label="Bỏ qua khi ít hơn (người dùng/ngày)" htmlFor="va-min">
          <Input id="va-min" className="w-28" type="number" min={0} step={50} value={v.minUsers} onChange={(e) => set({ minUsers: Math.max(0, Math.round(Number(e.target.value))) })} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={v.daily} onChange={(e) => set({ daily: e.target.checked })} />
        <span>Báo theo <b>ngày mới nhất</b> và theo <b>từng phiên bản</b> (không chờ trung bình 28 ngày)</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={v.autoHalt} onChange={(e) => set({ autoHalt: e.target.checked })} />
        <span>
          <b>Tự tạm dừng rollout</b> khi bản đang rollout vượt ngưỡng
          <span className="block text-xs text-muted">Kiểm tra mỗi ngày sau lần đồng bộ (số liệu Play trễ 1–2 ngày). Có ghi nhật ký và báo Telegram; tiếp tục rollout bằng tay ở tab Release.</span>
        </span>
      </label>
      <p className="text-xs text-muted">Luôn báo khi trung bình 28 ngày vượt ngưỡng xấu của Google ({ratePct(VITALS_BAD.userCrashRate)} crash, {ratePct(VITALS_BAD.userAnrRate)} ANR). Cảnh báo gửi qua Telegram nếu bật “cảnh báo đỏ” ở Cài đặt → Thông báo.</p>
      <div><Button variant="primary" disabled={!draft} onClick={save}>Lưu</Button></div>
    </Card>
  );
}
