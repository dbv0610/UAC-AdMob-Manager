import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { quotaUsage } from '../db/schema';
import { broadcast } from '../events';
import type { QuotaToday } from '@shared/types';

// Quota Google tính theo ngày giờ Thái Bình Dương.
export const ptDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

type Api = 'ads.operations' | 'youtube.insert';

export function addUsage(api: Api, n: number) {
  if (n <= 0) return;
  const day = ptDay();
  db.insert(quotaUsage)
    .values({ day, api, used: n })
    .onConflictDoUpdate({ target: [quotaUsage.day, quotaUsage.api], set: { used: sql`${quotaUsage.used} + ${n}` } })
    .run();
  broadcast({ type: 'quota', quota: quotaToday() });
}

const used = (api: Api) =>
  db.select().from(quotaUsage).where(and(eq(quotaUsage.day, ptDay()), eq(quotaUsage.api, api))).get()?.used ?? 0;

export const quotaToday = (): QuotaToday => ({ adsOperations: used('ads.operations'), youtubeUploads: used('youtube.insert') });
