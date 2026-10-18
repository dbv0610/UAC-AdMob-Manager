import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { eq, inArray } from 'drizzle-orm';
import log from 'electron-log/main';
import { db } from '../../db';
import { assets, creatives } from '../../db/schema';
import { broadcast } from '../../events';
import { UserFacingError } from '../../ipc/register';
import type { JobContext } from '../../jobs/queue';
import { guessCountries, kindOf, parseYoutubeIds, type Aspect, type Creative, type CreativePatch, type CreativeStatus, type ImportResult } from '@shared/creative';
import { probe, sha256, thumbnail } from './media';

// Thư viện đọc file gốc tại chỗ: không copy, không sửa, không xóa file của người dùng.

type Row = typeof creatives.$inferSelect;

export const thumbsDir = () => path.join(app.getPath('userData'), 'thumbs');
export const thumbPath = (id: string) => path.join(thumbsDir(), `${id}.jpg`);

function linkedCounts(rows: Row[]) {
  const keys = rows.map((r) => (r.kind === 'video' ? (r.youtubeId ? `yt:${r.youtubeId}` : null) : r.id)).filter((k): k is string => !!k);
  const counts = new Map<string, number>();
  if (!keys.length) return counts;
  for (const a of db.select().from(assets).where(inArray(assets.creativeId, keys)).all()) {
    counts.set(a.creativeId, (counts.get(a.creativeId) ?? 0) + 1);
  }
  return counts;
}

function toCreatives(rows: Row[]): Creative[] {
  const linked = linkedCounts(rows);
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    appId: r.appId,
    name: r.name,
    path: r.path,
    kind: r.kind,
    durationS: r.durationS,
    width: r.width,
    height: r.height,
    aspect: r.aspect,
    sizeBytes: r.sizeBytes,
    countries: JSON.parse(r.countries) as string[],
    youtubeId: r.youtubeId,
    status: r.status as CreativeStatus,
    privacy: r.privacy,
    error: r.error ? JSON.parse(r.error) : null,
    linkedCustomers: linked.get(r.kind === 'video' ? `yt:${r.youtubeId}` : r.id) ?? 0,
    createdAt: r.createdAt,
  }));
}

export const listCreatives = () => toCreatives(db.select().from(creatives).all());

export function getRows(ids: string[]) {
  return ids.length ? db.select().from(creatives).where(inArray(creatives.id, ids)).all() : [];
}

export function getRow(id: string) {
  const r = db.select().from(creatives).where(eq(creatives.id, id)).get();
  if (!r) throw new UserFacingError({ message: 'Creative không còn trong thư viện', code: 'NOT_FOUND' });
  return r;
}

// Cập nhật + đẩy sang renderer
export function updateCreatives(ids: string[], patch: Partial<typeof creatives.$inferInsert>) {
  if (!ids.length) return;
  db.update(creatives).set({ ...patch, updatedAt: new Date().toISOString() }).where(inArray(creatives.id, ids)).run();
  emit(ids);
}

export function emit(ids: string[]) {
  broadcast({ type: 'creatives', creatives: toCreatives(getRows(ids)) });
}

// ── Nhập file / thư mục ─────────────────────────────────────────────────────
function walk(paths: string[]) {
  const files: string[] = [];
  const skipped: string[] = [];
  const visit = (p: string) => {
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      skipped.push(p);
      return;
    }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p, { recursive: true, withFileTypes: true })) {
        if (e.isFile() && !e.name.startsWith('.')) visit(path.join(e.parentPath, e.name));
      }
    } else if (st.isFile()) {
      if (kindOf(p)) files.push(p);
      else skipped.push(p);
    }
  };
  paths.forEach(visit);
  return { files: [...new Set(files)], skipped };
}

