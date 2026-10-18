// Chạy bằng utilityProcess.fork(): upload không chặn main process, crash cũng không kéo sập app.
import fs from 'node:fs/promises';
import type { FromWorker, ToWorker } from './protocol';
import { uploadResumable, UploadError } from './resumable';

const port = process.parentPort;
const post = (m: FromWorker) => port.postMessage(m);

interface Active {
  abort: AbortController;
  token: string;
  waitToken?: (t: string) => void;
}
const active = new Map<string, Active>();

async function start(m: Extract<ToWorker, { type: 'start' }>) {
  const a: Active = { abort: new AbortController(), token: m.accessToken };
  active.set(m.id, a);
  let fh: fs.FileHandle | null = null;
  let lastPct = -1;
  try {
    fh = await fs.open(m.filePath, 'r');
    const file = fh;
    const done = await uploadResumable(
      {
        size: m.size,
        mime: m.mime,
        title: m.title,
        session: m.session,
        onSession: (url) => post({ type: 'session', id: m.id, url }),
        onProgress: (sent) => {
          const pct = Math.floor((sent / m.size) * 100);
          if (pct !== lastPct) post({ type: 'progress', id: m.id, sent, size: m.size });
          lastPct = pct;
        },
      },
      {
        fetch,
        readChunk: async (s, e) => {
          const buf = Buffer.alloc(e - s);
          await file.read(buf, 0, e - s, s);
          return buf;
        },
        getToken: () => a.token,
        refreshToken: () =>
          new Promise<string>((resolve) => {
            a.waitToken = (t) => resolve((a.token = t));
            post({ type: 'needToken', id: m.id });
          }),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        signal: a.abort.signal,
      },
    );
    post({ type: 'done', id: m.id, ...done });
  } catch (err) {
    if (a.abort.signal.aborted) post({ type: 'aborted', id: m.id });
    else {
      const e = err instanceof UploadError ? err : new UploadError((err as Error)?.message ?? String(err), null);
      post({ type: 'error', id: m.id, status: e.status, reason: e.reason, message: e.message, sessionGone: e.sessionGone });
    }
  } finally {
    await fh?.close();
    active.delete(m.id);
  }
}

port.on('message', ({ data }: { data: ToWorker }) => {
  if (data.type === 'start') void start(data);
  else if (data.type === 'token') active.get(data.id)?.waitToken?.(data.accessToken);
  else if (data.type === 'abort') active.get(data.id)?.abort.abort();
});
