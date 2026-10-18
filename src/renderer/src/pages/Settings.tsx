import { useState } from 'react';
import { LogIn } from 'lucide-react';
import type { AccountKind, AppMapping, Density, Theme } from '@shared/types';
import { useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { AccountList, AppList, AppMappingForm, KIND_LABEL, SecretsForm, useSignIn } from '@/components/connect';
import { Button, Card, Field, PageHeader, Select, Skeleton, cx } from '@/components/ui';
import { MessageCircle, RotateCcw, Save, Search, Send, Trash2 } from 'lucide-react';
import { DEFAULT_NAME_TEMPLATE, NAME_VARS, NameTemplateSchema, renderName } from '@shared/plan';
import { useApps } from '@/lib/queries';
import { Input } from '@/components/ui';
import { toast } from '@/components/toast';
import { Guide } from '@/components/guides';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertPrefsSchema, DEFAULT_ALERT_PREFS, type AlertPrefs } from '@shared/analytics';
import { AiKeySchema } from '@shared/schemas';
import { qk, useSecrets } from '@/lib/queries';
import { api } from '@/lib/api';
import { useErrorHandler } from '@/components/connect';

const TABS = ['Tài khoản', 'App', 'Cảnh báo', 'Tự động', 'Thông báo', 'AI', 'Đặt tên', 'Giao diện'] as const;
type Tab = (typeof TABS)[number];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

function AccountsTab() {
  const { signIn, pending } = useSignIn();
  const info = useUi((s) => s.info);
  return (
    <div className="space-y-4">
      <Section title="Tài khoản Google">
        <div className="mb-3 flex flex-wrap gap-2">
          {(['ads', 'admob', 'youtube', 'play', 'firebase'] as AccountKind[]).map((k) => (
            <Button key={k} icon={LogIn} loading={pending === k} onClick={() => signIn(k)}>Thêm {KIND_LABEL[k]}</Button>
          ))}
        </div>
        <AccountList />
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <Guide id="adsSignIn" />
          <Guide id="admobSignIn" />
          <Guide id="youtube" />
          <Guide id="playSignIn" />
          <Guide id="firebaseSignIn" />
        </div>
      </Section>
      <Section title="Google Cloud">
        <SecretsForm />
        {info?.safeStorage.backend === 'basic_text' && (
          <p className="mt-3 text-sm text-warning">Máy chưa có keyring (gnome-keyring/kwallet): secret chỉ được che, chưa được mã hóa thật.</p>
        )}
      </Section>
    </div>
  );
}

function AppsTab() {
  const [editing, setEditing] = useState<AppMapping | undefined>();
  return (
    <div className="space-y-4">
      <Section title={editing ? `Sửa ${editing.name}` : 'Thêm app'}>
        <div className="mb-3"><Guide id="appIds" /></div>
        <AppMappingForm key={editing?.id ?? 'new'} initial={editing} onSaved={() => setEditing(undefined)} />
      </Section>
      <Section title="App đã map">
        <AppList onEdit={setEditing} />
      </Section>
    </div>
  );
}

