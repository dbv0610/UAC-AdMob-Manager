import type { Prefs } from '@shared/types';
import { api } from './api';
import { getState, setState } from './store';
import { setLocale } from './format';

// Áp prefs lên DOM: lớp .dark, mật độ, ngôn ngữ.
export function applyPrefsToDom(p: Prefs) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.classList.toggle('density-comfortable', p.density === 'comfortable');
  root.lang = p.locale.slice(0, 2);
  setLocale(p.locale);
}

export async function updatePrefs(patch: Partial<Prefs>) {
  const prev = getState().prefs;
  if (prev) {
    // Cập nhật lạc quan để giao diện phản hồi ngay
    const optimistic = { ...prev, ...patch };
    setState({ prefs: optimistic });
    applyPrefsToDom(optimistic);
  }
  const next = await api.prefs.set(patch);
  setState({ prefs: next });
  applyPrefsToDom(next);
  return next;
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const p = getState().prefs;
  if (p?.theme === 'system') applyPrefsToDom(p);
});
