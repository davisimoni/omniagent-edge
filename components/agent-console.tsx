'use client';

import { DefaultChatTransport, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { AlertCircle, ArrowUp, Bot, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MetricsPanel } from '@/components/metrics-panel';
import { MessageTrace, RunningIndicator } from '@/components/trace-timeline';
import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { AGENT_TOOL_NAMES, TOOL_DESCRIPTIONS, TOOL_LABELS } from '@/lib/agent/tool-metadata';
import type { ChatMessageMetadata } from '@/lib/schemas';

type OmniUIMessage = UIMessage<ChatMessageMetadata>;

/**
 * Prompt di esempio.
 *
 * Scelti per esercitare percorsi diversi del ciclo: uno che ricade sulla sola
 * ricerca, uno sul solo gestionale, uno che richiede entrambi nello stesso turno
 * e uno che porta l'agente a un tool call sbagliato e alla sua correzione — che
 * è la parte del ciclo ReAct più interessante da guardare e la meno dimostrata.
 */
const EXAMPLES: readonly { label: string; prompt: string }[] = [
  {
    label: 'Ricerca documentale',
    prompt: 'Quali sono i tempi di risposta garantiti dallo SLA Enterprise e cosa succede se non vengono rispettati?',
  },
  {
    label: 'Dati dal gestionale',
    prompt: 'Elenca le fatture scadute nel CRM/ERP e dimmi a quanto ammonta il totale.',
  },
  {
    label: 'Multi-tool',
    prompt: 'Confronta la nostra procedura di escalation documentata con i ticket S1 aperti nel sistema di supporto: la stiamo rispettando?',
  },
  {
    label: 'Estrazione',
    prompt:
      'Struttura questo testo: "Fattura n. 2026/318 del 12 marzo 2026, emessa da Rossi Logistica SpA a Delta Energia SpA, imponibile 4.250,00 EUR, IVA 22%, totale 5.185,00 EUR, scadenza 11 aprile 2026."',
  },
];

export function AgentConsole() {
  const [input, setInput] = useState('');
  const scrollAnchor = useRef<HTMLDivElement>(null);

  // Il transport è costruito una volta sola: ricrearlo a ogni render
  // reinizializzerebbe la connessione a ogni battuta nel campo di testo.
  const transport = useMemo(
    () => new DefaultChatTransport<OmniUIMessage>({ api: '/api/chat' }),
    [],
  );

  const { messages, sendMessage, status, stop, error, setMessages, regenerate, clearError } =
    useChat<OmniUIMessage>({ transport });

  const busy = status === 'submitted' || status === 'streaming';

  const lastMetadata = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'assistant' && message.metadata?.latencyMs !== undefined) {
        return message.metadata;
      }
    }
    return undefined;
  }, [messages]);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    clearError();
    void sendMessage({ text: trimmed });
    setInput('');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* ── Colonna principale: traccia di esecuzione ─────────────────────── */}
      <Card className="flex min-h-[32rem] flex-col lg:min-h-[38rem]">
        <CardHeader
          title="Traccia di esecuzione"
          description="Thought, Tool Call, Observation e Final Output, letti dalla struttura del messaggio."
          action={
            messages.length > 0 ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={() => void regenerate()}
                  disabled={busy}
                  className="px-2 py-1 text-xs"
                  title="Rigenera l'ultima risposta"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Rigenera</span>
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setMessages([])}
                  disabled={busy}
                  className="px-2 py-1 text-xs"
                  title="Svuota la conversazione"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Svuota</span>
                </Button>
              </div>
            ) : undefined
          }
        />

        <div
          className="scrollbar-slim flex-1 space-y-4 overflow-y-auto px-4 py-4"
          aria-live="polite"
          aria-busy={busy}
        >
          {messages.length === 0 ? (
            <EmptyState
              icon={<Bot className="size-5" />}
              title="Nessuna run eseguita"
              description="Scrivi una richiesta o scegli un esempio. Ogni passo del ciclo — ragionamento, chiamata di tool, osservazione — comparirà qui in tempo reale."
            />
          ) : (
            messages.map((message) => <MessageTrace key={message.id} message={message} />)
          )}

          {status === 'submitted' && <RunningIndicator />}
          <div ref={scrollAnchor} />
        </div>

        {error !== undefined && (
          <div
            role="alert"
            className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs leading-relaxed text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">La run non è andata a buon fine</p>
              <p className="mt-0.5 break-words opacity-90">{error.message}</p>
            </div>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
            >
              Chiudi
            </button>
          </div>
        )}

        {/* ── Composer ────────────────────────────────────────────────────── */}
        <div className="border-t border-border p-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(input);
            }}
            className="flex items-end gap-2"
          >
            <label htmlFor="agent-input" className="sr-only">
              Richiesta per l&apos;agente
            </label>
            <textarea
              id="agent-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // Invio spedisce, Maiusc+Invio va a capo: è la convenzione che
                // chiunque abbia usato una chat si aspetta senza doverla imparare.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit(input);
                }
              }}
              rows={2}
              placeholder="Chiedi qualcosa sui documenti o sui sistemi collegati…"
              disabled={busy}
              className="scrollbar-slim max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted disabled:opacity-60"
            />
            {busy ? (
              <Button type="button" variant="secondary" onClick={stop} title="Interrompi la run">
                <Square className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Ferma</span>
              </Button>
            ) : (
              <Button type="submit" disabled={input.trim().length === 0} title="Esegui">
                <ArrowUp className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Esegui</span>
              </Button>
            )}
          </form>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                disabled={busy}
                onClick={() => submit(example.prompt)}
                className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground disabled:opacity-50"
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Colonna laterale: telemetria e strumenti ──────────────────────── */}
      <div className="space-y-4">
        <Card>
          <CardHeader title="Telemetria" description="Misurata lato server sulla run corrente." />
          <div className="p-3">
            <MetricsPanel metadata={lastMetadata} running={busy} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Strumenti dell'agente"
            description="Input tipizzati con Zod; lo schema è il contratto che il modello legge."
          />
          <ul className="divide-y divide-border">
            {AGENT_TOOL_NAMES.map((name) => (
              <li key={name} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-accent">{name}</span>
                  <Badge>{TOOL_LABELS[name]}</Badge>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {TOOL_DESCRIPTIONS[name]}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
