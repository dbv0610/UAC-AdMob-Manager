import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Languages, Settings2, Sparkles } from 'lucide-react';
import { checkAdText, type TranslateResult, type TranslatedItem } from '@shared/adtext';
import { LANGUAGES, flag } from '@shared/geo';
import { counterTone } from '@shared/textLength';
import type { CountryRow } from '@shared/plan';
import { api } from '@/lib/api';
import { navigate, useUi } from '@/lib/store';
import { useSecrets } from '@/lib/queries';
import { Dialog } from '@/components/dialog';
import { Banner, Button, Field, Input, Select, cx } from '@/components/ui';
import { toast } from '@/components/toast';
import { useErrorHandler } from '@/components/connect';

// AI dịch text quảng cáo: chọn dòng nguồn → dịch sang ngôn ngữ chính của các dòng đích → duyệt từng câu → áp dụng.
// Câu vượt 30/90 ký tự đã được AI rút gọn tối đa 2 lần; câu còn lỗi tô đỏ để sửa tay trước khi áp dụng.

const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

export function TranslateDialog({
  rows,
  targets,
  appId,
  onApply,
  onClose,
}: {
  rows: CountryRow[];
  targets: number[]; // chỉ số dòng nhận bản dịch
  appId: string | null;
  onApply: (byLang: Record<string, { headlines: string[]; descriptions: string[] }>) => void;
  onClose: () => void;
}) {
  const secrets = useSecrets();
  const online = useUi((s) => s.online);
  const onError = useErrorHandler();
  // Dòng nguồn mặc định: dòng có text và có tiếng Anh, sau đó tới dòng đầu có text
  const withText = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.headlines.some((h) => h.trim()));
  const [source, setSource] = useState(() => (withText.find(({ r }) => r.languages.includes('en')) ?? withText[0])?.i ?? 0);
  const src = rows[source];
  const srcLang = src?.languages[0];
  const langs = useMemo(
    () => [...new Set(targets.filter((i) => i !== source).map((i) => rows[i]?.languages[0]).filter((l): l is string => !!l && l !== srcLang))],
    [targets, rows, source, srcLang],
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(langs);
  const [tone, setTone] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TranslateResult[] | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.ai.translate({
        appId,
        headlines: src.headlines.filter((h) => h.trim()),
        descriptions: src.descriptions.filter((d) => d.trim()),
        langs: [...chosen],
        tone: tone.trim() || undefined,
      });
      setResults(res);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const edit = (lang: string, k: number, text: string) =>
    setResults((rs) => rs!.map((r) => (r.lang !== lang ? r : { ...r, items: r.items.map((it, j) => (j !== k ? it : { ...it, text, ...checkAdText(text, it.field) })) })));

  const usable = (results ?? []).filter((r) => !r.error && r.items.length);
  const bad = usable.reduce((n, r) => n + r.items.filter((it) => it.over || !it.text.trim()).length, 0);

  const apply = async () => {
    const byLang: Record<string, { headlines: string[]; descriptions: string[] }> = {};
    for (const r of usable) {
      byLang[r.lang] = {
        headlines: r.items.filter((x) => x.field === 'headline').map((x) => x.text.trim()),
        descriptions: r.items.filter((x) => x.field === 'description').map((x) => x.text.trim()),
      };
    }
    onApply(byLang);
    // Lưu vào thư viện text đã duyệt để lần sau dùng lại
    if (appId) {
      await Promise.all(usable.map((r) => api.ai.saveTexts({ appId, lang: r.lang, items: r.items.map((x) => ({ field: x.field, text: x.text.trim() })) }))).catch(() => undefined);
    }
    toast({ tone: 'success', title: `Đã áp bản dịch cho ${Object.keys(byLang).length} ngôn ngữ` });
    onClose();
  };

  const noKey = secrets.data && !secrets.data.aiKey;
  return (
    <Dialog
      title={results ? 'Duyệt bản dịch AI' : 'Dịch text bằng AI'}
      onClose={onClose}
      width="w-[920px]"
      footer={
        results ? (
          <>
            {bad > 0 && <span className="mr-auto flex items-center gap-1 text-sm text-danger"><AlertCircle className="size-4" aria-hidden /> {bad} câu còn quá dài hoặc trống — sửa trước khi áp dụng</span>}
            <Button variant="ghost" onClick={() => setResults(null)}>Quay lại</Button>
            <Button variant="primary" icon={CheckCircle2} disabled={!usable.length || bad > 0} onClick={() => void apply()}>Áp dụng cho các dòng</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Hủy</Button>
            <Button variant="primary" icon={Sparkles} loading={busy} disabled={!src || !chosen.size || !!noKey || !online} onClick={() => void run()}>
              Dịch sang {chosen.size} ngôn ngữ
            </Button>
          </>
        )
      }
    >
      {noKey ? (
        <Banner tone="warning" action={<Button size="sm" variant="primary" icon={Settings2} onClick={() => { onClose(); navigate('/settings'); }}>Mở Cài đặt → AI</Button>}>
          Cần nhập API key Claude để dùng AI dịch.
        </Banner>
      ) : !withText.length ? (
        <Banner tone="info">Nhập tiêu đề và mô tả cho ít nhất một dòng (thường là bản tiếng Anh) để làm nguồn dịch.</Banner>
      ) : !results ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dòng nguồn" htmlFor="tsrc">
              <Select id="tsrc" value={source} onChange={(e) => { setSource(Number(e.target.value)); setPicked(null); }}>
                {withText.map(({ r, i }) => <option key={i} value={i}>{flag(r.countryCode)} {r.countryCode} · {langName(r.languages[0])}</option>)}
              </Select>
            </Field>
            <Field label="Giọng văn (không bắt buộc)" htmlFor="ttone">
              <Input id="ttone" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Trẻ trung, thân thiện; nhấn mạnh miễn phí" />
            </Field>
          </div>
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted">Text nguồn</p>
            <ul className="space-y-0.5">
              {src.headlines.filter((h) => h.trim()).map((h, k) => <li key={`h${k}`}><span className="text-xs text-muted">Tiêu đề:</span> {h}</li>)}
              {src.descriptions.filter((d) => d.trim()).map((d, k) => <li key={`d${k}`}><span className="text-xs text-muted">Mô tả:</span> {d}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Dịch sang (ngôn ngữ chính của các dòng đã chọn)</p>
            {langs.length === 0 ? (
              <p className="text-sm text-muted">Các dòng đã chọn cùng ngôn ngữ với dòng nguồn — không cần dịch.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {langs.map((l) => (
                  <label key={l} className={cx('flex items-center gap-1.5 rounded-sm border px-2 py-1 text-sm', chosen.has(l) ? 'border-accent bg-accent/5' : 'border-border')}>
                    <input type="checkbox" checked={chosen.has(l)} onChange={() => { const n = new Set(chosen); if (n.has(l)) n.delete(l); else n.add(l); setPicked(n); }} />
                    {langName(l)}
                    <span className="text-xs text-muted">· {targets.filter((i) => rows[i]?.languages[0] === l).map((i) => rows[i].countryCode).join(', ')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted"><Languages className="size-3.5" aria-hidden /> Dùng Claude. AI tự rút gọn câu vượt 30/90 ký tự (tối đa 2 lần); bạn duyệt từng câu trước khi áp dụng.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {results.map((r) => (
            <section key={r.lang} className="rounded-lg border border-border">
              <h3 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold">
                {langName(r.lang)} <span className="font-normal text-muted">→ {targets.filter((i) => rows[i]?.languages[0] === r.lang).map((i) => rows[i].countryCode).join(', ')}</span>
              </h3>
              {r.error ? (
                <p className="p-3 text-sm text-danger">{r.error}</p>
              ) : (
                <div className="flex flex-col gap-2 p-3">
                  {r.items.map((it, k) => <ItemRow key={k} it={it} onChange={(t) => edit(r.lang, k, t)} />)}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function ItemRow({ it, onChange }: { it: TranslatedItem; onChange: (t: string) => void }) {
  const tone = counterTone(it.len, it.max);
  return (
    <div className="grid grid-cols-[1fr_1.4fr] items-start gap-3">
      <p className="pt-1.5 text-xs text-muted" title={it.source}>
        <span className="mr-1 rounded-sm bg-surface-2 px-1">{it.field === 'headline' ? 'Tiêu đề' : 'Mô tả'}</span>
        {it.source}
      </p>
      <div>
        <Input value={it.text} invalid={it.over || !it.text.trim()} onChange={(e) => onChange(e.target.value)} aria-label={`Bản dịch: ${it.source}`} />
        <div className="mt-0.5 flex items-center gap-2 text-xs">
          <span className={cx('num', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>{it.len}/{it.max}</span>
          {it.attempts > 1 && <span className="text-muted">AI đã rút gọn {it.attempts - 1} lần</span>}
          {it.issues.filter((x) => !x.startsWith('Dài')).map((x) => <span key={x} className="text-warning">⚠ {x}</span>)}
        </div>
      </div>
    </div>
  );
}
