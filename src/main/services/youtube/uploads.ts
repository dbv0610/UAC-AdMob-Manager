import fs from 'node:fs';
import { Notification, net, utilityProcess, type UtilityProcess } from 'electron';
import { and, eq, inArray } from 'drizzle-orm';
import { youtube } from '@googleapis/youtube';
import log from 'electron-log/main';
import uploaderPath from './uploader.worker?modulePath';
import { db } from '../../db';
import { accounts, creatives } from '../../db/schema';
import { broadcast } from '../../events';
import { UserFacingError } from '../../ipc/register';
import { trackJob, type TrackedJob } from '../../jobs/queue';
import { authClientFor, getAccessToken, isInvalidGrant, reauthError } from '../auth/accounts';
import { addUsage, quotaToday } from '../quota';
import { getPrefs, setPrefs } from '../settingsStore';
import { emit, getRows, updateCreatives } from '../creatives/library';
import { mimeOf } from '../creatives/media';
import { getDeveloperToken } from '../auth/clientConfig';
import { customerById } from '../googleAds/client';
import { uploadViaAds } from './adsResumable';
import { UploadError } from './resumable';
import { YT_DAILY_UPLOADS } from '@shared/creative';
import type { AppError, UploaderState } from '@shared/types';
import type { FromWorker, ToWorker } from './protocol';
import { adsUploadPatch, msToNextPtDay, parseTarget, videoStatusPatch, type Target, type VideoLike } from './status';

// Hai đích upload:
//  - 'ads:<customerId>': qua Google Ads API lên kênh YouTube do Google quản lý — không cần tài khoản YouTube
//    hay audit, không tính quota 100 lượt/ngày của YouTube. Chạy ngay trong main (chỉ I/O mạng).
//  - 'youtube:<accountId>': YouTube Data API lên kênh của bạn, chạy trong utilityProcess.
// Hàng đợi upload: 1 video mỗi lúc. Trạng thái nằm trong SQLite (creatives.status),
// nên tắt app giữa chừng thì lần mở sau chạy tiếp từ phiên resumable cũ.

let worker: UtilityProcess | null = null;
let current: { id: string; accountId: string; job: TrackedJob; abort?: AbortController } | null = null;
let waiting: UploaderState['waiting'] = null;
let resumeAt: string | null = null;
let timer: NodeJS.Timeout | null = null;
let finishedInRun = 0;
const crashCount = new Map<string, number>();

const err = (e: AppError) => JSON.stringify(e);

export function uploaderState(): UploaderState {
  const queued = db.select({ id: creatives.id }).from(creatives).where(eq(creatives.status, 'QUEUED')).all().length;
  return { running: current?.id ?? null, queued, waiting, resumeAt, accountId: getPrefs().youtubeAccountId };
}
const emitState = () => broadcast({ type: 'uploader', state: uploaderState() });

function schedule(ms: number, why: UploaderState['waiting']) {
  if (timer) clearTimeout(timer);
  waiting = why;
  resumeAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(() => {
    timer = null;
    waiting = null;
    resumeAt = null;
    pump();
  }, ms);
  emitState();
}

function uploadAccount() {
  const id = getPrefs().youtubeAccountId;
  const acc = id ? db.select().from(accounts).where(eq(accounts.id, id)).get() : undefined;
  return acc?.kind === 'youtube' && acc.status === 'active' ? acc : null;
}

// Tài khoản Google đứng sau một customer Ads (để lấy access token)
function adsAccountFor(customerId: string) {
  try {
    const { row } = customerById(customerId);
    const acc = db.select().from(accounts).where(eq(accounts.id, row.accountId)).get();
    return acc?.status === 'active' ? { accountId: acc.id, loginCustomerId: row.loginCustomerId } : null;
  } catch {
    return null;
  }
}

