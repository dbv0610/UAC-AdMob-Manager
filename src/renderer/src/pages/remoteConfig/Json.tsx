import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlignLeft, ChevronDown, ChevronUp, Minimize2 } from 'lucide-react';
import { Button, cx } from '@/components/ui';

// Hiển thị / sửa JSON cho Remote Config: định dạng đẹp + tô màu cú pháp, không thêm thư viện.
import { parseJson, prettyJson } from '@shared/json';
export { isJsonLike, keepStyle, parseJson, prettyJson } from '@shared/json';

const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index! > last) out.push(<Fragment key={i++}>{src.slice(last, m.index)}</Fragment>);
    const t = m[0];
    const cls = m[2] ? 'text-accent' : t.startsWith('"') ? 'text-success' : /^(true|false|null)$/.test(t) ? 'text-warning' : 'text-info';
    if (m[2]) {
      // khóa: tô màu phần tên, dấu ":" để màu thường
      const k = t.slice(0, t.lastIndexOf(':'));
      out.push(<span key={i++} className={cls}>{k}</span>, <Fragment key={i++}>{t.slice(k.length)}</Fragment>);
    } else out.push(<span key={i++} className={cls}>{t}</span>);
    last = m.index! + t.length;
  }
  if (last < src.length) out.push(<Fragment key={i++}>{src.slice(last)}</Fragment>);
  return out;
}

// Ô xem JSON: định dạng + tô màu, thu gọn còn `lines` dòng, bấm để mở rộng
export function JsonView({ value, lines = 4, className }: { value: string; lines?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => prettyJson(value), [value]);
  const all = pretty.split('\n');
  const long = all.length > lines;
  const shown = open || !long ? pretty : `${all.slice(0, lines).join('\n')}\n…`;
  return (
    <div className={cx('min-w-0', className)}>
      <pre className="overflow-x-auto rounded-sm bg-surface-2/70 px-2 py-1 font-mono text-[11.5px] leading-relaxed whitespace-pre text-text" data-selectable>{highlight(shown)}</pre>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted hover:text-accent">
          {open ? <><ChevronUp className="size-3" aria-hidden /> Thu gọn</> : <><ChevronDown className="size-3" aria-hidden /> Xem đủ {all.length} dòng</>}
        </button>
      )}
    </div>
  );
}

// Ô sửa JSON: textarea trong suốt đè lên lớp tô màu (cuộn đồng bộ); nút định dạng / thu gọn; lỗi theo dòng:cột
export function JsonEditor({ value, onChange, label, minRows = 8 }: { value: string; onChange: (v: string) => void; label: string; minRows?: number }) {
  const pre = useRef<HTMLPreElement>(null);
  const parsed = parseJson(value);
  const rows = Math.min(28, Math.max(minRows, value.split('\n').length + 1));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={AlignLeft} disabled={!parsed.ok} onClick={() => parsed.ok && onChange(JSON.stringify(parsed.value, null, 2))}>Định dạng</Button>
        <Button size="sm" variant="ghost" icon={Minimize2} disabled={!parsed.ok} onClick={() => parsed.ok && onChange(JSON.stringify(parsed.value))}>Thu gọn</Button>
        <span className="flex-1" />
        {parsed.ok ? <span className="text-[11px] text-success">✓ JSON hợp lệ</span> : <span className="text-[11px] text-danger">✕ {parsed.error}</span>}
      </div>
      <div className={cx('relative rounded-sm border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30', parsed.ok ? 'border-border' : 'border-danger')}>
        <pre ref={pre} aria-hidden className="pointer-events-none absolute inset-0 m-0 overflow-hidden p-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-text">
          {highlight(value)}{'\n'}
        </pre>
        <textarea
          aria-label={label}
          value={value}
          rows={rows}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (pre.current) pre.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            // Tab = 2 khoảng trắng thay vì nhảy ô
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = t;
            onChange(`${value.slice(0, a)}  ${value.slice(b)}`);
            requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
          }}
          className="relative block w-full resize-y bg-transparent p-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-transparent caret-text outline-none selection:bg-accent/25"
        />
      </div>
    </div>
  );
}
