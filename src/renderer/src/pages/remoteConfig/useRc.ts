import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RcProject } from '@shared/remoteConfig';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';

// Project Firebase theo tài khoản đang chọn ở thanh ngữ cảnh.
// null = tất cả tài khoản: gộp project trùng (nhiều tài khoản cùng có quyền) — dùng tài khoản đầu tiên thấy project.
export function useRcProjects() {
  const all = useUi((s) => s.accounts);
  const selected = useUi((s) => s.rcAccountId);
  const accounts = useMemo(() => all.filter((a) => a.kind === 'firebase'), [all]);
  const q = useQuery({ queryKey: ['rc', 'projects'], queryFn: () => api.rc.projects(), staleTime: Infinity });
  const accountId = selected && accounts.some((a) => a.id === selected && a.status === 'active') ? selected : null;
  const projects = useMemo(() => {
    const list = q.data ?? [];
    if (accountId) return list.filter((p) => p.accountId === accountId);
    const seen = new Set<string>();
    return list.filter((p) => !seen.has(p.projectId) && seen.add(p.projectId));
  }, [q.data, accountId]);
  const countOf = (id: string) => (q.data ?? []).filter((p: RcProject) => p.accountId === id).length;
  return { accounts, accountId, projects, countOf, isLoading: q.isLoading };
}
