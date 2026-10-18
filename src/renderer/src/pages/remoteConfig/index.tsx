import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, LogIn, RotateCcw, Upload } from 'lucide-react';
import { consoleManaged, diffTemplates, type RcFetched, type RcProject, type RcTemplate } from '@shared/remoteConfig';
import { api, parseError } from '@/lib/api';
import { setState, useUi } from '@/lib/store';
import { useRcProjects } from './useRc';
import { fmtDateTime } from '@/lib/format';
import { Banner, Button, Card, EmptyState, Input, PageHeader, Skeleton, cx } from '@/components/ui';
import { Dialog } from '@/components/dialog';
import { toast } from '@/components/toast';
import { useErrorHandler, useSignIn } from '@/components/connect';
import { Guide } from '@/components/guides';
import { DiffTable } from './DiffTable';
import { Parameters } from './Parameters';
import { Conditions } from './Conditions';
import { AbTests } from './AbTests';
import { ReplaceTab } from './ReplaceTab';
import { History } from './History';

type Tab = 'params' | 'replace' | 'conditions' | 'ab' | 'history';
const TABS: [Tab, string][] = [
  ['params', 'Tham số'],
  ['replace', 'Tìm & thay thế'],
  ['conditions', 'Điều kiện'],
  ['ab', 'A/B tự quản'],
  ['history', 'Lịch sử'],
];

export const rcKey = (acc: string, pid: string) => ['rc', 'template', pid, acc] as const;

// Bản nháp dùng chung cho tab Tham số / Điều kiện / A/B: sửa thoải mái, chỉ ghi lên Firebase khi bấm Publish.
export interface Draft {
  project: RcProject;
  original: RcTemplate;
  template: RcTemplate;
  etag: string;
  set: (t: RcTemplate) => void;
}

export function RemoteConfig() {
  const projectId = useUi((s) => s.rcProjectId);
  const { signIn, pending } = useSignIn();
  const { accounts, accountId, projects, isLoading } = useRcProjects();
  const project = projects.find((p) => p.projectId === projectId) ?? null;
  const [tab, setTab] = useState<Tab>('params');

  // Chưa chọn project, hoặc project không thuộc tài khoản vừa chọn: tự chọn project đầu tiên
  useEffect(() => {
    if (projects.length && !projects.some((p) => p.projectId === projectId)) setState({ rcProjectId: projects[0].projectId });
  }, [projectId, projects]);

  if (!accounts.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Remote Config" />
        <EmptyState icon={Flame} title="Chưa kết nối Firebase"
          action={<Button variant="primary" icon={LogIn} loading={pending === 'firebase'} onClick={() => signIn('firebase')}>Đăng nhập Firebase</Button>}>
          Tìm & thay thế hàng loạt trên nhiều project, sửa tham số và điều kiện, chia nhóm A/B, xem lịch sử và hoàn tác — mọi thay đổi đều xem trước rồi mới publish.
        </EmptyState>
        <Guide id="firebaseSignIn" defaultOpen />
      </div>
    );
  }
  if (isLoading) return <Skeleton className="h-64" />;
  if (!projects.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Remote Config" />
        <EmptyState icon={Flame} title={accountId ? 'Tài khoản này chưa có project Firebase nào' : 'Chưa đọc được project Firebase nào'}
          action={<Button onClick={() => accounts.filter((a) => !accountId || a.id === accountId).forEach((a) => void api.directory.refresh(a.id))}>Đọc lại danh sách project</Button>}>
          Kiểm tra đã bật Firebase Management API và email có quyền trên project. Lỗi chi tiết ở hàng đợi job (⌘J).
        </EmptyState>
        <Guide id="firebaseSignIn" defaultOpen />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
      <PageHeader title={project ? `Remote Config · ${project.displayName}` : 'Remote Config'}>
        {project && <span className="font-mono text-xs text-muted" data-selectable>{project.projectId} · {project.apps.length} app · {accounts.find((a) => a.id === project.accountId)?.email}</span>}
      </PageHeader>
      <div role="tablist" className="-mt-3 flex gap-1 border-b border-border">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      {/* Tìm & thay thế làm trên nhiều project, không phụ thuộc project đang chọn */}
      {tab === 'replace' ? <ReplaceTab key={accountId ?? 'all'} projects={projects} /> : project ? <ProjectWorkspace key={`${project.accountId}|${project.projectId}`} project={project} tab={tab} /> : <EmptyState icon={Flame} title="Chọn project ở thanh trên" />}
    </div>
  );
}