function ensureWorker() {
  if (worker) return worker;
  const w = utilityProcess.fork(uploaderPath, [], { serviceName: 'YouTube uploader' });
  w.on('message', (m: FromWorker) => void onMessage(m));
  w.on('exit', (code) => {
    worker = null;
    if (!current) return;
    // Worker chết giữa chừng: giữ phiên resumable, xếp lại hàng; chết 3 lần trên cùng video thì báo lỗi
    const n = (crashCount.get(current.id) ?? 0) + 1;
    crashCount.set(current.id, n);
    log.error(`[upload] worker thoát (code ${code}) khi upload ${current.id}, lần ${n}`);
    const e: AppError = { message: 'Tiến trình upload bị dừng đột ngột', action: 'retry', code: `WORKER_EXIT_${code}` };
    if (n >= 3) {
      updateCreatives([current.id], { status: 'FAILED', error: err(e) });
      current.job.fail(e);
    } else updateCreatives([current.id], { status: 'QUEUED' });
    current = null;
    pump();
  });
  worker = w;
  return w;
}

const send = (m: ToWorker) => ensureWorker().postMessage(m);

export function pump() {
  if (current) return;
  const queued = db.select().from(creatives).where(eq(creatives.status, 'QUEUED')).orderBy(creatives.updatedAt).all();
  if (!queued.length) {
    waiting = null;
    resumeAt = null;
    if (finishedInRun > 0 && Notification.isSupported()) {
      new Notification({ title: 'Upload video xong', body: `${finishedInRun} video đã gửi, đang chờ xử lý` }).show();
    }
    finishedInRun = 0;
    emitState();
    return;
  }
  if (!net.isOnline()) return schedule(30_000, 'offline');

  // Lấy video đầu tiên chạy được; video qua YouTube API chờ quota/tài khoản không chặn video qua Google Ads
  let blocked: UploaderState['waiting'] = null;
  const ytQuotaOut = quotaToday().youtubeUploads >= YT_DAILY_UPLOADS;
  for (const row of queued) {
    const t = parseTarget(row.uploadTarget) ?? (uploadAccount() ? { kind: 'youtube' as const, accountId: uploadAccount()!.id } : null);
    if (!t) {
      blocked ??= 'account';
      continue;
    }
    if (t.kind === 'ads') {
      const a = adsAccountFor(t.customerId);
      if (!a) {
        blocked ??= 'account';
        continue;
      }
      void startUpload(row, a.accountId, { ...t, loginCustomerId: a.loginCustomerId });
      return;
    }
    const acc = db.select().from(accounts).where(eq(accounts.id, t.accountId)).get();
    if (acc?.status !== 'active') {
      blocked ??= 'account';
      continue;
    }
    // Hết lượt YouTube hôm nay: giữ QUEUED, không gọi để nhận 403
    if (!row.uploadSession && ytQuotaOut) {
      blocked ??= 'quota';
      continue;
    }
    void startUpload(row, acc.id, t);
    return;
  }
  if (blocked === 'quota') return schedule(msToNextPtDay(), 'quota');
  waiting = blocked;
  emitState();
}

async function startUpload(row: typeof creatives.$inferSelect, accountId: string, target: Target & { loginCustomerId?: string | null }) {
  const job = trackJob('uploadVideos', `Upload ${row.name || 'video'}`, { creativeId: row.id });
  current = { id: row.id, accountId, job };
  waiting = null;
  emitState();
  const failNow = (e: AppError) => {
    updateCreatives([row.id], { status: 'FAILED', error: err(e) });
    job.fail(e);
    current = null;
    pump();
  };
  if (!row.path || !fs.existsSync(row.path)) {
    return failNow({ message: `Không thấy file gốc: ${row.path || '(trống)'} — file đã bị di chuyển? Nhập lại thư mục để cập nhật đường dẫn`, action: 'fix', code: 'FILE_MISSING' });
  }
  let token: string;
  try {
    token = await getAccessToken(accountId);
  } catch (e) {
    const info = e instanceof UserFacingError ? e.info : { message: (e as Error).message, action: 'retry' as const };
    // Cần đăng nhập lại: cả hàng đợi dừng, không đánh lỗi từng video
    updateCreatives([row.id], { status: 'QUEUED' });
    job.fail(info);
    current = null;
    waiting = 'account';
    return emitState();
  }
  updateCreatives([row.id], { status: 'UPLOADING', error: null });
  if (target.kind === 'ads') return runAdsUpload(row, target.customerId, target.loginCustomerId ?? null, token);
  if (!row.uploadSession) addUsage('youtube.insert', 1); // mỗi videos.insert mới tính 1 lượt
  send({
    type: 'start',
    id: row.id,
    filePath: row.path,
    size: fs.statSync(row.path).size,
    mime: mimeOf(row.path),
    title: row.name || 'Video',
    session: row.uploadSession,
    accessToken: token,
  });
}

