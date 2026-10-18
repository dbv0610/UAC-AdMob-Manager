import { randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import { desc, eq, inArray } from 'drizzle-orm';
import log from 'electron-log/main';
import { db } from '../db';
import { jobs } from '../db/schema';
import { broadcast } from '../events';
import { toAppError } from '../ipc/register';
import type { AppError, Job, JobKind } from '@shared/types';

// Hàng đợi job nền: lưu vào SQLite, đẩy trạng thái sang renderer qua 'app:event'.

export interface JobContext {
  jobId: string;
  progress(done: number, total: number, unit?: '%' | 'items'): void;
  fail(error: AppError): void; // đánh dấu job lỗi một phần mà vẫn trả kết quả
}

const queue = new PQueue({ concurrency: 2 });

function rowToJob(r: typeof jobs.$inferSelect): Job {
  return {
    id: r.id,
    kind: r.kind as JobKind,
    title: r.title,
    state: r.state as Job['state'],
    progress: r.progress ? JSON.parse(r.progress) : null,
    error: r.error ? JSON.parse(r.error) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function update(id: string, patch: Partial<typeof jobs.$inferInsert>) {
  const row = db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(jobs.id, id))
    .returning()
    .get();
  if (row) broadcast({ type: 'job', job: rowToJob(row) });
}

// Chạy job nền và trả về cả kết quả (dùng khi IPC cần chờ, ví dụ Kiểm tra kế hoạch).
export function runJob<T>(kind: JobKind, title: string, run: (ctx: JobContext) => Promise<T>, payload?: unknown) {
  const id = randomUUID();
  const row = db
    .insert(jobs)
    .values({ id, kind, title, state: 'queued', payload: payload ? JSON.stringify(payload) : null, updatedAt: new Date().toISOString() })
    .returning()
    .get();
  broadcast({ type: 'job', job: rowToJob(row) });

  let lastEmit = 0;
  const ctx: JobContext = {
    jobId: id,
    progress(done, total, unit = 'items') {
      // Giới hạn tần suất gửi để upload lớn không làm ngập IPC
      const now = Date.now();
      if (now - lastEmit < 150 && done < total) return;
      lastEmit = now;
      update(id, { progress: JSON.stringify({ done, total, unit }) });
    },
    fail(error) {
      failedWith = error;
    },
  };

  let failedWith: AppError | null = null;
  const result = queue.add(async () => {
    update(id, { state: 'running' });
    try {
      const out = await run(ctx);
      // Job xong nhưng có phần lỗi (vd 18/20 quốc gia): hiện đỏ để người dùng thấy và thử lại
      update(id, failedWith ? { state: 'failed', error: JSON.stringify(failedWith) } : { state: 'done' });
      return out;
    } catch (err) {
      log.error(`[job] ${kind} ${id} lỗi`, err);
      update(id, { state: 'failed', error: JSON.stringify(toAppError(err)) });
      throw err;
    }
  }) as Promise<T>;
  return { id, result };
}

export function enqueue(kind: JobKind, title: string, run: (ctx: JobContext) => Promise<void>, payload?: unknown) {
  const { id, result } = runJob(kind, title, run, payload);
  result.catch(() => {}); // lỗi đã ghi vào job
  return id;
}

// Job tự quản (upload YouTube): hiện trong JobDrawer nhưng không chiếm chỗ của hàng đợi chung,
// vì một video có thể upload hàng chục phút.
export function trackJob(kind: JobKind, title: string, payload?: unknown) {
  const id = randomUUID();
  const row = db
    .insert(jobs)
    .values({ id, kind, title, state: 'running', payload: payload ? JSON.stringify(payload) : null, updatedAt: new Date().toISOString() })
    .returning()
    .get();
  broadcast({ type: 'job', job: rowToJob(row) });
  let lastEmit = 0;
  return {
    id,
    progress(done: number, total: number, unit: '%' | 'items' = '%') {
      const now = Date.now();
      if (now - lastEmit < 500 && done < total) return;
      lastEmit = now;
      update(id, { progress: JSON.stringify({ done, total, unit }) });
    },
    done: () => update(id, { state: 'done' }),
    paused: () => update(id, { state: 'paused' }),
    fail: (error: AppError) => update(id, { state: 'failed', error: JSON.stringify(error) }),
  };
}
export type TrackedJob = ReturnType<typeof trackJob>;

export function listJobs(limit = 50): Job[] {
  return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all().map(rowToJob);
}

export function hasActiveJobs() {
  return queue.size + queue.pending > 0;
}

// Job đang chạy khi app tắt đột ngột: đánh dấu lỗi để người dùng thấy và chạy lại.
export function recoverInterruptedJobs() {
  db.update(jobs)
    .set({ state: 'failed', error: JSON.stringify({ message: 'App bị đóng khi job đang chạy', action: 'retry' }), updatedAt: new Date().toISOString() })
    .where(inArray(jobs.state, ['queued', 'running']))
    .run();
}
