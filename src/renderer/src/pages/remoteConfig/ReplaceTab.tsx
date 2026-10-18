import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Replace, Search } from 'lucide-react';
import { ReplaceQuerySchema, slotId, type RcProject, type ReplacePlan, type ReplaceQuery } from '@shared/remoteConfig';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { Banner, Button, Card, Field, Input, Select, StatusBadge, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { JsonView, isJsonLike } from './Json';

const EMPTY: ReplaceQuery = { find: '', replace: '', mode: 'text', caseSensitive: false, keyFilter: '', slots: 'all', conditionFilter: '', jsonKey: '' };

// Tìm & thay thế trên nhiều project: bước 1 chỉ đọc + xem trước, bước 2 mới ghi (từng project, có ETag)
export function ReplaceTab({ projects }: { projects: RcProject[] }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const current = useUi((s) => s.rcProjectId);
  const onError = useErrorHandler();
  const [selected, setSelected] = useState<Set<string>>(new Set(current ? [current] : []));
  const [query, setQuery] = useState<ReplaceQuery>(EMPTY);
  const [plans, setPlans] = useState<ReplacePlan[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // projectId + slot bỏ chọn
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [desc, setDesc] = useState('');
  const set = (p: Partial<ReplaceQuery>) => {
    setQuery({ ...query, ...p });
    setPlans(null); // đổi điều kiện tìm thì phải xem trước lại
  };
  const parsed = ReplaceQuerySchema.safeParse(query);
  // Chỉ tính project của tài khoản đang chọn (project chọn trước đó ở tài khoản khác bị bỏ qua)
  const chosen = projects.filter((p) => selected.has(p.projectId)).length;

  const plan = async () => {
    if (!parsed.success) return;
    setBusy('plan');
    try {
      const targets = projects.filter((p) => selected.has(p.projectId)).map((p) => ({ accountId: p.accountId, projectId: p.projectId }));
      const res = await api.rc.planReplace({ targets, query: parsed.data });
      setPlans(res);
      setExcluded(new Set(res.flatMap((r) => r.changes.filter((c) => c.error).map((c) => `${r.projectId}\u0001${slotId(c)}`))));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const picked = useMemo(
    () => (plans ?? []).map((r) => ({ ...r, changes: r.changes.filter((c) => !c.error && !excluded.has(`${r.projectId}\u0001${slotId(c)}`)) })).filter((r) => r.etag && r.changes.length),
    [plans, excluded],
  );
  const total = picked.reduce((s, r) => s + r.changes.length, 0);

  const apply = async () => {
    setBusy('apply');
    try {
      const res = await api.rc.applyReplace({
        description: desc.trim() || `AppOps Studio: thay “${query.find.slice(0, 60)}”`,
        targets: picked.map((r) => ({ accountId: r.accountId, projectId: r.projectId, etag: r.etag!, changes: r.changes.map(({ key, group, slot, before, after }) => ({ key, group, slot, before, after })) })),
      });
      const ok = res.filter((r) => r.ok);
      toast({ tone: ok.length === res.length ? 'success' : 'warning', title: `Đã publish ${ok.reduce((s, r) => s + r.changed, 0)} thay đổi trên ${ok.length}/${res.length} project`, detail: res.filter((r) => !r.ok).map((r) => `${r.projectId}: ${r.message}`).join(' · ') || undefined });
      void qc.invalidateQueries({ queryKey: ['rc', 'template'] });
      void qc.invalidateQueries({ queryKey: ['rc', 'versions'] });
      setConfirm(false);
      setPlans(null);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string) => setExcluded((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted">Project ({chosen}/{projects.length})</span>
          <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set(chosen === projects.length ? [] : projects.map((p) => p.projectId))); setPlans(null); }}>
            {chosen === projects.length ? 'Bỏ chọn hết' : 'Chọn hết'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {projects.map((p) => (
            <label key={p.projectId} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={selected.has(p.projectId)} onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(p.projectId) : n.delete(p.projectId); setSelected(n); setPlans(null); }} />
              {p.displayName} <span className="font-mono text-xs text-muted">{p.projectId}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tìm" htmlFor="rf"><Input id="rf" className="font-mono" value={query.find} onChange={(e) => set({ find: e.target.value })} placeholder="ca-app-pub-123/456 hoặc 30" /></Field>
          <Field label="Thay bằng" htmlFor="rr" hint={query.mode === 'regex' ? 'Dùng $1, $2… cho nhóm bắt được' : undefined}><Input id="rr" className="font-mono" value={query.replace} onChange={(e) => set({ replace: e.target.value })} placeholder="(để trống = xóa phần tìm thấy)" /></Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Kiểu khớp" htmlFor="rm">
            <Select id="rm" className="w-44" value={query.mode} onChange={(e) => set({ mode: e.target.value as ReplaceQuery['mode'] })}>
              <option value="text">Chứa chuỗi</option><option value="exact">Khớp cả giá trị</option><option value="regex">Biểu thức chính quy</option>
            </Select>
          </Field>
          <Field label="Chỉ tham số có tên chứa" htmlFor="rk"><Input id="rk" className="w-48 font-mono" value={query.keyFilter} onChange={(e) => set({ keyFilter: e.target.value })} placeholder="(mọi tham số)" /></Field>
          <Field label="Ô giá trị" htmlFor="rs">
            <Select id="rs" className="w-52" value={query.slots} onChange={(e) => set({ slots: e.target.value as ReplaceQuery['slots'] })}>
              <option value="all">Mặc định + điều kiện</option><option value="default">Chỉ mặc định</option><option value="conditional">Chỉ theo điều kiện</option>
            </Select>
          </Field>
          {query.slots !== 'default' && <Field label="Điều kiện có tên chứa" htmlFor="rc"><Input id="rc" className="w-44 font-mono" value={query.conditionFilter} onChange={(e) => set({ conditionFilter: e.target.value })} placeholder="(mọi điều kiện)" /></Field>}
          <Field label="Chỉ khóa JSON" htmlFor="rj"><Input id="rj" className="w-40 font-mono" title="Chỉ thay giá trị của khóa này bên trong JSON (mọi cấp), giữ kiểu số / boolean" value={query.jsonKey} onChange={(e) => set({ jsonKey: e.target.value })} placeholder="(cả chuỗi)" /></Field>
          <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" checked={query.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} /> Phân biệt hoa thường</label>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" icon={Search} loading={busy === 'plan'} disabled={!parsed.success || !chosen || !online} onClick={plan}>Tìm & xem trước</Button>
          <span className="self-center text-xs text-muted">Chưa ghi gì lên Firebase. Giá trị đang chạy rollout / A/B / personalization trên Console luôn được bỏ qua.</span>
        </div>
      </Card>

      {plans && (
        <>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Kết quả: {plans.reduce((s, r) => s + r.changes.length, 0)} chỗ khớp trên {plans.filter((r) => r.changes.length).length} project</h3>
            <span className="flex-1" />
            <Button variant="primary" icon={Replace} disabled={!total || !online} onClick={() => setConfirm(true)}>Thay {total} giá trị…</Button>
          </div>
          {plans.map((r) => (
            <Card key={r.projectId} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 text-sm">
                <b>{projects.find((p) => p.projectId === r.projectId)?.displayName ?? r.projectId}</b>
                <span className="font-mono text-xs text-muted">{r.projectId}</span>
                <span className="flex-1" />
                {r.error ? <StatusBadge tone="danger">Lỗi</StatusBadge> : <span className="text-xs text-muted">{r.changes.length} thay đổi{r.skipped.length ? ` · bỏ qua ${r.skipped.length}` : ''}</span>}
              </div>
              {r.error && <Banner tone="danger">{r.error}</Banner>}
              {r.changes.length > 0 && (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {r.changes.map((c) => {
                      const id = `${r.projectId}\u0001${slotId(c)}`;
                      return (
                        <tr key={id} className={cx('align-top', excluded.has(id) && 'opacity-50')}>
                          <td className="w-8 px-3 py-1.5"><input type="checkbox" aria-label={`Chọn ${c.key}`} disabled={!!c.error} checked={!excluded.has(id) && !c.error} onChange={() => toggle(id)} /></td>
                          <td className="w-64 px-2 py-1.5">
                            <span className="font-mono text-xs font-medium">{c.key}</span>
                            <span className="block text-xs text-muted">{c.slot === 'default' ? 'mặc định' : `điều kiện: ${c.slot}`} · {c.valueType}</span>
                          </td>
                          <td className="max-w-[420px] px-2 py-1.5">
                            {c.valueType === 'JSON' && isJsonLike(c.before) ? <JsonView value={c.before} className="opacity-60" /> : <span title={c.before} className="line-clamp-3 font-mono text-xs break-all text-muted line-through decoration-muted/40">{c.before || '(rỗng)'}</span>}
                          </td>
                          <td className="max-w-[420px] px-2 py-1.5">
                            {c.valueType === 'JSON' && isJsonLike(c.after) ? <JsonView value={c.after} /> : <span title={c.after} className="line-clamp-3 font-mono text-xs break-all">{c.after || '(rỗng)'}</span>}
                            {c.error && <span className="text-xs text-danger">✕ {c.error} — không ghi</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {r.skipped.length > 0 && (
                <p className="px-3 py-1.5 text-xs text-warning">Bỏ qua: {r.skipped.slice(0, 6).map((s) => `${s.key} (${s.slot === 'default' ? 'mặc định' : s.slot}) — ${s.reason}`).join(' · ')}{r.skipped.length > 6 ? '…' : ''}</p>
              )}
              {!r.error && !r.changes.length && !r.skipped.length && <p className="px-3 py-2 text-xs text-muted">Không có chỗ nào khớp.</p>}
            </Card>
          ))}
        </>
      )}

      {confirm && (
        <Dialog title="Publish thay thế hàng loạt" onClose={() => setConfirm(false)} width="w-[560px]"
          footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Hủy</Button><Button variant="primary" icon={Replace} loading={busy === 'apply'} onClick={apply}>Publish {total} thay đổi</Button></>}>
          <div className="flex flex-col gap-3 text-sm">
            <ul className="list-disc pl-5">
              {picked.map((r) => <li key={r.projectId}><b>{r.projectId}</b>: {r.changes.length} giá trị</li>)}
            </ul>
            <Input placeholder="Mô tả phiên bản (không bắt buộc)" value={desc} maxLength={256} onChange={(e) => setDesc(e.target.value)} aria-label="Mô tả phiên bản" />
            <p className="text-xs text-muted">Mỗi project publish thành một phiên bản mới (khôi phục được ở tab Lịch sử). Project nào vừa bị sửa trên Console sau lúc xem trước sẽ bị từ chối, các project khác vẫn chạy.</p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