// Upload qua Google Ads chạy trong main: phát cùng loại tin nhắn như worker để dùng chung onMessage
async function runAdsUpload(row: typeof creatives.$inferSelect, customerId: string, loginCustomerId: string | null, token: string) {
  const id = row.id;
  const abort = new AbortController();
  if (current) current.abort = abort;
  const developerToken = getDeveloperToken();
  const size = fs.statSync(row.path).size;
  const fh = await fs.promises.open(row.path, 'r');
  let lastPct = -1;
  try {
    const out = await uploadViaAds(
      {
        customerId,
        loginCustomerId,
        developerToken,
        size,
        mime: mimeOf(row.path),
        title: row.name || 'Video',
        session: row.uploadSession,
        onSession: (url) => void onMessage({ type: 'session', id, url }),
        onProgress: (sent) => {
          const pct = Math.floor((sent / size) * 100);
          if (pct !== lastPct) void onMessage({ type: 'progress', id, sent, size });
          lastPct = pct;
        },
      },
      {
        fetch,
        readChunk: async (s, e) => {
          const buf = Buffer.alloc(e - s);
          await fh.read(buf, 0, e - s, s);
          return buf;
        },
        getToken: () => token,
        refreshToken: async () => (token = await getAccessToken(current?.accountId ?? '')),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        signal: abort.signal,
      },
    );
    addUsage('ads.operations', 1);
    await onMessage({ type: 'adsDone', id, resourceName: out.resourceName });
  } catch (e) {
    if (abort.signal.aborted) await onMessage({ type: 'aborted', id });
    else {
      const u = e instanceof UploadError ? e : new UploadError((e as Error)?.message ?? String(e), null);
      await onMessage({ type: 'error', id, status: u.status, reason: u.reason, message: u.message, sessionGone: u.sessionGone });
    }
  } finally {
    await fh.close();
  }
}

const abortCurrent = () => {
  if (!current) return;
  if (current.abort) current.abort.abort();
  else send({ type: 'abort', id: current.id });
};

async function onMessage(m: FromWorker) {
  if (!current || m.id !== current.id) return;
  const { id, job } = current;
  switch (m.type) {
    case 'session':
      db.update(creatives).set({ uploadSession: m.url }).where(eq(creatives.id, id)).run();
      break;
    case 'progress':
      job.progress(Math.round((m.sent / m.size) * 100), 100, '%');
      broadcast({ type: 'uploadProgress', id, pct: Math.round((m.sent / m.size) * 100) });
      break;
    case 'needToken':
      try {
        send({ type: 'token', id, accessToken: await getAccessToken(current.accountId) });
      } catch {
        send({ type: 'abort', id });
      }
      break;
    case 'done': {
      // Yêu cầu unlisted mà nhận private → YouTube khóa (project chưa qua audit)
      const locked = m.privacy === 'private';
      updateCreatives([id], {
        youtubeId: m.videoId,
        privacy: m.privacy,
        uploadSession: null,
        status: locked ? 'LOCKED' : 'PROCESSING',
        error: locked ? err({ message: 'YouTube ép video về Private — project cần qua YouTube API Audit, hoặc upload tay rồi nhập ID', code: 'LOCKED_PRIVATE', action: 'fix' }) : null,
      });
      job.done();
      crashCount.delete(id);
      finishedInRun++;
      current = null;
      startPolling();
      pump();
      break;
    }
    case 'adsDone':
      updateCreatives([id], { adsUpload: m.resourceName, uploadSession: null, status: 'PROCESSING', error: null });
      job.done();
      finishedInRun++;
      current = null;
      startPolling();
      pump();
      break;
    case 'aborted':
      // Tạm dừng / hủy: trạng thái đã được pauseUploads/cancelUploads ghi trước khi abort
      job.paused();
      current = null;
      pump();
      break;
    case 'error': {
      const quota = m.reason === 'quotaExceeded' || m.reason === 'uploadLimitExceeded' || m.reason === 'rateLimitExceeded';
      if (quota) {
        // Google báo hết quota sớm hơn bộ đếm của app: đồng bộ bộ đếm, chờ ngày mới
        addUsage('youtube.insert', Math.max(0, YT_DAILY_UPLOADS - quotaToday().youtubeUploads));
        updateCreatives([id], { status: 'QUEUED', uploadSession: null });
        job.fail({ message: 'Hết quota upload YouTube hôm nay — sẽ tự chạy lại sau 0h giờ PT', code: m.reason!, action: 'retry' });
        current = null;
        return schedule(msToNextPtDay(), 'quota');
      }
      if (m.status === 401) {
        updateCreatives([id], { status: 'QUEUED' });
        job.fail({ message: 'Access token bị từ chối', code: 'HTTP_401', action: 'reauth' });
        current = null;
        waiting = 'account';
        return emitState();
      }
      const e: AppError = {
        message: m.sessionGone ? 'Phiên upload đã hết hạn — bấm Thử lại để upload lại từ đầu' : m.message,
        code: m.reason ?? (m.status ? `HTTP_${m.status}` : 'NETWORK'),
        action: 'retry',
      };
      updateCreatives([id], { status: 'FAILED', error: err(e), ...(m.sessionGone ? { uploadSession: null } : {}) });
      job.fail(e);
      current = null;
      pump();
      break;
    }
  }
}

