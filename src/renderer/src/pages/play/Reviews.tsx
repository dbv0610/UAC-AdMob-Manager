import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Languages, MessageSquare, Pencil, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { REPLY_MAX, STAGE_LABEL, appStage, fillTemplate, reviewStats, type PlayReview, type ReplyTemplate } from '@shared/playOps';
import { playLength } from '@shared/listing';
import { counterTone } from '@shared/textLength';
import { api, parseError } from '@/lib/api';
import { qk, useSecrets } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Field, Input, Select, Skeleton, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { FilterChips } from '@/components/kit';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { Stars } from './parts';

type Filter = 'all' | 'unanswered' | 'low';
const TEMPLATES_KEY = ['play', 'replyTemplates'] as const;

export function Reviews({ accountId, pkg, appName }: { accountId: string; pkg: string; appName: string }) {
  const q = useQuery({ queryKey: qk.playReviews(accountId, pkg), queryFn: () => api.play.reviews(accountId, pkg) });
  // Giai đoạn app: app chưa công khai thì không có review trên cửa hàng
  const tracksQ = useQuery({ queryKey: qk.playTracks(accountId, pkg), queryFn: () => api.play.tracks(accountId, pkg) });
  const templatesQ = useQuery({ queryKey: TEMPLATES_KEY, queryFn: () => api.play.replyTemplates(), staleTime: Infinity });
  const [filter, setFilter] = useState<Filter>('unanswered');
  const [stars, setStars] = useState('');
  const [lang, setLang] = useState('');
  const [version, setVersion] = useState('');
  const [manage, setManage] = useState(false);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const langs = useMemo(() => [...new Set(all.map((r) => r.language).filter((x): x is string => !!x))].sort(), [all]);
  const versions = useMemo(() => [...new Set(all.map((r) => r.appVersion).filter((x): x is string => !!x))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), [all]);

  if (q.isLoading) return <Skeleton className="h-64" />;
  const stage = tracksQ.data ? appStage(tracksQ.data) : null;
  const notPublic = stage != null && stage !== 'production' && stage !== 'open';
  if (q.isError) {
    return (
      <Card className="overflow-hidden">
        <Banner tone={notPublic ? 'info' : 'danger'} action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>
          {notPublic ? `App đang ở giai đoạn ${STAGE_LABEL[stage!]}: chưa có review công khai. Góp ý của tester là riêng tư, chỉ xem được trên Play Console.` : parseError(q.error).message}
        </Banner>
      </Card>
    );
  }
  const st = reviewStats(all);
  const rows = all.filter(
    (r) =>
      (filter === 'unanswered' ? !r.reply : filter === 'low' ? !r.reply && r.rating <= 2 : true) &&
      (!stars || r.rating === Number(stars)) &&
      (!lang || r.language === lang) &&
      (!version || r.appVersion === version),
  );

  return (
    <div className="flex flex-col gap-4">
      {notPublic && (
        <Card className="overflow-hidden">
          <Banner tone="info">App đang ở giai đoạn <b>{STAGE_LABEL[stage!]}</b>: chưa có review công khai trên cửa hàng. Góp ý của tester là riêng tư, Play không trả qua API — xem trên Play Console → Thử nghiệm.</Banner>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips<Filter> label="Lọc review" value={filter} onChange={setFilter}
          chips={[
            { id: 'unanswered', label: 'Chưa trả lời', count: st.unanswered, tone: 'warning' },
            { id: 'low', label: '≤2★ chưa trả lời', count: st.lowUnanswered, tone: 'danger' },
            { id: 'all', label: 'Tất cả', count: st.count },
          ]} />
        <Select className="w-28" aria-label="Lọc theo sao" value={stars} onChange={(e) => setStars(e.target.value)}>
          <option value="">Mọi sao</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}★</option>)}
        </Select>
        <Select className="w-40" aria-label="Lọc theo ngôn ngữ" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="">Mọi ngôn ngữ</option>
          {langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
        <Select className="w-40" aria-label="Lọc theo phiên bản" value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="">Mọi phiên bản</option>
          {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
        </Select>
        <span className="flex-1" />
        <Button size="sm" icon={FileText} onClick={() => setManage(true)}>Câu trả lời mẫu ({templatesQ.data?.length ?? 0})</Button>
      </div>
      <p className="-mt-2 text-xs text-muted">{st.avg == null ? '' : `Trung bình ${fmtNumber(st.avg, 1)}★ · `}Play chỉ trả review có chữ trong 7 ngày gần nhất · review tiếng nước ngoài có kèm bản dịch tiếng Việt của Google</p>
      {!rows.length ? (
        <EmptyState icon={MessageSquare} title={all.length ? 'Không còn review nào khớp bộ lọc' : 'Không có review mới trong 7 ngày'} />
      ) : (
        rows.map((r) => <ReviewCard key={r.id} review={r} accountId={accountId} pkg={pkg} appName={appName} templates={templatesQ.data ?? []} />)
      )}
      {manage && <TemplatesDialog templates={templatesQ.data ?? []} onClose={() => setManage(false)} />}
    </div>
  );
}

function ReviewCard({ review: r, accountId, pkg, appName, templates }: { review: PlayReview; accountId: string; pkg: string; appName: string; templates: ReplyTemplate[] }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const { data: secrets } = useSecrets();
  const onError = useErrorHandler();
  const [editing, setEditing] = useState(!r.reply);
  const [text, setText] = useState(r.reply?.text ?? '');
  const [busy, setBusy] = useState<'ai' | 'send' | null>(null);
  const len = playLength(text.trim());
  const tone = counterTone(len, REPLY_MAX);

  const suggest = async () => {
    setBusy('ai');
    try {
      setText(await api.play.suggestReply({ appName, rating: r.rating, text: r.text, language: r.language }));
    } catch (err) {
      onError(err, () => void suggest());
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy('send');
    try {
      const reply = await api.play.reply({ accountId, packageName: pkg, reviewId: r.id, text: text.trim() });
      qc.setQueryData<PlayReview[]>(qk.playReviews(accountId, pkg), (old) => old?.map((x) => (x.id === r.id ? { ...x, reply } : x)));
      void qc.invalidateQueries({ queryKey: qk.playOverview });
      setEditing(false);
      toast({ tone: 'success', title: 'Đã gửi câu trả lời lên Google Play' });
    } catch (err) {
      onError(err, () => void send());
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className={cx('flex flex-col gap-2 p-4', !r.reply && r.rating <= 2 && 'border-danger/40')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Stars value={r.rating} />
        <b>{r.author}</b>
        <span className="text-xs text-muted">{fmtDateTime(r.at)}</span>
        <span className="flex-1" />
        <span className="text-xs text-muted">{[r.language, r.appVersion && `v${r.appVersion}`, r.device, r.androidVersion && `Android API ${r.androidVersion}`].filter(Boolean).join(' · ')}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap" data-selectable>{r.text || <i className="text-muted">(chỉ chấm sao)</i>}</p>
      {r.translated && (
        <p className="flex gap-1.5 text-sm text-muted" data-selectable>
          <Languages className="mt-0.5 size-3.5 shrink-0" aria-label="Bản dịch" />
          <span className="whitespace-pre-wrap">{r.translated}</span>
        </p>
      )}
      {r.reply && !editing && (
        <div className="rounded-md border-l-2 border-accent bg-surface-2/60 px-3 py-2 text-sm">
          <p className="mb-0.5 flex items-center gap-2 text-xs text-muted">Bạn đã trả lời · {fmtDateTime(r.reply.at)}
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Sửa</Button>
          </p>
          <p className="whitespace-pre-wrap" data-selectable>{r.reply.text}</p>
        </div>
      )}
      {editing && (
        <div className="flex flex-col gap-1.5">
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={`Trả lời ${r.author}`} placeholder="Viết câu trả lời (người dùng nhận thông báo)…"
            className={cx('min-h-20 w-full rounded-sm border bg-surface p-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30', len > REPLY_MAX ? 'border-danger' : 'border-border')} />
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('num text-xs', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>{len}/{REPLY_MAX}</span>
            <span className="flex-1" />
            {templates.length > 0 && (
              <Select className="w-44" aria-label="Chèn câu trả lời mẫu" value="" onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) setText(fillTemplate(t.text, appName));
              }}>
                <option value="">Dùng mẫu…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
            {secrets?.aiKey && <Button size="sm" icon={Sparkles} loading={busy === 'ai'} disabled={!online} onClick={suggest}>AI gợi ý</Button>}
            {r.reply && <Button size="sm" variant="ghost" onClick={() => { setText(r.reply!.text); setEditing(false); }}>Hủy</Button>}
            <Button size="sm" variant="primary" icon={Send} loading={busy === 'send'} disabled={!online || !len || len > REPLY_MAX} onClick={send}>
              {r.reply ? 'Cập nhật trả lời' : 'Gửi trả lời'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// Câu trả lời mẫu dùng chung mọi app; {app} được thay bằng tên app khi chèn
function TemplatesDialog({ templates, onClose }: { templates: ReplyTemplate[]; onClose: () => void }) {
  const qc = useQueryClient();
  const onError = useErrorHandler();
  const [items, setItems] = useState<ReplyTemplate[]>(templates);
  const [busy, setBusy] = useState(false);
  const set = (id: string, patch: Partial<ReplyTemplate>) => setItems(items.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const invalid = items.some((t) => !t.name.trim() || !t.text.trim() || playLength(t.text) > REPLY_MAX);
  const save = async () => {
    setBusy(true);
    try {
      qc.setQueryData(TEMPLATES_KEY, await api.play.setReplyTemplates(items.map((t) => ({ ...t, name: t.name.trim(), text: t.text.trim() }))));
      toast({ tone: 'success', title: 'Đã lưu câu trả lời mẫu' });
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Câu trả lời mẫu" onClose={onClose} width="w-[640px]"
      footer={<><Button variant="ghost" onClick={onClose}>Hủy</Button><Button variant="primary" loading={busy} disabled={invalid} onClick={save}>Lưu</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">Dùng chung mọi app. Viết <code className="rounded bg-surface-2 px-1 font-mono">{'{app}'}</code> để chèn tên app. Tối đa {REPLY_MAX} ký tự.</p>
        {items.map((t) => {
          const len = playLength(t.text);
          return (
            <div key={t.id} className="flex flex-col gap-1.5 rounded-md border border-border p-3">
              <div className="flex items-end gap-2">
                <Field label="Tên mẫu" htmlFor={`tpl-${t.id}`}>
                  <Input id={`tpl-${t.id}`} className="w-64" value={t.name} placeholder="VD: Cảm ơn 5 sao" onChange={(e) => set(t.id, { name: e.target.value })} />
                </Field>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setItems(items.filter((x) => x.id !== t.id))}>Xóa</Button>
              </div>
              <textarea value={t.text} onChange={(e) => set(t.id, { text: e.target.value })} aria-label={`Nội dung mẫu ${t.name}`}
                className={cx('min-h-16 w-full rounded-sm border bg-surface p-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30', len > REPLY_MAX ? 'border-danger' : 'border-border')} />
              <span className={cx('num text-xs', len > REPLY_MAX ? 'text-danger' : 'text-muted')}>{len}/{REPLY_MAX}</span>
            </div>
          );
        })}
        <div>
          <Button size="sm" icon={Plus} disabled={items.length >= 50} onClick={() => setItems([...items, { id: crypto.randomUUID(), name: '', text: '' }])}>Thêm mẫu</Button>
        </div>
      </div>
    </Dialog>
  );
}
