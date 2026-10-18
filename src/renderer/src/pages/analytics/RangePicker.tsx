import { useState } from 'react';
import { CalendarDays, Check, History } from 'lucide-react';
import { ANALYTICS_PRESETS, MAX_RANGE_DAYS, MAX_SYNC_DAYS, PRESET_LABEL, RANGE_DAYS, daysBetween, isoDate, resolveRange, type AnalyticsPreset, type AnalyticsRange } from '@shared/analytics';
import type { RangePreset } from '@shared/types';
import { api } from '@/lib/api';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';
import { setState, useUi } from '@/lib/store';
import { updatePrefs } from '@/lib/prefs';
import { Button, Input, Select } from '@/components/ui';

// Kỳ hiệu lực của Analytics: kỳ riêng nếu đã chọn, không thì theo thanh ngữ cảnh
export function useAnalyticsRange(): AnalyticsRange {
  const own = useUi((s) => s.analyticsRange);
  const global = useUi((s) => s.prefs?.range ?? 'last7');
  return own ?? global;
}

export function setAnalyticsRange(r: AnalyticsRange) {
  setState({ analyticsRange: r });
  // 7/14/30 ngày và “từ trước đến nay” dùng chung với màn Camp
  if (typeof r === 'string' && (r in RANGE_DAYS || r === 'all')) void updatePrefs({ range: r as RangePreset });
}

const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const fmtFull = (d: string) => `${fmtDay(d)}/${d.slice(0, 4)}`;

export function RangePicker() {
  const range = useAnalyticsRange();
  const earliest = useUi((s) => s.reportSync?.earliest ?? null);
  const online = useUi((s) => s.online);
  const resolved = resolveRange(range, undefined, earliest);
  const onError = useErrorHandler();
  // “Từ trước đến nay” chỉ gồm dữ liệu đã đồng bộ về máy: cho đồng bộ thêm tới 3 năm
  const syncAll = async () => {
    try {
      await api.analytics.sync(MAX_SYNC_DAYS);
      toast({ tone: 'info', title: 'Đang đồng bộ toàn bộ lịch sử (tối đa 3 năm)', detail: 'Có thể mất vài phút — xem tiến trình ở hàng đợi job' });
    } catch (err) {
      onError(err);
    }
  };
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const today = isoDate(new Date());
  const value = typeof range === 'string' ? range : 'custom';
  const bad = custom && (custom.from > custom.to || daysBetween(custom.from, custom.to) > MAX_RANGE_DAYS || custom.to > today);

  return (
    <div className="flex items-center gap-1.5">
      <CalendarDays className="size-4 text-muted" aria-hidden />
      <Select className="w-40" aria-label="Kỳ báo cáo" value={custom ? 'custom' : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') setCustom({ from: resolved.from, to: resolved.to });
          else {
            setCustom(null);
            setAnalyticsRange(v as AnalyticsPreset);
          }
        }}>
        {ANALYTICS_PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABEL[p]}</option>)}
        <option value="custom">Tự chọn…</option>
      </Select>
      {custom ? (
        <>
          <Input type="date" className="w-36" aria-label="Từ ngày" max={today} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span className="text-muted">→</span>
          <Input type="date" className="w-36" aria-label="Đến ngày" max={today} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          <Button size="sm" variant="primary" icon={Check} disabled={!custom.from || !custom.to || !!bad}
            title={bad ? `Từ ≤ đến, tối đa ${MAX_RANGE_DAYS} ngày, không quá hôm nay` : undefined}
            onClick={() => { setAnalyticsRange(custom); setCustom(null); }}>Áp dụng</Button>
        </>
      ) : range === 'all' ? (
        <>
          <span className="num text-xs text-muted" title="Từ ngày đầu tiên có số liệu đã đồng bộ về máy">
            {earliest ? `${fmtFull(resolved.from)} – ${fmtDay(resolved.to)}` : 'chưa có dữ liệu'}
          </span>
          <Button size="sm" variant="ghost" icon={History} disabled={!online} onClick={syncAll} title="Kéo số liệu Google Ads + AdMob tối đa 3 năm về máy">Đồng bộ toàn bộ lịch sử</Button>
        </>
      ) : (
        <span className="num text-xs text-muted" title={`So với kỳ trước: ${resolved.prevFrom} → ${resolved.prevTo}`}>
          {resolved.from === resolved.to ? fmtDay(resolved.from) : `${fmtDay(resolved.from)} – ${fmtDay(resolved.to)}`}
        </span>
      )}
    </div>
  );
}
