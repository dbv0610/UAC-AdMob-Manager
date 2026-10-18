import { and, between, inArray } from 'drizzle-orm';
import log from 'electron-log/main';
import { admob } from '@googleapis/admob';
import { db } from '../../db';
import { revenueDaily, revenueUnitDaily, revenueUnitSourceDaily } from '../../db/schema';
import { authClientFor, isInvalidGrant, reauthError } from '../auth/accounts';
import { listAdmobPublishers } from '../directory';
import { UserFacingError } from '../../ipc/register';
import { apiDisabledError } from '../googleAds/client';
import { parseMediation, parseUnitSources, parseUnits, publisherOf, type ReportChunk } from './parse';

const ymd = (d: string) => {
  const [year, month, day] = d.split('-').map(Number);
  return { year, month, day };
};

// Doanh thu AdMob theo (ngày, app, quốc gia, format, nguồn quảng cáo) — mediation report.
// SHOW_RATE chỉ có ở network report: show rate tự tính = impressions / matched requests.
export async function syncRevenue(admobAppIds: string[], from: string, to: string, currency: string) {
  const byPub = new Map<string, string[]>();
  for (const id of admobAppIds) {
    const pub = publisherOf(id);
    if (!pub) throw new UserFacingError({ message: `AdMob app ID không hợp lệ: ${id}`, action: 'openSettings', code: 'BAD_ADMOB_APP_ID' });
    byPub.set(pub, [...(byPub.get(pub) ?? []), id]);
  }
  const publishers = listAdmobPublishers();
  let total = 0;
  const warnings: string[] = [];

  for (const [pub, apps] of byPub) {
    const p = publishers.find((x) => x.publisherId === pub);
    if (!p) {
      throw new UserFacingError({ message: `Chưa đăng nhập tài khoản AdMob có publisher ${pub}`, action: 'openSettings', code: 'NO_ADMOB_ACCOUNT' });
    }
    const api = admob({ version: 'v1', auth: authClientFor(p.accountId) as never });
    let data: ReportChunk[];
    try {
      const res = await api.accounts.mediationReport.generate({
        parent: `accounts/${pub}`,
        requestBody: {
          reportSpec: {
            dateRange: { startDate: ymd(from), endDate: ymd(to) },
            dimensions: ['DATE', 'APP', 'COUNTRY', 'FORMAT', 'AD_SOURCE'],
            metrics: ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'CLICKS', 'AD_REQUESTS', 'MATCHED_REQUESTS'],
            dimensionFilters: [{ dimension: 'APP', matchesAny: { values: apps } }],
            // Cùng tiền tệ với tài khoản Ads để cộng/chia được (AdMob tự quy đổi)
            localizationSettings: { currencyCode: currency, languageCode: 'en-US' },
          },
        },
      });
      data = res.data as unknown as ReportChunk[];
    } catch (err) {
      if (isInvalidGrant(err)) throw reauthError(p.accountId);
      const disabled = apiDisabledError(err);
      if (disabled) throw disabled;
      const e = err as { response?: { data?: { error?: { message?: string; status?: string } } }; message?: string };
      throw new UserFacingError({ message: `AdMob: ${e.response?.data?.error?.message ?? e.message}`, code: e.response?.data?.error?.status, action: 'retry' });
    }
    const parsed = parseMediation(data, currency);
    warnings.push(...parsed.warnings);
    db.transaction((tx) => {
      tx.delete(revenueDaily).where(and(inArray(revenueDaily.admobAppId, apps), between(revenueDaily.date, from, to))).run();
      for (const r of parsed.rows) {
        tx.insert(revenueDaily)
          .values(r)
          .onConflictDoUpdate({ target: [revenueDaily.date, revenueDaily.admobAppId, revenueDaily.country, revenueDaily.format, revenueDaily.adSource], set: r })
          .run();
      }
    });
    total += parsed.rows.length;

    // Báo cáo phụ theo ad unit — request riêng (thêm AD_UNIT vào báo cáo chính sẽ nhân số dòng). Lỗi thì chỉ cảnh báo.
    const extra = async (dimensions: string[]) => {
      const res = await api.accounts.mediationReport.generate({
        parent: `accounts/${pub}`,
        requestBody: {
          reportSpec: {
            dateRange: { startDate: ymd(from), endDate: ymd(to) },
            dimensions,
            metrics: ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'CLICKS', 'AD_REQUESTS', 'MATCHED_REQUESTS'],
            dimensionFilters: [{ dimension: 'APP', matchesAny: { values: apps } }],
            localizationSettings: { currencyCode: currency, languageCode: 'en-US' },
          },
        },
      });
      return res.data as unknown as ReportChunk[];
    };
    try {
      const units = parseUnits(await extra(['DATE', 'APP', 'AD_UNIT', 'COUNTRY', 'FORMAT']), currency);
      db.transaction((tx) => {
        tx.delete(revenueUnitDaily).where(and(inArray(revenueUnitDaily.admobAppId, apps), between(revenueUnitDaily.date, from, to))).run();
        for (const r of units) {
          tx.insert(revenueUnitDaily).values(r).onConflictDoUpdate({ target: [revenueUnitDaily.date, revenueUnitDaily.adUnitId, revenueUnitDaily.country], set: r }).run();
        }
      });
      // Unit × nguồn mediation: không tách nước để giữ bảng nhỏ
      const bySource = parseUnitSources(await extra(['DATE', 'APP', 'AD_UNIT', 'AD_SOURCE']), currency);
      db.transaction((tx) => {
        tx.delete(revenueUnitSourceDaily).where(and(inArray(revenueUnitSourceDaily.admobAppId, apps), between(revenueUnitSourceDaily.date, from, to))).run();
        for (const r of bySource) {
          tx.insert(revenueUnitSourceDaily)
            .values(r)
            .onConflictDoUpdate({ target: [revenueUnitSourceDaily.date, revenueUnitSourceDaily.adUnitId, revenueUnitSourceDaily.adSource], set: r })
            .run();
        }
      });
    } catch (err) {
      log.warn('[reports] báo cáo ad unit lỗi', err);
      warnings.push(`Báo cáo ad unit lỗi: ${(err as Error).message}`);
    }
  }
  return { rows: total, warnings };
}
