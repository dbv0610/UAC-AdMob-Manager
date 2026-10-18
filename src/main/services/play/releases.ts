import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { UserFacingError } from '../../ipc/register';
import { assertOnline } from '../googleAds/client';
import { withEdit } from './client';
import { TRACK_ORDER, applyReleaseAction, releaseKey, type PlayTrack, type ReleaseStatus, type UpdateReleaseRequest } from '@shared/playOps';

// Release theo track (production / beta / alpha / internal / kênh kín tự đặt) qua edits.tracks.

const toTrack = (t: androidpublisher_v3.Schema$Track): PlayTrack => ({
  track: t.track ?? '',
  releases: (t.releases ?? []).map((r) => ({
    key: releaseKey(r),
    name: r.name ?? '',
    versionCodes: r.versionCodes ?? [],
    status: (r.status ?? 'draft') as ReleaseStatus,
    userFraction: r.userFraction ?? null,
    notesLanguages: (r.releaseNotes ?? []).map((n) => n.language ?? '').filter(Boolean),
  })),
});

const rank = (t: string) => (TRACK_ORDER.includes(t) ? TRACK_ORDER.indexOf(t) : TRACK_ORDER.length);

export function listTracks(accountId: string, packageName: string): Promise<PlayTrack[]> {
  return withEdit(
    accountId,
    packageName,
    async (api, editId) => {
      const res = await api.edits.tracks.list({ packageName, editId });
      return (res.data.tracks ?? []).map(toTrack).sort((a, b) => rank(a.track) - rank(b.track) || a.track.localeCompare(b.track));
    },
    'release',
  );
}

export async function updateRelease(req: UpdateReleaseRequest, actor = 'user'): Promise<PlayTrack> {
  assertOnline();
  const { accountId, packageName, track, key, action } = req;
  return withEdit(
    accountId,
    packageName,
    async (api, editId, commit) => {
      // Đọc lại track trong chính edit này: quyết định dựa trên trạng thái mới nhất, không tin dữ liệu cũ trên màn
      const cur = (await api.edits.tracks.get({ packageName, editId, track })).data;
      const before = (cur.releases ?? []).find((r) => releaseKey(r) === key);
      const r = applyReleaseAction(cur.releases ?? [], key, action);
      if ('error' in r) throw new UserFacingError({ message: r.error, code: 'BAD_RELEASE_ACTION', action: 'fix' });
      const res = await api.edits.tracks.update({ packageName, editId, track, requestBody: { track, releases: r.releases } });
      await api.edits.validate({ packageName, editId });
      await api.edits.commit({ packageName, editId });
      commit();
      const after = (res.data.releases ?? []).find((x) => releaseKey(x) === key);
      db.insert(auditLog)
        .values({
          actor,
          entity: 'play.release',
          entityId: `${packageName}/${track}/${key}`,
          before: JSON.stringify({ status: before?.status, userFraction: before?.userFraction ?? null }),
          after: JSON.stringify({ status: after?.status, userFraction: after?.userFraction ?? null }),
        })
        .run();
      return toTrack(res.data);
    },
    'release',
  );
}
