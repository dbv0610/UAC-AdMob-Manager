import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogIn, LogOut, RefreshCw, Save, Trash2, Wand2 } from 'lucide-react';
import type { AccountKind, AppError, AppMapping } from '@shared/types';
import { AppMappingSchema, DeveloperTokenSchema, OAuthClientSchema } from '@shared/schemas';
import { parseStoreLink, type AppLookup } from '@shared/storeLink';
import { api, parseError } from '@/lib/api';
import { navigate, useUi } from '@/lib/store';
import { qk, useAdsCustomers, useApps, useSecrets } from '@/lib/queries';
import { Button, Field, Input, Select, StatusBadge, cx } from './ui';
import { toast, toastError } from './toast';
import { Guide } from './guides';
import { AppIcon, useIconBackfill } from './AppIcon';

export const KIND_LABEL: Record<AccountKind, string> = { ads: 'Google Ads', admob: 'AdMob', youtube: 'YouTube', play: 'Google Play', firebase: 'Firebase' };

// Xử lý lỗi thống nhất: mỗi lỗi có nút hành động đúng (nguyên tắc 5).
export function useErrorHandler() {
  return (err: unknown, retry?: () => void) => {
    const e = parseError(err);
    toastError(e, {
      retry,
      openSettings: () => navigate('/settings'),
      reauth: () => e.accountId && void api.auth.signIn(e.accountId.split(':')[0] as AccountKind),
    });
    return e;
  };
}

export function useSignIn() {
  const onError = useErrorHandler();
  const [pending, setPending] = useState<AccountKind | null>(null);
  const signIn = async (kind: AccountKind) => {
    setPending(kind);
    try {
      const acc = await api.auth.signIn(kind);
      toast({ tone: 'success', title: `Đã kết nối ${KIND_LABEL[kind]} · ${acc.email}` });
    } catch (err) {
      onError(err, () => void signIn(kind));
    } finally {
      setPending(null);
    }
  };
  return { signIn, pending };
}