// ── API cho IPC ─────────────────────────────────────────────────────────────
export type UploadDest = { kind: 'ads'; customerId: string } | { kind: 'youtube'; accountId: string };

export function requestUpload(ids: string[], dest: UploadDest) {
  let target: string;
  if (dest.kind === 'ads') {
    if (!adsAccountFor(dest.customerId)) {
      throw new UserFacingError({ message: 'Tài khoản Google Ads này chưa đăng nhập hoặc cần đăng nhập lại', action: 'openSettings', code: 'NO_ADS_ACCOUNT' });
    }
    setPrefs({ uploadVia: 'ads', uploadCustomerId: dest.customerId });
    target = `ads:${dest.customerId}`;
  } else {
    const acc = db.select().from(accounts).where(eq(accounts.id, dest.accountId)).get();
    if (acc?.kind !== 'youtube') throw new UserFacingError({ message: 'Chọn tài khoản YouTube để upload', action: 'openSettings', code: 'NO_YT_ACCOUNT' });
    if (acc.status === 'reauth') throw reauthError(dest.accountId);
    setPrefs({ uploadVia: 'youtube', youtubeAccountId: dest.accountId });
    target = `youtube:${dest.accountId}`;
  }
  const rows = getRows(ids).filter((r) => r.kind === 'video' && r.source === 'file' && ['LOCAL', 'FAILED', 'PAUSED'].includes(r.status));
  // Thứ tự xếp hàng theo thứ tự người dùng chọn; đổi đích thì bỏ phiên resumable cũ
  const now = Date.now();
  db.transaction((tx) => {
    rows.forEach((r, i) =>
      tx.update(creatives)
        .set({ status: 'QUEUED', error: null, uploadTarget: target, ...(r.uploadTarget !== target ? { uploadSession: null } : {}), updatedAt: new Date(now + i).toISOString() })
        .where(eq(creatives.id, r.id))
        .run(),
    );
  });
  emit(rows.map((r) => r.id));
  if (waiting === 'account') waiting = null;
  pump();
  emitState();
  return { queued: rows.length };
}

export function pauseUploads(ids: string[]) {
  const rows = getRows(ids).filter((r) => r.status === 'QUEUED' || r.status === 'UPLOADING');
  updateCreatives(rows.map((r) => r.id), { status: 'PAUSED' });
  if (current && ids.includes(current.id)) abortCurrent();
  emitState();
}

