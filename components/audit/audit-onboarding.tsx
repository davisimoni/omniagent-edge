'use client';

import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  FileSearch,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Guida introduttiva all'audit.
 *
 * **Tre passi e non sette.** Un tour lungo viene chiuso al secondo passo, e chi
 * lo chiude non lo riapre: il costo di un onboarding troppo ambizioso non è la
 * noia, è che porta via anche i due passi che sarebbero serviti. Qui si spiega
 * solo ciò che non si deduce guardando: che si può partire da un contratto di
 * prova, che le etichette sulle citazioni sono la cosa da leggere per prima, e
 * che il report si porta fuori.
 *
 * **Non è un modale.** Un riquadro in linea si può ignorare guardando altrove;
 * un modale va chiuso prima di poter fare qualunque cosa. Chi arriva qui per la
 * seconda volta non deve pagare un dazio per la guida che ha già letto — e
 * infatti, una volta congedata, resta congedata.
 */

const STORAGE_KEY = 'omniagent-audit-tour-dismissed';

interface TourStep {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: ReactNode;
}

export function AuditOnboarding({ onLoadSample }: { onLoadSample: () => void }) {
  const [dismissed, setDismissed] = useState(true);
  const [step, setStep] = useState(0);
  // Evita il lampo: finché non si è letta la preferenza non si mostra nulla,
  // altrimenti chi ha già congedato la guida la rivedrebbe a ogni caricamento
  // per il tempo di un fotogramma.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === 'yes');
    } catch {
      setDismissed(false);
    }
    setReady(true);
  }, []);

  const dismiss = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'yes');
    } catch {
      /* La guida resta chiusa per questa sessione. */
    }
  };

  const reopen = (): void => {
    setStep(0);
    setDismissed(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Niente da fare: la guida si riapre comunque ora. */
    }
  };

  const STEPS: readonly TourStep[] = [
    {
      id: 'load',
      icon: <Upload className="size-4" aria-hidden="true" />,
      title: 'Carica un contratto',
      body: (
        <>
          <p>
            Trascina un PDF, incolla il testo, o parti dal contratto di prova: contiene problemi
            reali — rinnovo tacito con disdetta a sei mesi, massimale pari a tre mensilità, foro
            estero — così puoi verificare ogni rilievo sul testo.
          </p>
          <p className="mt-1.5">
            Se il PDF è una scansione, il sistema se ne accorge e lo trascrive prima di analizzarlo.
            Non devi fare nulla.
          </p>
          <Button onClick={onLoadSample} className="mt-2.5">
            <FileSearch className="size-4" aria-hidden="true" />
            Prova con il contratto di esempio
          </Button>
        </>
      ),
    },
    {
      id: 'read',
      icon: <BadgeCheck className="size-4" aria-hidden="true" />,
      title: 'Leggi i rilievi e le citazioni',
      body: (
        <>
          <p>
            Ogni rilievo cita il passaggio che lo genera, e accanto alla citazione c&apos;è
            l&apos;esito della verifica automatica contro il documento:
          </p>
          <ul className="mt-2 space-y-1.5">
            <li className="flex items-start gap-2">
              <Badge tone="success">citazione confermata</Badge>
              <span className="text-muted">la frase è nel documento, alla lettera.</span>
            </li>
            <li className="flex items-start gap-2">
              <Badge tone="warning">parziale</Badge>
              <span className="text-muted">il passaggio esiste ma non combacia parola per parola.</span>
            </li>
            <li className="flex items-start gap-2">
              <Badge tone="danger">NON trovata</Badge>
              <span className="text-muted">
                da controllare a mano prima di qualunque uso negoziale.
              </span>
            </li>
          </ul>
          <p className="mt-2">
            Il punteggio di rischio non lo scrive l&apos;AI: lo calcola il codice a partire dai
            rilievi citati, quindi due analisi dello stesso contratto danno lo stesso numero.
          </p>
        </>
      ),
    },
    {
      id: 'export',
      icon: <Download className="size-4" aria-hidden="true" />,
      title: 'Porta fuori il report',
      body: (
        <>
          <p>
            Tre formati, a seconda di chi lo riceve: <strong>PDF</strong> per chi decide,
            <strong> Markdown</strong> per una mail o un ticket, <strong>JSON</strong> per un
            archivio o un altro sistema.
          </p>
          <p className="mt-1.5">
            Il report riporta sempre anche i propri limiti — citazioni non ritrovate, clausole non
            valutate, impegni di servizio senza dati misurati. Un audit che tace le proprie lacune
            vale meno di nessun audit, perché nessuno andrà a ricontrollarlo.
          </p>
        </>
      ),
    },
  ];

  if (!ready) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={reopen}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5',
          'text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground',
          'print:hidden',
        )}
      >
        <Compass className="size-3.5" aria-hidden="true" />
        Come funziona
      </button>
    );
  }

  const current = STEPS[step];
  if (current === undefined) return null;
  const isLast = step === STEPS.length - 1;

  return (
    <section
      aria-label="Guida introduttiva all'audit"
      className="rounded-xl border border-accent/30 bg-accent-soft/40 p-4 print:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Compass className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight">Come funziona, in tre passi</h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Chiudi la guida"
          className="rounded p-1 text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Lo stepper è una lista di controlli: si può saltare al passo che
          interessa invece di dover attraversare i precedenti. */}
      <ol className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        {STEPS.map((entry, index) => {
          const active = index === step;
          const done = index < step;
          return (
            <li key={entry.id} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors',
                  active
                    ? 'border-accent bg-surface text-foreground shadow-sm'
                    : 'border-transparent text-muted hover:bg-surface/60 hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    done
                      ? 'bg-success text-white'
                      : active
                        ? 'bg-accent text-accent-foreground'
                        : 'border border-border-strong text-muted',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                <span className="min-w-0 truncate">{entry.title}</span>
              </button>
              {index < STEPS.length - 1 && (
                <ChevronRight
                  className="hidden size-3.5 shrink-0 text-muted sm:block"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 rounded-lg border border-border bg-surface p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-accent">{current.icon}</span>
          {current.title}
        </p>
        <div className="mt-1.5 text-xs leading-relaxed">{current.body}</div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => setStep((value) => Math.max(0, value - 1))}
          disabled={step === 0}
          className="px-2 py-1.5 text-xs"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Indietro
        </Button>

        <span className="text-[11px] tabular-nums text-muted">
          {step + 1} di {STEPS.length}
        </span>

        {isLast ? (
          <Button onClick={dismiss} className="px-3 py-1.5 text-xs">
            <Check className="size-3.5" aria-hidden="true" />
            Ho capito
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
            className="px-3 py-1.5 text-xs"
          >
            Avanti
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </section>
  );
}