// ── Cấu hình OAuth client + developer token ───────────────────────────────
export function SecretsForm() {
  const qc = useQueryClient();
  const { data: status } = useSecrets();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [devToken, setDevToken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const onError = useErrorHandler();

  const saveClient = async () => {
    const r = OAuthClientSchema.safeParse({ clientId, clientSecret });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    try {
      qc.setQueryData(qk.secrets, await api.secrets.setOAuthClient(r.data));
      setClientSecret('');
      toast({ tone: 'success', title: 'Đã lưu OAuth client (mã hóa bằng keychain)' });
    } catch (e) {
      onError(e);
    }
  };
  const saveToken = async () => {
    const r = DeveloperTokenSchema.safeParse(devToken);
    if (!r.success) return setErrors({ devToken: r.error.issues[0].message });
    setErrors({});
    try {
      qc.setQueryData(qk.secrets, await api.secrets.setDeveloperToken(r.data));
      setDevToken('');
      toast({ tone: 'success', title: 'Đã lưu developer token' });
    } catch (e) {
      onError(e);
    }
  };

  // Dán nguyên file JSON tải từ Google Cloud vào ô Client ID → tự tách id + secret
  const onClientIdChange = (text: string) => {
    try {
      const j = JSON.parse(text) as { installed?: { client_id?: string; client_secret?: string }; web?: unknown };
      if (j.installed?.client_id) {
        setClientId(j.installed.client_id);
        setClientSecret(j.installed.client_secret ?? '');
        toast({ tone: 'info', title: 'Đã tách Client ID và Client secret từ file JSON' });
        return;
      }
      if (j.web) return setErrors({ clientId: 'Đây là client loại Web application — cần tạo loại Desktop app' });
    } catch {
      // không phải JSON: gõ/dán client ID bình thường
    }
    setClientId(text.trim());
  };

  return (
    <div className="space-y-4">
    <Guide id="cloudSetup" defaultOpen={status?.oauthClient === 'missing'} />
    <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">OAuth client (Desktop app)</h3>
          {status && (
            <StatusBadge tone={status.oauthClient === 'missing' ? 'warning' : 'success'}>
              {status.oauthClient === 'missing' ? 'Chưa cấu hình' : status.oauthClient === 'bundled' ? 'Dùng bản nhúng' : 'Đã lưu'}
            </StatusBadge>
          )}
        </div>
        {status?.clientId && (
          <div className="rounded-sm border border-border bg-surface-2 p-2 text-xs" data-selectable>
            <p>Đang dùng: <span className="font-mono">{status.clientId}</span></p>
            {status.projectNumber && (
              <p className="mt-1">
                Project number <b className="font-mono">{status.projectNumber}</b> — email đăng nhập phải nằm trong Test users của <b>đúng project này</b> (hoặc project đã ở In production).{' '}
                <button className="text-accent underline" onClick={() => void api.app.openExternal(`https://console.cloud.google.com/auth/audience?project=${status.projectNumber}`)}>
                  Mở trang Test users
                </button>
              </p>
            )}
          </div>
        )}
        <Field label="Client ID" htmlFor="cid" error={errors.clientId}>
          <Input id="cid" value={clientId} invalid={!!errors.clientId} onChange={(e) => onClientIdChange(e.target.value)} placeholder="123-abc.apps.googleusercontent.com hoặc dán nội dung file JSON" />
        </Field>
        <Field label="Client secret" htmlFor="csec" error={errors.clientSecret}>
          <Input id="csec" type="password" value={clientSecret} invalid={!!errors.clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
        </Field>
        <Button variant="primary" icon={Save} onClick={saveClient}>Lưu OAuth client</Button>
        <Guide id="oauthClient" defaultOpen={status?.oauthClient === 'missing'} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Quyền Google Ads API</h3>
          {status?.projectNumber && <span className="font-mono text-xs text-muted">project {status.projectNumber}</span>}
        </div>
        <p className="text-sm text-muted">Không cần developer token nữa: mức truy cập (Test / Explorer / Basic) theo Cloud project chứa OAuth client. Lỗi <span className="font-mono text-xs">CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION</span> = project còn ở mức Test.</p>
        <Guide id="adsAccess" />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Developer token cũ (không bắt buộc){status?.developerToken ? ' · đã lưu' : ''}</summary>
          <div className="mt-2 space-y-2">
            <Field label="Developer token" htmlFor="dt" error={errors.devToken} hint="Google đã khai tử từ 9/9/2026, máy chủ bỏ qua. Chỉ nhập nếu bạn vẫn muốn gửi kèm.">
              <Input id="dt" type="password" value={devToken} invalid={!!errors.devToken} onChange={(e) => setDevToken(e.target.value)} />
            </Field>
            <Button icon={KeyRound} onClick={saveToken}>Lưu token</Button>
          </div>
        </details>
      </div>
    </div>
    </div>
  );
}

// ── Danh sách tài khoản đã kết nối ────────────────────────────────────────
export function AccountList({ kind }: { kind?: AccountKind }) {
  const accounts = useUi((s) => s.accounts).filter((a) => !kind || a.kind === kind);
  const { signIn, pending } = useSignIn();
  const onError = useErrorHandler();
  if (!accounts.length) return null;
  return (
    <ul className="divide-y divide-border rounded-sm border border-border">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="w-24 shrink-0 text-xs font-medium text-muted">{KIND_LABEL[a.kind]}</span>
          <span className="flex-1 truncate" data-selectable>{a.email}</span>
          {a.status === 'active' ? <StatusBadge tone="success">Hoạt động</StatusBadge> : <StatusBadge tone="danger">Cần đăng nhập lại</StatusBadge>}
          {a.status === 'reauth' ? (
            <Button size="sm" variant="primary" icon={LogIn} loading={pending === a.kind} onClick={() => signIn(a.kind)}>Đăng nhập lại</Button>
          ) : (
            <Button size="sm" variant="ghost" icon={RefreshCw} title="Đọc lại danh mục" onClick={() => api.directory.refresh(a.id).catch((e) => onError(e))}>
              Làm mới
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={LogOut} onClick={() => api.auth.signOut(a.id).catch((e) => onError(e))}>Gỡ</Button>
        </li>
      ))}
    </ul>
  );
}

// ── Map app: package ↔ AdMob app ID ↔ Ads customer ────────────────────────
const EMPTY: Omit<AppMapping, 'id'> = { name: '', store: 'GOOGLE_PLAY', storeAppId: '', admobAppId: null, adsCustomerId: null, roasTarget: null, iconUrl: null };

export function AppMappingForm({ initial, onSaved }: { initial?: AppMapping; onSaved?: (a: AppMapping) => void }) {
  const qc = useQueryClient();
  const { data: customers = [] } = useAdsCustomers();
  const [v, setV] = useState<Omit<AppMapping, 'id'> & { id?: string }>(initial ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const onError = useErrorHandler();
  const set = <K extends keyof AppMapping>(k: K, val: AppMapping[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setAuto((a) => (a.has(k) ? new Set([...a].filter((x) => x !== k)) : a)); // sửa tay thì không ghi đè nữa
  };

  // Dán link cửa hàng → điền tên, package, AdMob app ID, tài khoản Ads (chỉ ghi vào ô trống hoặc ô vừa tự điền)
  const [link, setLink] = useState('');
  const [lookup, setLookup] = useState<AppLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [auto, setAuto] = useState<Set<keyof AppMapping>>(new Set());
  const runLookup = async (raw: string) => {
    if (!parseStoreLink(raw)) return setErrors({ link: 'Không đọc được link — dán link Google Play, link mời thử nghiệm, link App Store hoặc package name' });
    setErrors({});
    setLooking(true);
    try {
      const r = await api.apps.lookup(raw);
      setLookup(r);
      const filled = new Set<keyof AppMapping>(['store', 'storeAppId']);
      setV((p) => {
        const take = <K extends keyof AppMapping>(k: K, val: AppMapping[K] | null) => {
          const cur = p[k];
          if (val == null || (cur && !auto.has(k))) return cur;
          filled.add(k);
          return val;
        };
        return { ...p, store: r.store, storeAppId: r.storeAppId, iconUrl: r.iconUrl ?? p.iconUrl, name: take('name', r.name) ?? '', admobAppId: take('admobAppId', r.admobAppId), adsCustomerId: take('adsCustomerId', r.adsCustomerId) };
      });
      setAuto(filled);
    } catch (e) {
      onError(e);
    } finally {
      setLooking(false);
    }
  };

  // Kiểm tra khi gõ: hiện lỗi ngay trên ô, không đợi bấm Lưu
  const check = (next = v) => {
    const r = AppMappingSchema.safeParse(next);
    const errs = r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
    setErrors(errs);
    return r;
  };

  const save = async () => {
    const r = check();
    if (!r.success) return;
    setSaving(true);
    try {
      const saved = await api.apps.save({ ...r.data, id: v.id });
      await qc.invalidateQueries({ queryKey: qk.apps });
      toast({ tone: 'success', title: `Đã lưu app ${saved.name}` });
      setV(initial ? saved : EMPTY);
      setLink('');
      setLookup(null);
      setAuto(new Set());
      onSaved?.(saved);
    } catch (e) {
      const err: AppError = onError(e);
      if (err.field) setErrors({ [err.field]: err.message });
    } finally {
      setSaving(false);
    }
  };

  const touched = (k: string) => errors[k] && (v as Record<string, unknown>)[k] !== EMPTY[k as keyof typeof EMPTY];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {!v.id && (
        <div className="col-span-full flex flex-col gap-1.5">
          <Field label="Dán link cửa hàng để tự điền" htmlFor="alink" error={errors.link}
            hint="play.google.com/store/apps/details?id=… · link mời thử nghiệm play.google.com/apps/testing/… · apps.apple.com/…/id… · hoặc package name">
            <div className="flex gap-2">
              <Input id="alink" value={link} placeholder="https://play.google.com/store/apps/details?id=com.streamwave.tv"
                onChange={(e) => setLink(e.target.value)}
                onPaste={(e) => {
                  const t = e.clipboardData.getData('text');
                  if (parseStoreLink(t)) void runLookup(t);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void runLookup(link)} />
              <Button icon={Wand2} loading={looking} disabled={!link.trim()} onClick={() => void runLookup(link)}>Điền tự động</Button>
            </div>
          </Field>
          {lookup && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {lookup.existingId && <span className="font-medium text-warning">App này đã được map — sửa trong danh sách bên dưới thay vì thêm mới.</span>}
              {lookup.sources.name && <span className="text-success">✓ Tên từ {lookup.sources.name}</span>}
              {lookup.sources.admobAppId && <span className="text-success">✓ AdMob app ID từ {lookup.sources.admobAppId}</span>}
              {lookup.sources.adsCustomerId && <span className="text-success">✓ Tài khoản Ads từ lịch sử camp</span>}
              {!lookup.admobAppId && !lookup.admobCandidates.length && <span className="text-muted">AdMob: không thấy app khớp — app chưa live thì tạo app tay trong AdMob rồi dán app ID</span>}
              {lookup.notes.map((n) => <span key={n} className="text-muted">{n}</span>)}
            </div>
          )}
          {lookup && !lookup.sources.admobAppId?.includes('đã liên kết') && lookup.admobCandidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">App AdMob tạo tay có tên giống (app chưa live không liên kết store được):</span>
              {lookup.admobCandidates.map((c) => (
                <button key={c.appId} type="button" onClick={() => set('admobAppId', c.appId)} title={c.appId}
                  className={cx('rounded-full px-2 py-0.5 ring-1', v.admobAppId === c.appId ? 'bg-accent text-accent-fg ring-accent' : 'bg-surface ring-border hover:text-accent')}>
                  {c.name}{c.exact ? ' · trùng tên' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <Field label="Tên app" htmlFor="an" error={touched('name') ? errors.name : undefined}>
        <div className="flex items-center gap-2">
          <AppIcon url={v.iconUrl} name={v.name || '?'} />
          <Input id="an" value={v.name} onChange={(e) => set('name', e.target.value)} onBlur={() => check()} placeholder="StreamWave" />
        </div>
      </Field>
      <Field label="Store" htmlFor="as">
        <Select id="as" value={v.store} onChange={(e) => set('store', e.target.value as AppMapping['store'])}>
          <option value="GOOGLE_PLAY">Google Play</option>
          <option value="APPLE_APP_STORE">App Store</option>
        </Select>
      </Field>
      <Field label={v.store === 'GOOGLE_PLAY' ? 'Package name' : 'App Store ID'} htmlFor="aid" error={touched('storeAppId') ? errors.storeAppId : undefined}>
        <Input id="aid" className="font-mono" value={v.storeAppId}
          onChange={(e) => {
            // Dán cả link vào ô này cũng được: tách package rồi tự điền phần còn lại
            const ref = /[/:]/.test(e.target.value) ? parseStoreLink(e.target.value) : null;
            if (ref && !v.id) {
              setLink(e.target.value);
              void runLookup(e.target.value);
            } else set('storeAppId', e.target.value);
          }}
          onBlur={() => check()} placeholder={v.store === 'GOOGLE_PLAY' ? 'com.streamwave.tv' : '1234567890'} />
      </Field>
      <Field label="AdMob app ID" htmlFor="adm" error={v.admobAppId ? errors.admobAppId : undefined} hint="Không bắt buộc; cần cho ROAS">
        <Input id="adm" className="font-mono" value={v.admobAppId ?? ''} invalid={!!(v.admobAppId && errors.admobAppId)} onChange={(e) => set('admobAppId', e.target.value || null)} onBlur={() => check()} placeholder="ca-app-pub-…~…" />
      </Field>
      <Field label="Tài khoản Google Ads" htmlFor="acu">
        <Select id="acu" value={v.adsCustomerId ?? ''} onChange={(e) => set('adsCustomerId', e.target.value || null)}>
          <option value="">{customers.length ? 'Chọn customer…' : 'Chưa đọc được customer'}</option>
          {customers.filter((c) => !c.manager).map((c) => (
            <option key={c.customerId} value={c.customerId}>{c.name} · {c.customerId}</option>
          ))}
        </Select>
      </Field>
      <Field label="ROAS mục tiêu" htmlFor="roas" hint="Ví dụ 1.2 = 120%">
        <Input id="roas" type="number" step="0.05" min="0" className="num" value={v.roasTarget ?? ''} onChange={(e) => set('roasTarget', e.target.value ? Number(e.target.value) : null)} />
      </Field>
      <div className={cx('col-span-full flex justify-end gap-2')}>
        <Button variant="primary" icon={Save} loading={saving} onClick={save}>{v.id ? 'Lưu thay đổi' : 'Thêm app'}</Button>
      </div>
    </div>
  );
}

export function AppList({ onEdit }: { onEdit: (a: AppMapping) => void }) {
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const { data: apps = [] } = useApps();
  const [busy, setBusy] = useState(false);
  useIconBackfill(apps);
  const refetchIcons = async () => {
    setBusy(true);
    try {
      const n = await api.apps.refreshIcons(true);
      await qc.invalidateQueries({ queryKey: qk.apps });
      toast({ tone: 'success', title: n ? `Đã cập nhật icon ${n} app` : 'Icon đã mới nhất' });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!apps.length) return <p className="text-sm text-muted">Chưa map app nào — điền form phía trên để ghép package name với AdMob app ID và tài khoản Ads.</p>;
  return (
    <div className="flex flex-col gap-2">
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} onClick={refetchIcons} title="Lấy lại icon từ Play Console / trang cửa hàng">Cập nhật icon</Button>
    </div>
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted">
        <tr className="h-row border-b border-border">
          <th className="px-2 font-medium">App</th>
          <th className="px-2 font-medium">Store ID</th>
          <th className="px-2 font-medium">AdMob app ID</th>
          <th className="px-2 font-medium">Ads customer</th>
          <th className="num px-2 font-medium">ROAS mục tiêu</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => (
          <tr key={a.id} className="h-row border-b border-border hover:bg-surface-2">
            <td className="px-2 font-medium">
              <span className="flex items-center gap-2"><AppIcon url={a.iconUrl} name={a.name} size="sm" />{a.name}</span>
            </td>
            <td className="px-2 font-mono text-xs" data-selectable>{a.storeAppId}</td>
            <td className="px-2 font-mono text-xs" data-selectable>{a.admobAppId ?? <span className="text-warning">Chưa map</span>}</td>
            <td className="px-2 font-mono text-xs">{a.adsCustomerId ?? <span className="text-warning">Chưa chọn</span>}</td>
            <td className="num px-2">{a.roasTarget != null ? `${Math.round(a.roasTarget * 100)}%` : '—'}</td>
            <td className="px-2 text-right">
              <Button size="sm" variant="ghost" onClick={() => onEdit(a)}>Sửa</Button>
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                aria-label={`Xóa ${a.name}`}
                onClick={() => api.apps.remove(a.id).then(() => qc.invalidateQueries({ queryKey: qk.apps })).catch((e) => onError(e))}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