// Hủy: bỏ phiên resumable, về LOCAL (YouTube chỉ tạo video khi nhận đủ file)
export function cancelUploads(ids: string[]) {
  const rows = getRows(ids).filter((r) => ['QUEUED', 'UPLOADING', 'PAUSED', 'FAILED'].includes(r.status));
  updateCreatives(rows.map((r) => r.id), { status: 'LOCAL', uploadSession: null, error: null });
  if (current && ids.includes(current.id)) abortCurrent();
  emitState();
}

// ── Poll trạng thái xử lý (mỗi 60 giây khi còn video PROCESSING) ───────────
let poller: NodeJS.Timeout | null = null;

export function startPolling() {
  if (poller) return;
  poller = setInterval(() => void pollProcessing(), 60_000);
  setTimeout(() => void pollProcessing(), 5_000);
}

function readAccount() {
  return uploadAccount() ?? db.select().from(accounts).where(and(eq(accounts.kind, 'youtube'), eq(accounts.status, 'active'))).get() ?? null;
}

export async function pollProcessing() {
  const all = db.select().from(creatives).where(eq(creatives.status, 'PROCESSING')).all();
  if (!all.length) {
    if (poller) clearInterval(poller);
    poller = null;
    return;
  }
  if (!net.isOnline()) return;
  await pollAdsUploads(all.filter((r) => r.adsUpload));
  const rows = all.filter((r) => !r.adsUpload && r.youtubeId);
  const acc = readAccount();
  if (!rows.length || !acc) return;
  const api = youtube({ version: 'v3', auth: authClientFor(acc.id) as never });
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    try {
      const res = await api.videos.list({ part: ['status', 'processingDetails'], id: batch.map((r) => r.youtubeId!), maxResults: 50 });
      const found = new Map((res.data.items ?? []).map((v) => [v.id!, v]));
      for (const r of batch) applyVideoStatus(r, found.get(r.youtubeId!));
    } catch (e) {
      if (isInvalidGrant(e)) {
        reauthError(acc.id);
        return;
      }
      log.warn('[upload] poll videos.list lỗi', (e as Error).message);
    }
  }
}

// Video upload qua Google Ads: đọc you_tube_video_upload theo từng customer
async function pollAdsUploads(rows: (typeof creatives.$inferSelect)[]) {
  const byCustomer = new Map<string, typeof rows>();
  for (const r of rows) {
    const t = parseTarget(r.uploadTarget);
    if (t?.kind === 'ads') byCustomer.set(t.customerId, [...(byCustomer.get(t.customerId) ?? []), r]);
  }
  for (const [cid, list] of byCustomer) {
    try {
      const { customer } = customerById(cid);
      const res = await customer.query(`
        SELECT you_tube_video_upload.resource_name, you_tube_video_upload.video_id, you_tube_video_upload.state
        FROM you_tube_video_upload
        WHERE you_tube_video_upload.resource_name IN (${list.map((r) => `'${r.adsUpload}'`).join(',')})`);
      const found = new Map(
        res.map((x) => {
          const u = (x as { you_tube_video_upload?: { resource_name?: string; video_id?: string; state?: number | string } }).you_tube_video_upload ?? {};
          return [u.resource_name, u] as const;
        }),
      );
      for (const r of list) {
        const u = found.get(r.adsUpload!);
        const patch = u ? adsUploadPatch(u.state, u.video_id) : null;
        if (patch) updateCreatives([r.id], patch);
      }
    } catch (e) {
      log.warn(`[upload] poll youTubeVideoUploads ${cid} lỗi`, (e as Error).message);
    }
  }
}

function applyVideoStatus(r: typeof creatives.$inferSelect, v: VideoLike | undefined) {
  const patch = videoStatusPatch(v);
  if (patch) updateCreatives([r.id], patch);
}

// Mở app: video đang upload khi tắt → xếp hàng lại (giữ phiên), tiếp tục poll video đang xử lý
export function resumeUploadsOnStart() {
  db.update(creatives).set({ status: 'QUEUED' }).where(inArray(creatives.status, ['UPLOADING'])).run();
  startPolling();
  setTimeout(pump, 3_000);
}

export function stopUploader() {
  if (timer) clearTimeout(timer);
  if (poller) clearInterval(poller);
  worker?.kill();
}
