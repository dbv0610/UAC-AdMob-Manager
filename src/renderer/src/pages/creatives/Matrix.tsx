import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Grid3x3, X } from 'lucide-react';
import { ASPECTS, ASPECT_LABEL, coverage, isUsable, missingCells, type Aspect } from '@shared/creative';
import { COUNTRIES, COUNTRY_GROUPS, flag, getCountry } from '@shared/geo';
import { useUi } from '@/lib/store';
import { useCreatives } from '@/lib/queries';
import { Banner, Button, Card, EmptyState, Select, Skeleton, cx } from '@/components/ui';
import { loadFilter, saveFilter } from './shared';

// Ma trận quốc gia × tỉ lệ: chỉ ra ô thiếu video Sẵn sàng (Google khuyên đủ Ngang + Dọc + Vuông mỗi nước).

function loadExtra(): string[] {
  try {
    return JSON.parse(localStorage.getItem('matrix.countries') ?? '[]');
  } catch {
    return [];
  }
}
function saveExtra(v: string[]) {
  try {
    localStorage.setItem('matrix.countries', JSON.stringify(v));
  } catch {
    /* bỏ qua */
  }
}

export function Matrix({ onOpen }: { onOpen: () => void }) {
  const q = useCreatives();
  const appId = useUi((s) => s.prefs?.currentAppId ?? null);
  const [extra, setExtraState] = useState(loadExtra);
  const setExtra = (v: string[]) => {
    setExtraState(v);
    saveExtra(v);
  };

  const list = useMemo(() => (q.data ?? []).filter((c) => c.kind === 'video' && (!appId || c.appId === appId || c.appId == null)), [q.data, appId]);
  const countries = useMemo(() => [...new Set([...list.flatMap((c) => c.countries), ...extra])].sort(), [list, extra]);
  const cov = useMemo(() => coverage(list, countries), [list, countries]);
  const missing = missingCells(cov);
  const sharedReady = list.filter((c) => isUsable(c) && c.countries.length === 0).length;
  const noAspect = list.filter((c) => isUsable(c) && !c.aspect).length;

  // Nhấp ô → mở thư viện lọc đúng nước + tỉ lệ
  const open = (country: string, aspect: Aspect) => {
    saveFilter({ ...loadFilter(), country, aspect, status: 'all', q: '' });
    onOpen();
  };

  if (q.isLoading) return <Skeleton className="h-80 rounded-lg" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          {countries.length === 0 ? (
            'Chưa có quốc gia nào'
          ) : missing === 0 ? (
            <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" aria-hidden /> Mọi quốc gia đủ 3 tỉ lệ</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-4" aria-hidden /> <span className="num">{missing}</span> ô thiếu video</span>
          )}
          <span className="ml-2 text-muted">· chỉ đếm video Sẵn sàng · {sharedReady} video dùng chung tính cho mọi nước</span>
        </p>
        <div className="flex-1" />
        <Select className="w-44" value="" aria-label="Thêm quốc gia vào ma trận"
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const codes = v.startsWith('group:') ? COUNTRY_GROUPS.find((g) => g.id === v.slice(6))!.codes : [v];
            setExtra([...new Set([...extra, ...codes])]);
          }}>
          <option value="">+ Thêm quốc gia…</option>
          {COUNTRY_GROUPS.map((g) => <option key={g.id} value={`group:${g.id}`}>Nhóm {g.name}</option>)}
          {COUNTRIES.filter((c) => !countries.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </Select>
      </div>

      {noAspect > 0 && <Banner tone="info">{noAspect} video sẵn sàng chưa rõ tỉ lệ (nhập ID tay) nên không được đếm — chọn chúng ở Thư viện rồi “Đặt tỉ lệ”.</Banner>}

      {countries.length === 0 ? (
        <Card>
          <EmptyState icon={Grid3x3} title="Ma trận trống">Gán quốc gia cho creative (hoặc đặt tên file có _US_, _VN.) hay thêm quốc gia ở góc trên để xem nước nào còn thiếu tỉ lệ nào.</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Quốc gia</th>
                {ASPECTS.map((a) => <th key={a} className="w-36 px-3 py-2 text-center font-medium">{ASPECT_LABEL[a]}</th>)}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {countries.map((code) => {
                const row = cov[code];
                return (
                  <tr key={code}>
                    <td className="px-3 py-1.5">
                      <span aria-hidden>{flag(code)}</span> {getCountry(code)?.name ?? code} <span className="font-mono text-xs text-muted">{code}</span>
                    </td>
                    {ASPECTS.map((a) => {
                      const { own, shared } = row[a];
                      const total = own + shared;
                      return (
                        <td key={a} className="px-2 py-1">
                          <button onClick={() => open(code, a)}
                            title={`${own} video riêng · ${shared} video dùng chung`}
                            className={cx('flex h-8 w-full items-center justify-center gap-1 rounded-sm border text-xs font-medium',
                              total === 0 ? 'border-danger/40 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success')}>
                            {total === 0 ? <><X className="size-3.5" aria-hidden /> Thiếu</> : <><CheckCircle2 className="size-3.5" aria-hidden /> <span className="num">{own}</span>{shared > 0 && <span className="num opacity-75">+{shared}</span>}</>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-1">
                      {extra.includes(code) && !list.some((c) => c.countries.includes(code)) && (
                        <Button size="sm" variant="ghost" icon={X} aria-label={`Bỏ ${code} khỏi ma trận`} onClick={() => setExtra(extra.filter((x) => x !== code))} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
