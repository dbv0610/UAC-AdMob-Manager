import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { aspectOf, type Aspect } from '@shared/creative';

const run = promisify(execFile);

// Binary đóng gói kèm app; trong bản build nằm ở app.asar.unpacked. Thiếu thì dùng bản trên PATH.
function binary(bundled: string | null | undefined, name: string) {
  const p = bundled?.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`);
  return p && fs.existsSync(p) ? p : name;
}
const FFPROBE = binary(ffprobeStatic?.path, 'ffprobe');
const FFMPEG = binary(ffmpegStatic as unknown as string | null, 'ffmpeg');

export interface MediaInfo {
  durationS: number | null;
  width: number;
  height: number;
  aspect: Aspect;
}

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 4 << 20 });
  const data = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: { duration?: string } };
  const v = data.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!v) throw new Error('Không có luồng hình ảnh');
  // Video quay dọc trên điện thoại thường lưu ngang + cờ xoay 90°
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  const [width, height] = rot === 90 ? [v.height!, v.width!] : [v.width!, v.height!];
  const dur = Number(data.format?.duration);
  return { durationS: Number.isFinite(dur) && dur > 0 ? dur : null, width, height, aspect: aspectOf(width, height) };
}

// Thumbnail JPEG tối đa 320×320, lấy khung ở giây 1 (hoặc giữa video nếu ngắn hơn)
export async function thumbnail(file: string, out: string, durationS: number | null) {
  const at = durationS ? Math.min(1, durationS / 2) : 0;
  const args = [
    '-y', '-v', 'error',
    ...(durationS ? ['-ss', at.toFixed(2)] : []),
    '-i', file,
    '-frames:v', '1',
    '-vf', 'scale=320:320:force_original_aspect_ratio=decrease',
    '-q:v', '4',
    out,
  ];
  await run(FFMPEG, args, { timeout: 30_000 });
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file, { highWaterMark: 1 << 20 })
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
};
export const mimeOf = (file: string) => MIME[file.slice(file.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
