'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'omniagent-theme';

const OPTIONS: readonly { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Tema chiaro', Icon: Sun },
  { value: 'system', label: 'Tema di sistema', Icon: Monitor },
  { value: 'dark', label: 'Tema scuro', Icon: Moon },
];

function applyTheme(preference: ThemePreference): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = preference === 'dark' || (preference === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', useDark);
}

/**
 * Selettore del tema a tre stati.
 *
 * "Sistema" è uno stato a sé e non l'assenza di scelta: con due soli stati, chi
 * imposta il tema chiaro di giorno resta bloccato lì la sera, quando il sistema
 * passa allo scuro. Lo stato scelto vive in localStorage e viene riletto dallo
 * script inline in `layout.tsx` prima del primo paint.
 */
export function ThemeToggle() {
  // Prima dell'idratazione il valore reale non è noto: si rende comunque il
  // controllo (nessun salto di layout) e si sincronizza l'evidenziazione dopo.
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setPreference(stored);
    } catch {
      /* localStorage non accessibile: resta "system". */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(preference);

    // In modalità "sistema" il tema deve seguire il cambio di preferenza del SO
    // mentre la pagina è aperta, non solo al caricamento.
    if (preference !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference, mounted]);

  const choose = (value: ThemePreference): void => {
    setPreference(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* Scelta non persistibile: vale comunque per questa sessione. */
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tema dell'interfaccia"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => choose(value)}
            className={cn(
              'flex size-7 items-center justify-center rounded-md transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted hover:bg-surface-raised hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
