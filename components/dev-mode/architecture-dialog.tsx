'use client';

import { ChevronRight, Code2, FileCode2, Info, Layers } from 'lucide-react';
import { useState } from 'react';
import { useDevMode } from '@/components/dev-mode/dev-mode-provider';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/primitives';
import {
  ARCHITECTURE_SPECS,
  CATEGORY_LABELS,
  SPEC_CATEGORIES,
  specsByCategory,
  TECH_STACK,
  type ArchitectureSpec,
} from '@/lib/showcase/specs';
import { cn } from '@/lib/utils';

/**
 * Vetrina dello stack e delle scelte architetturali.
 *
 * Esiste perché una parte del pubblico di questa applicazione non è un utente:
 * è qualcuno che valuta com'è costruita. Quella persona, senza un punto di
 * ingresso, finisce a giudicare un prodotto di ingegneria dall'aspetto delle
 * schede — che è la parte meno interessante di ciò che c'è sotto.
 *
 * Ogni voce dichiara **la scelta e la sua alternativa scartata**: un elenco di
 * tecnologie adottate dice solo che si conoscono dei nomi, mentre il motivo per
 * cui una è stata preferita a un'altra è l'unica cosa che distingua una
 * decisione da un default lasciato com'era.
 */
export function ArchitectureButton() {
  const [open, setOpen] = useState(false);
  const { enabled, toggle } = useDevMode();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5',
          'text-xs font-medium transition-colors hover:bg-surface-raised',
          enabled && 'border-accent/40 bg-accent-soft text-accent',
        )}
      >
        <Layers className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Architettura</span>
        <span className="sr-only sm:hidden">Stack e architettura</span>
        {enabled && (
          <span className="hidden font-mono text-[10px] uppercase md:inline">dev</span>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Stack e scelte architetturali"
        description="Che cosa c'è sotto, e perché è stato scelto così invece che altrimenti."
      >
        {/* ── Developer Mode ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Code2 className="size-4 text-accent" aria-hidden="true" />
              Developer Mode
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Accende badge cliccabili accanto ai componenti dell&apos;interfaccia: ognuno apre la
              decisione che quel componente realizza, con lo spezzone di codice e il file.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              enabled
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border bg-surface hover:bg-surface-raised',
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full transition-colors',
                enabled ? 'bg-accent-foreground' : 'bg-muted',
              )}
              aria-hidden="true"
            />
            {enabled ? 'Attiva' : 'Disattivata'}
          </button>
        </div>

        {/* ── Stack ──────────────────────────────────────────────────────── */}
        <section className="mt-5">
          <h3 className="text-sm font-semibold tracking-tight">Stack</h3>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TECH_STACK.map((group) => (
              <div key={group.area} className="rounded-lg border border-border bg-surface-raised p-2.5">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  {group.area}
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {group.items.map((item) => (
                    <Badge key={item}>{item}</Badge>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Decisioni ──────────────────────────────────────────────────── */}
        <section className="mt-5">
          <h3 className="text-sm font-semibold tracking-tight">
            Decisioni ({ARCHITECTURE_SPECS.length})
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Ogni voce si apre sul perché e sul codice che la realizza.
          </p>

          <div className="mt-2 space-y-4">
            {SPEC_CATEGORIES.map((category) => {
              const specs = specsByCategory(category);
              if (specs.length === 0) return null;
              return (
                <div key={category}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {CATEGORY_LABELS[category]}
                  </p>
                  <ul className="space-y-1.5">
                    {specs.map((spec) => (
                      <li key={spec.id}>
                        <SpecDisclosure spec={spec} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <p className="mt-5 flex items-start gap-1.5 rounded-lg border border-border bg-surface-raised p-2.5 text-[11px] leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Le metriche nei badge sono <strong>vere per costruzione</strong> — quante clausole ha il
            catalogo, quante parole compone una finestra di confronto — non latenze decorative. I
            tempi reali si vedono dove vengono misurati: nel pannello metriche della dashboard e
            nella tabella dei costi di ogni audit.
          </span>
        </p>
      </Dialog>
    </>
  );
}

/**
 * Voce apribile.
 *
 * `<details>` nativo: apertura da tastiera, stato annunciato e contenuto
 * trovabile dalla ricerca del browser anche da chiuso, senza una riga di
 * JavaScript da mantenere.
 */
function SpecDisclosure({ spec }: { spec: ArchitectureSpec }) {
  return (
    <details className="group rounded-lg border border-border bg-surface-raised open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-medium">
        <ChevronRight
          className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">{spec.headline}</span>
        <span className="hidden shrink-0 font-mono text-[10px] text-accent sm:inline">
          {spec.metric}
        </span>
      </summary>

      <div className="border-t border-border px-2.5 py-2.5">
        <p className="text-xs leading-relaxed text-muted">{spec.what}</p>
        <p className="mt-2 text-xs leading-relaxed">
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
    </details>
  );
}
