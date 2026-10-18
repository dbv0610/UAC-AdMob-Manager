import { Plus } from 'lucide-react';
import { setState, useUi, type CampaignsTab } from '@/lib/store';
import { Button, PageHeader, cx } from '@/components/ui';
import { CampaignList } from './CampaignList';
import { PlanWizard } from './PlanWizard';
import { PlanHistory } from './PlanHistory';

const TABS: { id: CampaignsTab; label: string }[] = [
  { id: 'list', label: 'Danh sách' },
  { id: 'new', label: 'Tạo kế hoạch' },
  { id: 'history', label: 'Lịch sử kế hoạch' },
];

export function Campaigns() {
  const tab = useUi((s) => s.campaignsTab);
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col">
      <PageHeader title="Campaigns">
        {tab !== 'new' && (
          <Button variant="primary" icon={Plus} onClick={() => setState({ campaignsTab: 'new' })} title="Ctrl/⌘ N">
            Kế hoạch mới
          </Button>
        )}
      </PageHeader>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setState({ campaignsTab: t.id })}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-text')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'list' && <CampaignList />}
      {tab === 'new' && <PlanWizard />}
      {tab === 'history' && <PlanHistory />}
    </div>
  );
}
