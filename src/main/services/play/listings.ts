import fs from 'node:fs';
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import ExcelJS from 'exceljs';
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { UserFacingError } from '../../ipc/register';
import type { JobContext } from '../../jobs/queue';
import { assertOnline, withRetry } from '../googleAds/client';
import { withEdit } from './client';
import { probe } from '../creatives/media';
import {
  IMAGE_SPEC,
  IMAGE_TYPES,
  checkImage,
  imageTarget,
  textsFromRows,
  type ImageSet,
  type LanguageImages,
  type ListingText,
  type PickImagesResult,
  type PlayListing,
  type PushListingRequest,
  type PushResult,
} from '@shared/listing';

// Trang thông tin cửa hàng qua Android Publisher API (Edits): mọi thay đổi nằm trong một edit,
// commit một lần ở cuối — lỗi giữa chừng thì bỏ edit, Play không nhận nửa vời.

const toText = (l: androidpublisher_v3.Schema$Listing): ListingText => ({
  language: l.language ?? '',
  title: l.title ?? '',
  shortDescription: l.shortDescription ?? '',
  fullDescription: l.fullDescription ?? '',
  video: l.video ?? '',
});

export function pullListing(accountId: string, packageName: string): Promise<PlayListing> {
  return withEdit(accountId, packageName, async (api, editId) => {
    const [details, list] = await Promise.all([api.edits.details.get({ packageName, editId }), api.edits.listings.list({ packageName, editId })]);
    return {
      packageName,
      defaultLanguage: details.data.defaultLanguage ?? 'en-US',
      listings: (list.data.listings ?? []).map(toText).sort((a, b) => a.language.localeCompare(b.language)),
      fetchedAt: new Date().toISOString(),
    };
  });
}

// Ảnh của một ngôn ngữ: 8 loại, đọc song song trong cùng một edit
export function listImages(accountId: string, packageName: string, language: string): Promise<LanguageImages> {
  return withEdit(accountId, packageName, async (api, editId) => {
    const lists = await Promise.all(IMAGE_TYPES.map((imageType) => api.edits.images.list({ packageName, editId, language, imageType })));
    const out: LanguageImages = {};
    IMAGE_TYPES.forEach((t, i) => {
      const imgs = lists[i].data.images ?? [];
      if (imgs.length) out[t] = imgs.map((x) => ({ id: x.id ?? '', url: x.url ?? '', sha256: x.sha256 ?? '' }));
    });
    return out;
  });
}

// ── Ảnh trên máy: chỉ nhận đường dẫn đã chọn qua hộp thoại của main ─────────
const picked = new Set<string>();
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export async function pickImages(win: BrowserWindow | null): Promise<PickImagesResult | null> {
  const opts: Electron.OpenDialogOptions = { title: 'Chọn thư mục ảnh (mỗi ngôn ngữ một thư mục con)', properties: ['openDirectory'] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths.length) return null;
  const root = res.filePaths[0];
  const rels = (fs.readdirSync(root, { recursive: true }) as string[]).filter((r) => /\.(png|jpe?g)$/i.test(r)).sort(naturalSort).slice(0, 2000);

  const groups = new Map<string, { language: string; type: ImageSet['type']; rels: string[] }>();
  const skipped: string[] = [];
  for (const rel of rels) {
    const t = imageTarget(rel);
    if (!t) {
      skipped.push(rel);
      continue;
    }
    const key = `${t.language}|${t.type}`;
    if (!groups.has(key)) groups.set(key, { ...t, rels: [] });
    groups.get(key)!.rels.push(rel);
  }

  const sets: ImageSet[] = [];
  for (const g of groups.values()) {
    const max = IMAGE_SPEC[g.type].max;
    const files = await Promise.all(
      g.rels.map(async (rel, i) => {
        const abs = path.join(root, rel);
        const sizeBytes = fs.statSync(abs).size;
        const dims = await probe(abs).catch(() => null);
        const issues = dims ? checkImage(g.type, { width: dims.width, height: dims.height, sizeBytes }) : ['Không đọc được kích thước ảnh'];
        if (i >= max) issues.push(`Quá ${max} ảnh cho loại này`);
        picked.add(abs);
        return { path: abs, name: path.basename(rel), width: dims?.width ?? 0, height: dims?.height ?? 0, sizeBytes, issues };
      }),
    );
    sets.push({ language: g.language, type: g.type, files });
  }
  sets.sort((a, b) => a.language.localeCompare(b.language) || IMAGE_TYPES.indexOf(a.type) - IMAGE_TYPES.indexOf(b.type));
  return { root, sets, skipped };
}