function ProjectWorkspace({ project, tab }: { project: RcProject; tab: Exclude<Tab, 'replace'> }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const q = useQuery({ queryKey: rcKey(project.accountId, project.projectId), queryFn: () => api.rc.template(project.accountId, project.projectId), staleTime: Infinity });
  const [draft, setDraft] = useState<RcTemplate | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Template mới từ Firebase (tải lại / publish xong): bỏ bản nháp nếu ETag đổi
  const etag = q.data?.etag;
  useEffect(() => setDraft(null), [etag]);

  const original = q.data?.template ?? null;
  const template = draft ?? original;
  const changes = useMemo(() => (original && template ? diffTemplates(original, template) : []), [original, template]);
  const managed = useMemo(() => (original ? consoleManaged(original) : { rollout: 0, personalization: 0 }), [original]);

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data || !template || !original) {
    return (
      <Card className="overflow-hidden">
        <Banner tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Thử lại</Button>}>{parseError(q.error).message}</Banner>
      </Card>
    );
  }
  const d: Draft = { project, original, template, etag: q.data.etag, set: setDraft };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Phiên bản {original.version?.versionNumber ?? '—'} · {original.version?.updateTime ? fmtDateTime(original.version.updateTime) : ''}{original.version?.updateUser?.email ? ` · ${original.version.updateUser.email}` : ''}</span>
        {(managed.rollout > 0 || managed.personalization > 0) && (
          <span className="text-warning" title="Giá trị do Rollout / A/B Testing / Personalization trên Firebase Console quản lý: app chỉ đọc, không sửa">
            · {managed.rollout ? `${managed.rollout} giá trị đang rollout / A/B trên Console` : ''}{managed.personalization ? ` ${managed.personalization} personalization` : ''} (chỉ đọc)
          </span>
        )}
        <span className="flex-1" />
        {changes.length > 0 && (
          <>
            <span className="font-medium text-warning">{changes.length} thay đổi chưa publish</span>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => window.confirm('Bỏ mọi thay đổi chưa publish?') && setDraft(null)}>Bỏ nháp</Button>
          </>
        )}
        <Button size="sm" variant="primary" icon={Upload} disabled={!changes.length || !online} onClick={() => setPublishing(true)}>Publish lên Firebase</Button>
      </div>

      {tab === 'params' && <Parameters d={d} />}
      {tab === 'conditions' && <Conditions d={d} />}
      {tab === 'ab' && <AbTests d={d} />}
      {tab === 'history' && <History project={project} current={q.data} dirty={changes.length > 0} />}

      {publishing && (
        <PublishDialog project={project} fetched={q.data} template={template} onClose={() => setPublishing(false)}
          onDone={(f) => {
            qc.setQueryData(rcKey(project.accountId, project.projectId), f);
            void qc.invalidateQueries({ queryKey: ['rc', 'versions', project.projectId] });
            setPublishing(false);
          }} />
      )}
    </div>
  );
}

function PublishDialog({ project, fetched, template, onClose, onDone }: { project: RcProject; fetched: RcFetched; template: RcTemplate; onClose: () => void; onDone: (f: RcFetched) => void }) {
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const onError = useErrorHandler();
  const rows = diffTemplates(fetched.template, template);
  const confirm = async () => {
    setBusy(true);
    try {
      const f = await api.rc.publish({ accountId: project.accountId, projectId: project.projectId, etag: fetched.etag, template, description: desc.trim() || undefined });
      toast({ tone: 'success', title: `Đã publish Remote Config · ${project.displayName}`, detail: `Phiên bản ${f.template.version?.versionNumber ?? ''}` });
      onDone(f);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Publish Remote Config · ${project.displayName}`} onClose={onClose} width="w-[820px]"
      footer={<><Button variant="ghost" onClick={onClose}>Hủy</Button><Button variant="primary" icon={Upload} loading={busy} onClick={confirm}>Publish {rows.length} thay đổi</Button></>}>
      <div className="flex flex-col gap-3">
        <DiffTable rows={rows} />
        <Input placeholder="Mô tả phiên bản (không bắt buộc) — hiện trong lịch sử Firebase" value={desc} maxLength={256} onChange={(e) => setDesc(e.target.value)} aria-label="Mô tả phiên bản" />
        <p className="text-xs text-muted">Firebase kiểm tra template trước (validateOnly), rồi mới publish. Nếu ai đó vừa sửa trên Console, Firebase từ chối để không ghi đè — tải lại rồi làm lại. Người dùng nhận giá trị mới ở lần fetch tiếp theo của app.</p>
      </div>
    </Dialog>
  );
}
