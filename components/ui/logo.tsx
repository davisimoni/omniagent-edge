'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * OmniAgent Logo.
 *
 * **Il simbolo.** Uno scudo a spalle angolari — sicurezza, ma con la geometria
 * di un nodo di rete, non l'araldica di un lucchetto — con dentro un segno di
 * spunta a nodo terminale: la verifica che si conclude in un punto certo. È il
 * riassunto di ciò che il prodotto fa: un audit che difende, eseguito
 * all'estremità della rete, che finisce in un rilievo verificato.
 *
 * **Il gradiente non è cyber-slate/emerald puro, ed è una scelta.** L'accento di
 * tutto il sistema è indaco-violetto: un logo che parte dal verde creerebbe due
 * marchi nella stessa pagina, e la prima cosa che nota chi valuta un prodotto è
 * quando l'identità non tiene. Il gradiente parte quindi dall'accento
 * esistente, attraversa il ciano — che è dove "cyber" vive davvero — e arriva
 * allo smeraldo richiesto. Indaco → cielo → smeraldo interpola pulito in sRGB
 * senza passare dal grigio, cosa che un violetto→verde diretto farebbe.
 *
 * **`useId` per gli identificativi dei gradienti.** Due loghi nella stessa
 * pagina — intestazione e piè di pagina — con lo stesso `id` producono markup
 * non valido, e il browser risolve entrambi al primo `defs` incontrato: finché i
 * gradienti sono identici non si vede, e si vedrà il giorno in cui una variante
 * cambierà colore. Il costo è rendere il componente client; è un componente da
 * un kilobyte senza stato, e la correttezza vale più del kilobyte.
 */

export type LogoVariant = 'icon' | 'full';

export function Logo({
  variant = 'full',
  size = 28,
  className,
  showBadge = true,
  title = 'OmniAgent Edge',
}: {
  variant?: LogoVariant;
  /** Lato dell'icona in pixel; la tipografia scala di conseguenza. */
  size?: number;
  className?: string;
  showBadge?: boolean;
  title?: string;
}) {
  const gradientId = useId();
  const bevelId = useId();

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // Il titolo accessibile sta sul contenitore quando c'è anche il testo:
      // ripeterlo qui farebbe annunciare due volte lo stesso marchio.
      aria-hidden={variant === 'full' ? 'true' : undefined}
      role={variant === 'icon' ? 'img' : undefined}
      aria-label={variant === 'icon' ? title : undefined}
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--logo-from)" />
          <stop offset="0.52" stopColor="var(--logo-via)" />
          <stop offset="1" stopColor="var(--logo-to)" />
        </linearGradient>
        <linearGradient id={bevelId} x1="8" y1="3" x2="20" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Scudo a spalle angolari: la silhouette protettiva senza l'araldica. */}
      <path
        d="M16 1.8 27.8 8.1V17c0 6.9-5.2 11.8-11.8 13.9C9.4 28.8 4.2 23.9 4.2 17V8.1L16 1.8Z"
        fill={`url(#${gradientId})`}
      />

      {/* Faccetta superiore: dà spessore al nodo senza aggiungere un secondo colore. */}
      <path d="M16 1.8 27.8 8.1 16 14.4 4.2 8.1 16 1.8Z" fill={`url(#${bevelId})`} />

      {/* Verifica: il tratto che collega due nodi e si chiude su quello confermato. */}
      <path
        d="M10.6 16.4 14.4 20.2 21.6 12.6"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21.6" cy="12.6" r="2" fill="#ffffff" />
    </svg>
  );

  if (variant === 'icon') return <span className={cn('inline-flex', className)}>{mark}</span>;

  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      role="img"
      aria-label={title}
    >
      {mark}
      <span className="flex items-baseline gap-1.5">
        <span
          className="font-semibold tracking-tight text-foreground"
          style={{ fontSize: size * 0.62, lineHeight: 1 }}
        >
          OmniAgent
        </span>
        {showBadge && (
          <span
            className={cn(
              'rounded border border-accent/40 bg-accent-soft px-1 py-px font-mono font-semibold',
              'uppercase leading-none tracking-[0.12em] text-accent',
            )}
            style={{ fontSize: Math.max(8, size * 0.3) }}
          >
            Edge
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * Versione monocromatica per la stampa.
 *
 * Il PDF esce spesso da una stampante in bianco e nero: un gradiente indaco →
 * smeraldo diventa lì una macchia grigia uniforme, e il segno di spunta bianco
 * al suo interno sparisce del tutto. Questa variante inverte il rapporto —
 * contorno pieno, spunta in negativo — così il marchio resta riconoscibile
 * anche quando il colore non c'è.
 */
export function LogoPrint({ size = 22 }: { size?: number }) {
  return (
    <span className="hidden items-center gap-2 print:inline-flex">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M16 1.8 27.8 8.1V17c0 6.9-5.2 11.8-11.8 13.9C9.4 28.8 4.2 23.9 4.2 17V8.1L16 1.8Z"
          fill="#111114"
        />
        <path
          d="M10.6 16.4 14.4 20.2 21.6 12.6"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="21.6" cy="12.6" r="2" fill="#ffffff" />
      </svg>
      <span className="text-sm font-semibold tracking-tight">
        OmniAgent <span className="font-mono text-[10px] uppercase tracking-widest">Edge</span>
      </span>
    </span>
  );
}
