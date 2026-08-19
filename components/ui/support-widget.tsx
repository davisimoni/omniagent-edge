'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { AlertCircle, ArrowUp, MessageCircleQuestion, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QUICK_PROMPTS } from '@/lib/support/quick-prompts';
import { cn } from '@/lib/utils';

/**
 * OmniSupport Edge — assistente di supporto flottante.
 *
 * **Non è un modale, ed è una decisione.** Chi apre un riquadro di aiuto quasi
 * sempre ha una domanda *su ciò che ha davanti*: un punteggio che non capisce,
 * una citazione marcata "non trovata". Un modale gli toglierebbe di vista
 * esattamente la cosa di cui sta chiedendo. Il pannello è quindi non modale —
 * `aria-modal="false"`, nessun focus trap, nessun inert — e la pagina resta
 * leggibile e navigabile mentre l'assistente risponde.
 *
 * Da qui discende il resto del comportamento accessibile: Escape chiude, il
 * focus va al campo di testo all'apertura e **torna al pulsante** alla chiusura,
 * e lo stato dello streaming viene annunciato in una regione dedicata invece che
 * lasciando gridare a uno screen reader ogni token in arrivo.
 */

const PANEL_ID = 'omnisupport-panel';

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollAnchor = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({ api: '/api/support' }), []);
  const { messages, sendMessage, status, stop, error, clearError, setMessages } =
    useChat<UIMessage>({ transport });

  const busy = status === 'submitted' || status === 'streaming';

  // Il focus entra nel pannello all'apertura e torna al pulsante alla chiusura:
  // senza il ritorno, chi naviga da tastiera si ritrova all'inizio del documento
  // ogni volta che chiude il riquadro.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else launcherRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  useEffect(() => {
    if (open) scrollAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy, open]);

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    clearError();
    void sendMessage({ text: trimmed });
    setInput('');
  };

  const statusLabel = busy
    ? 'L\'assistente sta rispondendo'
    : error !== undefined
      ? 'Si è verificato un errore'
      : 'In attesa della tua domanda';

  return (
    <>
      {/* Il riquadro non appartiene al documento stampato. */}
      <div className="print:hidden">
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          className={cn(
            'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium',
            'text-accent-foreground shadow-lg transition-all hover:shadow-xl',
            'motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0',
            open && 'pointer-events-none opacity-0',
          )}
        >
          <MessageCircleQuestion className="size-5" aria-hidden="true" />
          <span className="hidden sm:inline">Serve aiuto?</span>
          <span className="sr-only sm:hidden">Apri l&apos;assistente di supporto</span>
        </button>

        {open && (
          <div
            id={PANEL_ID}
            role="dialog"
            // Non modale di proposito: la pagina dietro resta leggibile, ed è
            // quasi sempre ciò di cui l'utente sta chiedendo.
            aria-modal="false"
            aria-label="OmniSupport Edge — assistente di supporto"
            className={cn(
              'fixed z-50 flex flex-col overflow-hidden border border-border bg-surface shadow-2xl',
              'motion-safe:animate-omni-panel-in',
              // Su schermo stretto occupa la larghezza piena con un foglio dal
              // basso; su desktop resta una scheda ancorata all'angolo.
              'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl',
              'sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(36rem,calc(100dvh-6rem))] sm:w-[24rem] sm:rounded-2xl',
            )}
          >
            <SupportHeader onClose={() => setOpen(false)} />

            {/* Lo stato è annunciato qui, una volta per transizione: un
                `aria-live` sul flusso dei messaggi farebbe rileggere la risposta
                da capo a ogni token in arrivo. */}
            <p className="sr-only" role="status" aria-live="polite">
              {statusLabel}
            </p>

            <div className="scrollbar-slim flex-1 overflow-y-auto px-3 py-3" role="log">
              {messages.length === 0 ? (
                <SupportIntro onPick={submit} disabled={busy} />
              ) : (
                <ul className="space-y-3">
                  {messages.map((message) => (
                    <li key={message.id}>
                      <SupportBubble message={message} />
                    </li>
                  ))}
                </ul>
              )}

              {status === 'submitted' && <TypingIndicator />}
              <div ref={scrollAnchor} />
            </div>

            {error !== undefined && (
              <div
                role="alert"
                className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-[11px] leading-relaxed text-danger"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  {error.message.length > 0
                    ? error.message
                    : 'L\'assistente non ha risposto. Riprova fra un momento.'}
                </span>
              </div>
            )}

            <SupportComposer
              value={input}
              onChange={setInput}
              onSubmit={submit}
              onStop={stop}
              onReset={() => {
                setMessages([]);
                clearError();
              }}
              busy={busy}
              hasMessages={messages.length > 0}
              inputRef={inputRef}
            />
          </div>
        )}
      </div>
    </>
  );
}

function SupportHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border bg-surface-raised px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Sparkles className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">OmniSupport Edge</p>
        <p className="text-[11px] leading-tight text-muted">
          Domande su audit, clausole o architettura
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Chiudi l'assistente"
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function SupportIntro({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="px-1 text-xs leading-relaxed text-muted">
        Chiedimi come funziona la piattaforma, che cosa controlla un audit o perché
        un&apos;architettura è fatta così. Non do consulenza legale e non analizzo contratti in
        chat: per quello c&apos;è la pagina Audit.
      </p>

      <p className="mt-3 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        Domande frequenti
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {QUICK_PROMPTS.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => onPick(item.prompt)}
              disabled={disabled}
              className={cn(
                'w-full rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-left text-xs leading-snug',
                'transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SupportBubble({ message }: { message: UIMessage }) {
  const text = message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');

  if (text.trim().length === 0) return null;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-xs leading-relaxed text-accent-foreground">
          {text}
        </p>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-surface-raised px-3 py-2 text-xs leading-relaxed">
        <FormattedText text={text} />
      </div>
    </div>
  );
}

/**
 * Formattazione minima del testo dell'assistente.
 *
 * Grassetto, codice inline ed elenchi puntati, resi come nodi React. Nessuna
 * libreria Markdown e soprattutto nessun `dangerouslySetInnerHTML`: qui scorre
 * testo generato da un modello a partire da un input dell'utente, ed è
 * esattamente il percorso lungo il quale si introduce una XSS convinti di
 * stare solo abbellendo il rendering.
 */
function FormattedText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);

  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^\s*[-*•]\s+/.test(line));

        if (isList) {
          return (
            <ul key={blockIndex} className="my-1 ml-3.5 list-disc space-y-0.5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(line.replace(/^\s*[-*•]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={blockIndex} className={cn(blockIndex > 0 && 'mt-2')}>
            {inline(block)}
          </p>
        );
      })}
    </>
  );
}

function inline(text: string): ReactNode[] {
  // Una sola passata su grassetto e codice: token alternati, indici stabili.
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={index} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={index}
          className="rounded bg-background px-1 py-0.5 font-mono text-[10px] text-accent"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    return <span key={index}>{token}</span>;
  });
}

function TypingIndicator() {
  return (
    <div className="mt-3 flex items-center gap-1.5 px-1" aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 rounded-full bg-muted motion-safe:animate-omni-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

function SupportComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  onReset,
  busy,
  hasMessages,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  onReset: () => void;
  busy: boolean;
  hasMessages: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
      className="border-t border-border p-2.5"
    >
      <div className="flex items-end gap-1.5">
        <label htmlFor="omnisupport-input" className="sr-only">
          Scrivi una domanda all&apos;assistente
        </label>
        <textarea
          id="omnisupport-input"
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Invio spedisce, Maiusc+Invio va a capo: la convenzione che chi
            // scrive in un riquadro di chat si aspetta senza doverla leggere.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit(value);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Scrivi una domanda…"
          className="scrollbar-slim max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-xs leading-relaxed placeholder:text-muted"
        />

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Interrompi la risposta"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface transition-colors hover:bg-surface-raised"
          >
            <Square className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={value.trim().length === 0}
            aria-label="Invia la domanda"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground',
              'transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {hasMessages && (
        <button
          type="button"
          onClick={onReset}
          className="mt-1.5 text-[11px] text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Nuova conversazione
        </button>
      )}
    </form>
  );
}
