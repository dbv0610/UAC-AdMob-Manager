import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles/index.css';
import { App } from './App';
import { api } from './lib/api';
import { navigate, setState, upsertJob } from './lib/store';
import { applyPrefsToDom } from './lib/prefs';
import { qk, queryClient } from './lib/queries';
import { runCommand } from './lib/commands';
import type { NavPath } from '@shared/nav';
import type { PlanRecord } from '@shared/plan';
import type { Creative } from '@shared/creative';

async function boot() {
  const [prefs, info, accounts, jobs, quota, uploader, reportSync, pendingSuggestions, updateVersion] = await Promise.all([
    api.prefs.get(),
    api.app.info(),
    api.auth.listAccounts(),
    api.jobs.list(),
    api.quota.today(),
    api.creatives.uploaderState(),
    api.analytics.syncStatus(),
    api.rules.pendingCount(),
    api.app.updateReady(),
  ]);
  applyPrefsToDom(prefs);
  setState({ prefs, info, accounts, jobs, quota, uploader, reportSync, pendingSuggestions, updateVersion, online: info.online, route: prefs.onboardingDone ? '/campaigns' : '/onboarding' });

  api.events.on((e) => {
    switch (e.type) {
      case 'job':
        upsertJob(e.job);
        // Đọc danh mục xong thì làm mới cache customer/publisher/kênh
        if (e.job.kind === 'syncDirectory' && e.job.state === 'done') {
          void queryClient.invalidateQueries({ queryKey: ['directory'] });
          void queryClient.invalidateQueries({ queryKey: ['rc', 'projects'] }); // danh mục project Firebase
        }
        if (e.job.kind === 'createCampaigns' && (e.job.state === 'done' || e.job.state === 'failed')) {
          void queryClient.invalidateQueries({ queryKey: ['ads', 'campaigns'] });
          void queryClient.invalidateQueries({ queryKey: qk.creatives }); // asset video mới → "Đã gắn"
        }
        break;
      case 'accounts':
        setState({ accounts: e.accounts });
        void queryClient.invalidateQueries({ queryKey: qk.adsCustomers });
        break;
      case 'quota':
        setState({ quota: e.quota });
        break;
      case 'plan':
        queryClient.setQueryData(qk.plans, (old: PlanRecord[] | undefined) =>
          old ? [e.plan, ...old.filter((p) => p.id !== e.plan.id)] : old,
        );
        queryClient.setQueryData(['plan', e.plan.id], e.plan);
        break;
      case 'creatives': {
        const byId = new Map(e.creatives.map((c) => [c.id, c]));
        queryClient.setQueryData(qk.creatives, (old: Creative[] | undefined) =>
          old ? [...e.creatives.filter((c) => !old.some((o) => o.id === c.id)), ...old.map((o) => byId.get(o.id) ?? o)] : old,
        );
        // Upload xong / dừng: bỏ % tạm
        setState((st) => {
          const pct = { ...st.uploadPct };
          for (const c of e.creatives) if (c.status !== 'UPLOADING') delete pct[c.id];
          return { uploadPct: pct };
        });
        break;
      }
      case 'creativesRemoved':
        queryClient.setQueryData(qk.creatives, (old: Creative[] | undefined) => old?.filter((c) => !e.ids.includes(c.id)));
        break;
      case 'uploadProgress':
        setState((st) => ({ uploadPct: { ...st.uploadPct, [e.id]: e.pct } }));
        break;
      case 'reportSync':
        setState({ reportSync: e.status });
        void queryClient.invalidateQueries({ queryKey: ['analytics'] });
        break;
      case 'update':
        setState({ updateVersion: e.version });
        break;
      case 'suggestions':
        setState({ pendingSuggestions: e.pending });
        void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
        void queryClient.invalidateQueries({ queryKey: ['rules'] });
        break;
      case 'uploader':
        setState({ uploader: e.state });
        break;
      case 'online':
        setState({ online: e.online });
        break;
      case 'navigate':
        navigate(e.to as NavPath);
        break;
      case 'command':
        runCommand(e.name);
        break;
    }
  });

  // Thả file ra ngoài vùng nhập: chặn trình duyệt mở file (điều hướng sang file://)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setState({ paletteOpen: false });
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
