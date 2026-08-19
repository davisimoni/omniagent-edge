'use client';

import { Code2, FileCode2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useDevMode } from '@/components/dev-mode/dev-mode-provider';
import { getSpec } from '@/lib/showcase/specs';
import { cn } from '@/lib/utils';

/**
 * Badge di architettura, visibile solo in Developer Mode.
 *
 * Apre un popover con la scelta, il motivo e lo spezzone di codice che la
 * realizza. È un `<button>` vero, non un `div` con `onClick`: raggiungibile da
 * tastiera, annunciato come controllo, con `aria-expanded` che ne dichiara lo
 * stato — un elemento decorativo che nasconde contenuto sarebbe invisibile a
 * chiunque non usi il mouse.
 */
export function SpecBadge({ id, className }: { id: string; className?: string }) {
  const { enabled } = useDevMode();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const spec = getSpec(id);

  useEffect(() => {
    if (!open) return;

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handlePointer = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handlePointer);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handlePointer);
    };
  }, [open]);

  // Fuori da Developer Mode il badge non esiste, e un `id` sconosciuto non
  // rende nulla invece di mostrare un riquadro vuoto.
  if (!enabled || spec === undefined) return null;

  return (
    <span ref={containerRef} className={cn('relative inline-flex print:hidden', className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5',
          'font-mono text-[10px] font-medium leading-4 text-accent transition-colors',
          'hover:border-accent hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Code2 className="size-3" aria-hidden="true" />
        {spec.label}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Dettaglio architettura: ${spec.headline}`}
          className={cn(
            'absolute left-0 top-full z-40 mt-1.5 w-[min(30rem,calc(100vw-2rem))]',
            'rounded-xl border border-border bg-surface p-3 text-left shadow-2xl',
            'motion-safe:animate-omni-dialog-in',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug">{spec.headline}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi il dettaglio"
              className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-muted">{spec.what}</p>

          <p className="mt-2 rounded-lg border border-border bg-surface-raised p-2 text-xs leading-relaxed">
            <span className="font-medium text-accent">Perché.</span> {spec.why}
          </p>

          <pre className="scrollbar-slim mt-2 overflow-x-auto rounded-lg border border-border bg-background p-2">
            <code className="font-mono text-[10px] leading-relaxed">{spec.snippet}</code>
          </pre>

          <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-muted">
            <FileCode2 className="size-3" aria-hidden="true" />
            {spec.file}
          </p>
        </div>
      )}
    </span>
  );
}