// ── Đẩy lên Play ────────────────────────────────────────────────────────────
export async function pushListing(req: PushListingRequest, ctx: JobContext): Promise<PushResult> {
  assertOnline();
  const { accountId, packageName } = req;
  for (const set of req.images) {
    if (set.paths.length > IMAGE_SPEC[set.type].max) {
      throw new UserFacingError({ message: `${IMAGE_SPEC[set.type].label} (${set.language}) tối đa ${IMAGE_SPEC[set.type].max} ảnh`, code: 'TOO_MANY_IMAGES', action: 'fix' });
    }
    for (const p of set.paths) {
      if (!picked.has(p) || !fs.existsSync(p)) throw new UserFacingError({ message: `Chỉ upload được ảnh vừa chọn: ${path.basename(p)}`, code: 'BAD_PATH', action: 'fix' });
    }
  }
  const imageCount = req.images.reduce((n, s) => n + s.paths.length, 0);
  const total = req.upsert.length + req.remove.length + req.images.length + imageCount + 1;
  let done = 0;
  const step = () => ctx.progress(++done, total);

  const before = await withEdit(accountId, packageName, async (api, editId, commit) => {
    const prev = new Map(((await api.edits.listings.list({ packageName, editId })).data.listings ?? []).map((l) => [l.language!, toText(l)]));
    for (const t of req.upsert) {
      // update = ghi đè cả listing của ngôn ngữ đó (video '' để xóa video cũ)
      await withRetry(() => api.edits.listings.update({ packageName, editId, language: t.language, requestBody: { ...t } }));
      step();
    }
    for (const language of req.remove) {
      await withRetry(() => api.edits.listings.delete({ packageName, editId, language }));
      step();
    }
    for (const set of req.images) {
      // Thay toàn bộ ảnh của loại đó, đúng thứ tự file
      await withRetry(() => api.edits.images.deleteall({ packageName, editId, language: set.language, imageType: set.type }));
      step();
      for (const p of set.paths) {
        await withRetry(() =>
          api.edits.images.upload({
            packageName,
            editId,
            language: set.language,
            imageType: set.type,
            media: { mimeType: MIME[path.extname(p).toLowerCase()] ?? 'image/png', body: fs.createReadStream(p) },
          }),
        );
        step();
      }
    }
    await api.edits.validate({ packageName, editId });
    await api.edits.commit({ packageName, editId, changesNotSentForReview: !req.sendForReview });
    commit();
    step();
    return prev;
  });

  db.transaction((tx) => {
    const audit = (entity: string, entityId: string, b: unknown, a: unknown) =>
      tx.insert(auditLog).values({ actor: 'user', entity, entityId, before: b == null ? null : JSON.stringify(b), after: a == null ? null : JSON.stringify(a) }).run();
    for (const t of req.upsert) audit('play.listing', `${packageName}/${t.language}`, before.get(t.language), t);
    for (const l of req.remove) audit('play.listing', `${packageName}/${l}`, before.get(l), null);
    for (const s of req.images) audit('play.images', `${packageName}/${s.language}/${s.type}`, null, s.paths.map((p) => path.basename(p)));
  });
  return { languages: req.upsert.length, removed: req.remove.length, images: imageCount, sentForReview: req.sendForReview };
}

// ── Excel ───────────────────────────────────────────────────────────────────
const exported = new Set<string>();
export const wasListingExport = (p: string) => exported.has(p);

export async function exportListingXlsx(win: BrowserWindow | null, packageName: string, texts: ListingText[]) {
  const opts = { title: 'Xuất trang thông tin cửa hàng', defaultPath: `listing_${packageName}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Listing', { views: [{ state: 'frozen', ySplit: 1 }] });
  // Tiêu đề cột giữ tên field của API để nhập lại không cần đoán
  ws.columns = [
    { header: 'language', key: 'language', width: 10 },
    { header: 'title', key: 'title', width: 32 },
    { header: 'shortDescription', key: 'shortDescription', width: 50 },
    { header: 'fullDescription', key: 'fullDescription', width: 90 },
    { header: 'video', key: 'video', width: 40 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const t of texts) ws.addRow(t).alignment = { vertical: 'top', wrapText: true };
  await wb.xlsx.writeFile(res.filePath);
  exported.add(res.filePath);
  return res.filePath;
}

export async function importListingXlsx(win: BrowserWindow | null): Promise<{ file: string; texts: ListingText[]; errors: string[] } | null> {
  const opts: Electron.OpenDialogOptions = { title: 'Nhập nội dung bản địa hóa', properties: ['openFile'], filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv'] }] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  const wb = new ExcelJS.Workbook();
  const ws = file.toLowerCase().endsWith('.csv') ? await wb.csv.readFile(file) : (await wb.xlsx.readFile(file)).worksheets[0];
  if (!ws) throw new UserFacingError({ message: 'File không có sheet nào', code: 'EMPTY_FILE', action: 'fix' });
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) row.push(ws.getCell(r, c).text ?? '');
    rows.push(row);
  }
  return { file, ...textsFromRows(rows) };
}
