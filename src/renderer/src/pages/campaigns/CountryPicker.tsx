import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { COUNTRY_GROUPS, flag, getCountry, searchCountries } from '@shared/geo';
import { Button, Input, cx } from '@/components/ui';

// Multi-select quốc gia: nhóm sẵn (Tier 1, SEA, LATAM, EU, MENA), tìm theo tên không dấu hoặc mã ISO.
export function CountryPicker({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => searchCountries(q), [q]);
  const set = new Set(value);

  const toggle = (code: string) => onChange(set.has(code) ? value.filter((c) => c !== code) : [...value, code]);
  const toggleGroup = (codes: string[]) => {
    const all = codes.every((c) => set.has(c));
    onChange(all ? value.filter((c) => !codes.includes(c)) : [...value, ...codes.filter((c) => !set.has(c))]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted" aria-hidden />
          <Input
            className="pl-8"
            placeholder="Tìm: duc, brazil, JP…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Enter thêm kết quả đầu tiên — nhập nhanh bằng bàn phím
              if (e.key === 'Enter' && list[0]) {
                e.preventDefault();
                if (!set.has(list[0].code)) onChange([...value, list[0].code]);
                setQ('');
              }
            }}
            aria-label="Tìm quốc gia"
          />
        </div>
        {COUNTRY_GROUPS.map((g) => {
          const all = g.codes.every((c) => set.has(c));
          return (
            <Button key={g.id} size="sm" variant={all ? 'primary' : 'secondary'} icon={all ? Check : undefined} onClick={() => toggleGroup(g.codes)}
              title={g.codes.join(', ')}>
              {g.name} <span className="num text-xs opacity-75">{g.codes.length}</span>
            </Button>
          );
        })}
        <div className="flex-1" />
        {value.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Bỏ chọn tất cả
          </Button>
        )}
      </div>

      <div className="min-h-9 rounded-lg border border-border bg-surface-2 p-2" aria-live="polite">
        {value.length === 0 ? (
          <p className="px-1 py-0.5 text-sm text-muted">Chưa chọn quốc gia nào — chọn nhóm hoặc tích từng nước bên dưới.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <span className="num self-center px-1 text-sm font-medium">{value.length} quốc gia:</span>
            {value.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-sm border border-accent/30 bg-accent/10 py-0.5 pr-0.5 pl-1.5 text-xs font-medium text-accent">
                <span aria-hidden>{flag(c)}</span> {c}
                <button className="rounded-sm p-0.5 hover:bg-accent/20" aria-label={`Bỏ ${getCountry(c)?.name ?? c}`} onClick={() => toggle(c)}>
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1">
        {list.map((c) => {
          const on = set.has(c.code);
          return (
            <label
              key={c.code}
              className={cx(
                'flex h-9 cursor-pointer items-center gap-2 rounded-sm border px-2 text-sm',
                on ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:bg-surface-2',
              )}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(c.code)} />
              <span aria-hidden>{flag(c.code)}</span>
              <span className="flex-1 truncate">{c.name}</span>
              <span className="font-mono text-xs text-muted">{c.code}</span>
            </label>
          );
        })}
        {list.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted">Không tìm thấy “{q}”</p>}
      </div>
    </div>
  );
}