export async function importPaths(paths: string[], appId: string | null, ctx: JobContext): Promise<ImportResult> {
  const { files, skipped } = walk(paths);
  fs.mkdirSync(thumbsDir(), { recursive: true });
  let added = 0;
  let duplicates = 0;
  const changed: string[] = [];

  for (const [i, file] of files.entries()) {
    ctx.progress(i, files.length);
    try {
      const hash = await sha256(file);
      const dup = db.select().from(creatives).where(eq(creatives.sha256, hash)).get();
      if (dup) {
        duplicates++;
        // File cũ đã bị di chuyển: trỏ sang vị trí mới, giữ nguyên youtubeId
        if (dup.path !== file && !fs.existsSync(dup.path)) {
          db.update(creatives).set({ path: file }).where(eq(creatives.id, dup.id)).run();
          changed.push(dup.id);
        }
        continue;
      }
      const info = await probe(file);
      const id = randomUUID();
      const kind = kindOf(file)!;
      try {
        await thumbnail(file, thumbPath(id), kind === 'video' ? info.durationS : null);
      } catch (err) {
        log.warn(`[creatives] không tạo được thumbnail ${file}`, (err as Error).message);
      }
      const base = path.basename(file);
      db.insert(creatives)
        .values({
          id,
          path: file,
          sha256: hash,
          kind,
          durationS: kind === 'video' ? info.durationS : null,
          width: info.width,
          height: info.height,
          aspect: info.aspect,
          sizeBytes: fs.statSync(file).size,
          countries: JSON.stringify(guessCountries(base)),
          status: 'LOCAL',
          source: 'file',
          appId,
          name: base.replace(/\.[^.]+$/, '').slice(0, 100),
          updatedAt: new Date().toISOString(),
        })
        .run();
      changed.push(id);
      added++;
    } catch (err) {
      log.warn(`[creatives] bỏ qua ${file}`, (err as Error).message);
      skipped.push(file);
    }
    // Đẩy theo lô để thư viện hiện dần khi nhập thư mục lớn
    if (changed.length >= 20) emit(changed.splice(0));
  }
  if (changed.length) emit(changed);
  ctx.progress(files.length, files.length);
  return { added, duplicates, skipped };
}

// ── Nhập ID YouTube có sẵn (đường lui khi project chưa qua audit) ───────────
export function addYoutubeIds(input: { text: string; appId: string | null; aspect: Aspect | null; countries: string[] }, verify: boolean) {
  const { ids, invalid } = parseYoutubeIds(input.text);
  if (!ids.length) {
    throw new UserFacingError({ message: invalid.length ? `Không đọc được ID: ${invalid.slice(0, 3).join(', ')}` : 'Chưa nhập ID hoặc link', field: 'text', action: 'fix' });
  }
  const existing = new Set(
    db.select({ y: creatives.youtubeId }).from(creatives).where(inArray(creatives.youtubeId, ids)).all().map((r) => r.y),
  );
  const fresh = ids.filter((id) => !existing.has(id));
  const newIds: string[] = [];
  for (const yt of fresh) {
    const id = randomUUID();
    db.insert(creatives)
      .values({
        id,
        path: '',
        sha256: `yt:${yt}`, // không có file: khóa duy nhất theo ID YouTube
        kind: 'video',
        aspect: input.aspect,
        countries: JSON.stringify(input.countries),
        youtubeId: yt,
        // Có tài khoản YouTube thì kiểm tra trạng thái thật; không có thì tin người dùng
        status: verify ? 'PROCESSING' : 'READY',
        source: 'youtube',
        appId: input.appId,
        name: yt,
        updatedAt: new Date().toISOString(),
      })
      .run();
    newIds.push(id);
  }
  emit(newIds);
  return { added: fresh.length, duplicates: ids.length - fresh.length, invalid };
}

export function patchCreatives(p: CreativePatch) {
  const rows = getRows(p.ids);
  db.transaction((tx) => {
    for (const r of rows) {
      const set: Partial<Row> = { updatedAt: new Date().toISOString() };
      if (p.countries) set.countries = JSON.stringify(p.countries);
      if (p.addCountries) set.countries = JSON.stringify([...new Set([...(JSON.parse(r.countries) as string[]), ...p.addCountries])]);
      if (p.aspect) set.aspect = p.aspect;
      if (p.name) set.name = p.name;
      if (p.appId !== undefined) set.appId = p.appId;
      tx.update(creatives).set(set).where(eq(creatives.id, r.id)).run();
    }
  });
  emit(p.ids);
}

// Xóa khỏi thư viện (file gốc giữ nguyên). Video đang upload phải hủy trước.
export function removeCreatives(ids: string[]) {
  const rows = getRows(ids);
  if (rows.some((r) => r.status === 'UPLOADING')) {
    throw new UserFacingError({ message: 'Có video đang upload — hãy tạm dừng hoặc hủy trước khi xóa', action: 'fix' });
  }
  db.delete(creatives).where(inArray(creatives.id, ids)).run();
  for (const r of rows) fs.rmSync(thumbPath(r.id), { force: true });
  broadcast({ type: 'creativesRemoved', ids });
}

export const byYoutubeIds = (ids: string[]) =>
  ids.length ? db.select().from(creatives).where(inArray(creatives.youtubeId, ids)).all() : [];
