import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanDraft, PlanRecord } from '@shared/plan';
import { api } from '@/lib/api';
import { getState } from '@/lib/store';

export function blankDraft(): PlanDraft {
  const p = getState().prefs;
  return {
    id: crypto.randomUUID(),
    appId: p?.currentAppId ?? null,
    customerId: p?.currentAdsCustomerId ?? null,
    rows: [],
    step: 0,
    updatedAt: new Date().toISOString(),
  };
}

// Nhân bản kế hoạch cũ: giữ cấu hình, id mới, vào thẳng bước Cấu hình
export const draftFromRecord = (r: PlanRecord): PlanDraft => ({
  id: crypto.randomUUID(),
  appId: r.appId,
  customerId: r.customerId,
  rows: structuredClone(r.rows),
  step: 2,
  updatedAt: new Date().toISOString(),
});

// Bản nháp wizard lưu xuống SQLite sau mỗi thay đổi (debounce), mở lại app vẫn còn.
export function usePlanDraft() {
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    void api.plans.getDraft().then((d) => {
      loaded.current = true;
      setDraft(d ?? blankDraft());
    });
  }, []);

  useEffect(() => {
    if (!draft || !loaded.current) return;
    const h = setTimeout(() => void api.plans.saveDraft(draft), 400);
    return () => clearTimeout(h);
  }, [draft]);

  const update = useCallback((fn: (d: PlanDraft) => Partial<PlanDraft>) => {
    setDraft((d) => (d ? { ...d, ...fn(d), updatedAt: new Date().toISOString() } : d));
  }, []);

  const reset = useCallback(() => setDraft(blankDraft()), []);
  return { draft, update, reset };
}