// Template tên camp: xem trước ngay khi gõ, lưu khi hợp lệ
function NamingTab() {
  const prefs = useUi((s) => s.prefs)!;
  const { data: apps = [] } = useApps();
  const [value, setValue] = useState(prefs.nameTemplate);
  const parsed = NameTemplateSchema.safeParse(value);
  const app = apps.find((a) => a.id === prefs.currentAppId) ?? apps[0];
  const sample = (geo: string, seq: number) =>
    renderName(value, { app: app?.name ?? 'StreamWave', store: app?.store ?? 'GOOGLE_PLAY', geo, goal: 'INSTALLS_TCPI', date: new Date(), seq });
  return (
    <Section title="Quy ước đặt tên camp">
      <div className="flex max-w-2xl flex-col gap-4">
        <Field label="Template" htmlFor="nt" error={parsed.success ? undefined : parsed.error.issues[0].message}
          hint={<>Biến: {NAME_VARS.map((v) => <code key={v} className="mr-1 rounded bg-surface-2 px-1 font-mono">{`{${v}}`}</code>)}</>}>
          <Input id="nt" className="font-mono" value={value} invalid={!parsed.success} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="rounded-sm bg-surface-2 p-3">
          <p className="mb-1 text-xs font-medium text-muted">Xem trước{app ? ` · ${app.name}` : ''}</p>
          {parsed.success ? (
            <ul className="space-y-0.5 font-mono text-sm" data-selectable>
              <li>{sample('US', 1)}</li>
              <li>{sample('VN', 1)}</li>
              <li>{sample('US', 2)}</li>
            </ul>
          ) : (
            <p className="text-sm text-muted">Sửa template để xem trước</p>
          )}
        </div>
        <p className="text-xs text-muted">Tên chuẩn giúp Analytics ghép chi phí với doanh thu đúng app và quốc gia. Camp đã tạo không bị đổi tên.</p>
        <div className="flex gap-2">
          <Button variant="primary" icon={Save} disabled={!parsed.success || value === prefs.nameTemplate}
            onClick={() => void updatePrefs({ nameTemplate: value.trim() }).then(() => toast({ tone: 'success', title: 'Đã lưu template tên camp' }))}>
            Lưu
          </Button>
          <Button variant="ghost" icon={RotateCcw} disabled={value === DEFAULT_NAME_TEMPLATE} onClick={() => setValue(DEFAULT_NAME_TEMPLATE)}>
            Mặc định
          </Button>
        </div>
      </div>
    </Section>
  );
}

// Ngưỡng cảnh báo Analytics. Tỉ lệ lưu dạng phân số, hiện dạng %.
type AlertKey = keyof AlertPrefs;
const ALERT_RULES: { title: string; level: 'Đỏ' | 'Vàng'; fields: { key: AlertKey; label: string; pct?: boolean; step?: number }[] }[] = [
  { title: 'CTR quảng cáo bất thường (nghi invalid traffic)', level: 'Đỏ', fields: [{ key: 'ctrMax', label: 'CTR lớn hơn (%)', pct: true }, { key: 'ctrMinImpressions', label: 'Khi impressions 7 ngày ≥' }] },
  { title: 'Show rate thấp (impressions ÷ matched requests)', level: 'Vàng', fields: [{ key: 'showRateMin', label: 'Show rate nhỏ hơn (%)', pct: true }, { key: 'showRateMinMatched', label: 'Khi matched 7 ngày ≥' }] },
  { title: 'eCPM giảm mạnh', level: 'Vàng', fields: [{ key: 'ecpmDropRatio', label: 'eCPM hôm qua < (% trung vị 7 ngày)', pct: true }, { key: 'ecpmMinImpressions', label: 'Khi impressions hôm qua ≥' }] },
  { title: 'Chi phí tăng đột biến', level: 'Vàng', fields: [{ key: 'spendSpikeX', label: 'Hôm nay > (lần trung vị 7 ngày)', step: 0.1 }, { key: 'spendSpikeMin', label: 'Khi chi phí hôm nay ≥' }] },
  { title: 'ROAS dưới ngưỡng', level: 'Đỏ', fields: [{ key: 'defaultRoasTarget', label: 'Ngưỡng ROAS mặc định (%) — app có ngưỡng riêng ở tab App', pct: true }, { key: 'roasMinSpend', label: 'Khi chi phí 7 ngày ≥' }] },
  { title: 'CPI vượt mục tiêu', level: 'Vàng', fields: [{ key: 'cpiOverRatio', label: 'CPI 3 ngày > tCPI ×', step: 0.05 }, { key: 'cpiMinInstalls', label: 'Khi cài đặt 3 ngày ≥' }] },
];

function AlertsTab() {
  const q = useQuery({ queryKey: ['alertPrefs'], queryFn: () => api.analytics.alertPrefs() });
  return q.data ? <AlertsForm key={JSON.stringify(q.data)} initial={q.data} /> : <Skeleton className="h-60 rounded-lg" />;
}

