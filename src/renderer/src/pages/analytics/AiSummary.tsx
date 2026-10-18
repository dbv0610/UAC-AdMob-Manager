import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw, Settings2, Sparkles } from 'lucide-react';
import type { AnalyticsRange } from '@shared/analytics';
import { api } from '@/lib/api';
import { navigate, useUi } from '@/lib/store';
import { useSecrets } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Banner, Button, Skeleton } from '@/components/ui';
import { Drawer } from '@/components/drawer';
import { useErrorHandler } from '@/components/connect';

// Claude đọc số đã gộp của kỳ đang xem và viết: Tổng quan / Vấn đề / Nên làm.

const HEAD_TONE: Record<string, string> = { 'Tổng quan': 'text-accent', 'Vấn đề': 'text-danger', 'Nên làm': 'text-success' };

export function AiSummaryDrawer({ appId, range, onClose }: { appId: string | null; range: AnalyticsRange; onClose: () => void }) {
  const qc = useQueryClient();
  const online = useUi((s) => s.online);
  const secrets = useSecrets();
  const onError = useErrorHandler();
  const key = ['aiSummary', appId, range];
  const cached = useQuery({ queryKey: key, queryFn: () => api.ai.summaryCached(appId, range) });
  const [busy, setBusy] = useState(false);
  const run = async (refresh: boolean) => {
    setBusy(true);
    try {
      qc.setQueryData(key, await api.ai.summary(appId, range, refresh));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const s = cached.data;
  const noKey = secrets.data && !secrets.data.aiKey;

  return (
    <Drawer width="w-[560px]" title="Tóm tắt AI"
      leading={<span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent"><Sparkles className="size-5" aria-hidden /></span>}
      subtitle={s ? <span>Kỳ {s.from} → {s.to} · tạo lúc {fmtDateTime(s.at)}</span> : <span>Claude đọc số đã đồng bộ và gợi ý việc nên làm</span>}
      actions={s && <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy} disabled={!online} onClick={() => void run(true)} title="Tạo lại">Tạo lại</Button>}
      onClose={onClose}>
      {noKey ? (
        <Banner tone="warning" action={<Button size="sm" icon={Settings2} onClick={() => { onClose(); navigate('/settings'); }}>Cài đặt → AI</Button>}>Cần API key Claude để dùng tóm tắt AI.</Banner>
      ) : busy && !s ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-16" /><Skeleton className="h-5 w-24" /><Skeleton className="h-16" /><Skeleton className="h-5 w-24" /><Skeleton className="h-16" /></div>
      ) : !s ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Sparkles className="size-8 text-accent" aria-hidden />
          <p className="max-w-sm text-sm text-muted">Gửi số liệu đã gộp của kỳ đang xem (KPI, top quốc gia, ad unit, cảnh báo, thay đổi gần đây — không có email hay ID tài khoản) cho Claude để nhận tóm tắt và gợi ý.</p>
          <Button variant="primary" icon={Sparkles} loading={busy} disabled={!online} onClick={() => void run(false)}>Tạo tóm tắt</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1" data-selectable>
          {s.text.split('\n').map((line, i) => {
            const t = line.trim();
            if (!t) return null;
            const head = t.replace(/[:#*]/g, '').trim();
            if (!t.startsWith('-') && !t.startsWith('•') && head.length < 40) {
              return <h3 key={i} className={`mt-3 text-sm font-semibold first:mt-0 ${HEAD_TONE[head] ?? ''}`}>{head}</h3>;
            }
            return (
              <p key={i} className="flex gap-2 text-sm leading-relaxed">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
                <span>{t.replace(/^[-•]\s*/, '').replace(/\*\*/g, '')}</span>
              </p>
            );
          })}
          <p className="mt-4 text-xs text-muted">AI có thể sai — kiểm tra số trên bảng trước khi đổi ngân sách. Bản tóm tắt được lưu 6 giờ; bấm Tạo lại để cập nhật.</p>
        </div>
      )}
    </Drawer>
  );
}