function AlertsForm({ initial }: { initial: AlertPrefs }) {
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const toText = (k: AlertKey, pct?: boolean) => {
    const v = initial[k];
    return v == null ? '' : String(pct ? Math.round(v * 1000) / 10 : v);
  };
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALERT_RULES.flatMap((r) => r.fields.map((f) => [f.key, toText(f.key, f.pct)]))),
  );
  const value: Record<string, number | null> = {};
  for (const r of ALERT_RULES) {
    for (const f of r.fields) {
      const t = text[f.key].trim().replace(',', '.');
      value[f.key] = t === '' ? null : f.pct ? Number(t) / 100 : Number(t);
    }
  }
  const parsed = AlertPrefsSchema.safeParse(value);
  const errors = new Map(parsed.success ? [] : parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const save = async () => {
    if (!parsed.success) return;
    try {
      await api.analytics.setAlertPrefs(parsed.data);
      void qc.invalidateQueries({ queryKey: ['alertPrefs'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      toast({ tone: 'success', title: 'Đã lưu ngưỡng cảnh báo' });
    } catch (err) {
      onError(err);
    }
  };
  return (
    <Section title="Ngưỡng cảnh báo">
      <p className="mb-4 max-w-3xl text-sm text-muted">Cảnh báo tính trên dữ liệu đã đồng bộ về máy, hiện ngay trên dòng quốc gia ở Analytics. Điều kiện số lượng tối thiểu giúp nước ít traffic không báo động giả.</p>
      <div className="grid max-w-4xl gap-3 md:grid-cols-2">
        {ALERT_RULES.map((r) => (
          <div key={r.title} className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span className={cx('rounded-sm px-1.5 text-xs', r.level === 'Đỏ' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{r.level}</span>
              {r.title}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {r.fields.map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`al-${f.key}`} error={errors.get(f.key)}>
                  <Input id={`al-${f.key}`} className="num" inputMode="decimal" value={text[f.key]} invalid={errors.has(f.key)}
                    placeholder={f.key === 'defaultRoasTarget' ? 'Không đặt' : undefined}
                    onChange={(e) => setText({ ...text, [f.key]: e.target.value })} />
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" icon={Save} disabled={!parsed.success} onClick={() => void save()}>Lưu</Button>
        <Button variant="ghost" icon={RotateCcw} onClick={() => setText(Object.fromEntries(ALERT_RULES.flatMap((r) => r.fields.map((f) => {
          const v = DEFAULT_ALERT_PREFS[f.key];
          return [f.key, v == null ? '' : String(f.pct ? Math.round(v * 1000) / 10 : v)];
        }))))}>Mặc định</Button>
      </div>
    </Section>
  );
}

function AiTab() {
  const qc = useQueryClient();
  const { data: status } = useSecrets();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string>();
  const onError = useErrorHandler();
  const save = async (value: string | null) => {
    if (value !== null) {
      const r = AiKeySchema.safeParse(value);
      if (!r.success) return setError(r.error.issues[0].message);
    }
    setError(undefined);
    try {
      qc.setQueryData(qk.secrets, await api.secrets.setAiKey(value));
      setKey('');
      toast({ tone: 'success', title: value ? 'Đã lưu API key Claude' : 'Đã xóa API key Claude' });
    } catch (err) {
      onError(err);
    }
  };
  return (
    <Section title="AI dịch text quảng cáo">
      <div className="flex max-w-2xl flex-col gap-4">
        <p className="text-sm text-muted">Dùng Claude để dịch tiêu đề/mô tả sang ngôn ngữ từng quốc gia trong bước Cấu hình của wizard. Câu vượt 30/90 ký tự được AI rút gọn, bạn duyệt từng câu trước khi dùng; bản đã duyệt lưu vào thư viện text của app.</p>
        <div className="flex items-center gap-2 text-sm">
          API key: {status?.aiKey ? <span className="font-medium text-success">Đã lưu</span> : <span className="font-medium text-warning">Chưa có</span>}
        </div>
        <Field label="API key Claude" htmlFor="aik" error={error}>
          <Input id="aik" type="password" value={key} invalid={!!error} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" icon={Save} disabled={!key.trim()} onClick={() => void save(key)}>Lưu key</Button>
          {status?.aiKey && <Button variant="ghost" onClick={() => void save(null)}>Xóa key</Button>}
        </div>
        <Guide id="aiKey" defaultOpen={status?.aiKey === false} />
      </div>
    </Section>
  );
}

function NotifyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notify'], queryFn: () => api.notify.status() });
  const online = useUi((x) => x.online);
  const onError = useErrorHandler();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const s = q.data;
  const run = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(what);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'hasToken' in r) qc.setQueryData(['notify'], r);
      if (ok) toast({ tone: 'success', title: ok });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };
  const setEvents = (patch: Partial<NonNullable<typeof s>['events']>) =>
    s && void run('cfg', () => api.notify.setConfig({ enabled: s.enabled, events: { ...s.events, ...patch } }));
  const EVENTS: [keyof NonNullable<typeof s>['events'], string, string][] = [
    ['red', 'Cảnh báo đỏ ngay khi có', 'ROAS dưới ngưỡng, CTR bất thường… (mỗi bộ cảnh báo mới báo một lần)'],
    ['digest', 'Bản tin mỗi sáng', 'Sau lần đồng bộ đầu tiên trong ngày: chi, thu, ROAS hôm qua và 7 ngày, ngân sách tháng, đề xuất rule chờ duyệt'],
    ['weekly', 'AI tóm tắt tuần (thứ Hai)', 'Claude viết tổng quan, vấn đề và việc nên làm của 7 ngày qua — cần API key Claude'],
  ];
  return (
    <Section title="Thông báo qua Telegram">
      {!s ? <Skeleton className="h-40" /> : (
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="text-sm text-muted">Nhận cảnh báo và bản tin số liệu trên điện thoại qua bot Telegram của riêng bạn — không cần mở app.</p>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm">
            <MessageCircle className="size-4 text-info" aria-hidden />
            <span>Bot: {s.hasToken ? <b className="text-success">@{s.botName ?? 'đã lưu'}</b> : <b className="text-warning">chưa có</b>}</span>
            <span>Chat: {s.chatId ? <b className="text-success">{s.chatName}</b> : <b className="text-warning">chưa kết nối</b>}</span>
            <span className="flex-1" />
            {s.hasToken && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void run('del', () => api.notify.setToken(null), 'Đã xóa bot Telegram')}>Xóa</Button>}
          </div>
          {!s.hasToken || !s.chatId ? (
            <>
              {!s.hasToken && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label="Token bot (từ @BotFather)" htmlFor="tgt">
                      <Input id="tgt" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAH…" />
                    </Field>
                  </div>
                  <Button variant="primary" icon={Save} disabled={!token.trim() || !online} loading={busy === 'token'}
                    onClick={() => void run('token', async () => { const r = await api.notify.setToken(token); setToken(''); return r; }, 'Đã lưu token bot')}>Lưu token</Button>
                </div>
              )}
              {s.hasToken && !s.chatId && (
                <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 text-sm">
                  <span className="flex-1">Mở chat với <b>@{s.botName}</b> trên Telegram, bấm <b>Start</b>, rồi bấm Tìm chat.</span>
                  <Button size="sm" variant="secondary" onClick={() => void api.app.openExternal(`https://t.me/${s.botName}`)}>Mở bot</Button>
                  <Button size="sm" variant="primary" icon={Search} loading={busy === 'chat'} disabled={!online} onClick={() => void run('chat', () => api.notify.detectChat(), 'Đã kết nối chat Telegram')}>Tìm chat</Button>
                </div>
              )}
              <Guide id="telegram" defaultOpen />
            </>
          ) : (
            <>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={s.enabled} onChange={(e) => void run('cfg', () => api.notify.setConfig({ enabled: e.target.checked, events: s.events }))} />
                <span><b>Bật thông báo Telegram</b></span>
              </label>
              <div className={cx('flex flex-col gap-3 rounded-md border border-border p-3', !s.enabled && 'opacity-50')}>
                {EVENTS.map(([k, label, hint]) => (
                  <label key={k} className="flex items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-1" disabled={!s.enabled} checked={s.events[k]} onChange={(e) => setEvents({ [k]: e.target.checked })} />
                    <span><b>{label}</b><span className="block text-muted">{hint}</span></span>
                  </label>
                ))}
              </div>
              <Button className="self-start" icon={Send} loading={busy === 'test'} disabled={!online} onClick={() => void run('test', () => api.notify.test(), 'Đã gửi tin thử — xem Telegram')}>Gửi thử</Button>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function AutomationTab() {
  const prefs = useUi((s) => s.prefs)!;
  return (
    <Section title="Chạy tự động">
      <div className="flex max-w-2xl flex-col gap-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={prefs.autoSync} onChange={(e) => void updatePrefs({ autoSync: e.target.checked })} />
          <span>
            <b>Đồng bộ báo cáo + chạy rule mỗi ngày</b>
            <span className="block text-muted">Kéo lại chi phí Google Ads và doanh thu AdMob 3 ngày gần nhất (hai nguồn đều có độ trễ), rồi chạy các rule đang bật. Máy ngủ qua giờ hẹn thì chạy bù khi thức dậy.</span>
          </span>
        </label>
        <Field label="Giờ chạy (giờ trên máy)" htmlFor="sh">
          <Select id="sh" className="w-32" value={prefs.syncHour} disabled={!prefs.autoSync} onChange={(e) => void updatePrefs({ syncHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </Select>
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={prefs.closeToTray} onChange={(e) => void updatePrefs({ closeToTray: e.target.checked })} />
          <span>
            <b>Đóng cửa sổ thì chạy nền ở thanh menu / khay hệ thống</b>
            <span className="block text-muted">Lịch đồng bộ chỉ chạy khi app đang mở. Thoát hẳn bằng menu của icon ở thanh menu → Thoát, hoặc ⌘Q / Alt+F4.</span>
          </span>
        </label>
        <p className="text-xs text-muted">“Khởi động cùng máy” bật/tắt trong menu của icon ở thanh menu (chỉ có ở bản đã cài đặt).</p>
      </div>
    </Section>
  );
}

function AppearanceTab() {
  const prefs = useUi((s) => s.prefs)!;
  return (
    <Section title="Giao diện">
      <div className="grid max-w-xl grid-cols-2 gap-4">
        <Field label="Chế độ màu" htmlFor="th">
          <Select id="th" value={prefs.theme} onChange={(e) => updatePrefs({ theme: e.target.value as Theme })}>
            <option value="light">Sáng</option>
            <option value="dark">Tối</option>
            <option value="system">Theo hệ điều hành</option>
          </Select>
        </Field>
        <Field label="Mật độ bảng" htmlFor="de" hint="Dòng 32 px (gọn) hoặc 40 px (thoáng)">
          <Select id="de" value={prefs.density} onChange={(e) => updatePrefs({ density: e.target.value as Density })}>
            <option value="compact">Gọn</option>
            <option value="comfortable">Thoáng</option>
          </Select>
        </Field>
        <Field label={`Phóng to · ${Math.round(prefs.zoom * 100)}%`} htmlFor="zo">
          <input id="zo" type="range" min={0.9} max={1.25} step={0.05} value={prefs.zoom} className="accent-[rgb(var(--accent))]"
            onChange={(e) => updatePrefs({ zoom: Number(e.target.value) })} />
        </Field>
        <Field label="Định dạng số và ngày" htmlFor="lo" hint={prefs.locale === 'vi-VN' ? 'Ví dụ: 1.240,50 ₫' : 'Example: $1,240.50'}>
          <Select id="lo" value={prefs.locale} onChange={(e) => updatePrefs({ locale: e.target.value as 'vi-VN' | 'en-US' })}>
            <option value="vi-VN">Tiếng Việt (vi-VN)</option>
            <option value="en-US">English (en-US)</option>
          </Select>
        </Field>
      </div>
    </Section>
  );
}

export function Settings() {
  const [tab, setTab] = useState<Tab>('Tài khoản');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Cài đặt" />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Tài khoản' && <AccountsTab />}
      {tab === 'App' && <AppsTab />}
      {tab === 'Giao diện' && <AppearanceTab />}
      {tab === 'Cảnh báo' && <AlertsTab />}
      {tab === 'Tự động' && <AutomationTab />}
      {tab === 'Thông báo' && <NotifyTab />}
      {tab === 'AI' && <AiTab />}
      {tab === 'Đặt tên' && <NamingTab />}
    </div>
  );
}
