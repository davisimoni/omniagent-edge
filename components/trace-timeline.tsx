'use client';

import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  FileCheck,
  GaugeCircle,
  MessageSquare,
  Play,
  Plug,
  ScanText,
  ShieldAlert,
  Terminal,
  User,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { TOOL_LABELS, type AgentToolName } from '@/lib/agent/tool-metadata';
import { copyToClipboard, cn } from '@/lib/utils';

/**
 * Timeline di esecuzione dell'agente.
 *
 * Rende il ciclo ReAct leggendo la struttura del messaggio, non parsando testo:
 * `reasoning` → Thought, `tool-*` in stato input → Tool Call, lo stesso part in
 * stato output → Observation, `text` → Final Output. È il motivo per cui la
 * rotta imposta `sendReasoning: true`: senza i blocchi di ragionamento la
 * timeline mostrerebbe cosa ha fatto l'agente ma non perché.
 *
 * Le tool call restano ripiegate per impostazione predefinita. L'input e l'output
 * di una ricerca vettoriale sono decine di righe di JSON: aperti tutti insieme
 * seppelliscono la risposta, che è ciò che l'utente sta effettivamente aspettando.
 */

const TOOL_ICONS: Readonly<Record<AgentToolName, typeof Database>> = {
  searchVectorDB: Database,
  extractStructuredData: ScanText,
  fetchExternalAPI: Plug,
  checkContractRisk: ShieldAlert,
  verifySLABreach: GaugeCircle,
  generateAuditReport: FileCheck,
};

function toolLabel(name: string): string {
  return name in TOOL_LABELS ? TOOL_LABELS[name as AgentToolName] : name;
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = name in TOOL_ICONS ? TOOL_ICONS[name as AgentToolName] : Terminal;
  return <Icon className={className} aria-hidden="true" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocchi
// ─────────────────────────────────────────────────────────────────────────────

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = useState(false);
  const serialized = JSON.stringify(value, null, 2) ?? 'undefined';

  const onCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(serialized);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <Copy className="size-3" aria-hidden="true" />
          {copied ? 'Copiato' : 'Copia'}
        </button>
      </div>
      {/* Il JSON può essere largo: scorre dentro il proprio contenitore, così la
          pagina non acquisisce uno scroll orizzontale su mobile. */}
      <pre className="scrollbar-slim max-h-64 overflow-auto rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
        {serialized}
      </pre>
    </div>
  );
}

function TraceStep({
  icon,
  label,
  badge,
  tone = 'neutral',
  defaultOpen = false,
  collapsible = true,
  children,
}: {
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = collapsible ? open : true;

  const toneRing =
    tone === 'accent'
      ? 'border-accent/40 bg-accent-soft text-accent'
      : tone === 'success'
        ? 'border-success/40 bg-success/10 text-success'
        : tone === 'danger'
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-border bg-surface-raised text-muted';

  return (
    <div className="relative pl-8">
      {/* Filo verticale della timeline: puramente decorativo. */}
      <span
        className="absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px bg-border"
        aria-hidden="true"
      />
      <span
        className={cn(
          'absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full border',
          toneRing,
        )}
        aria-hidden="true"
      >
        {icon}
      </span>

      <div className="min-w-0">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={expanded}
            className="group flex w-full items-center gap-1.5 rounded py-0.5 text-left"
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted transition-transform',
                expanded && 'rotate-90',
              )}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold tracking-tight">{label}</span>
            {badge}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="text-xs font-semibold tracking-tight">{label}</span>
            {badge}
          </div>
        )}

        {expanded && <div className="mb-4 mt-1.5 space-y-2">{children}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering di un messaggio
// ─────────────────────────────────────────────────────────────────────────────

function ToolPartView({ part }: { part: Extract<UIMessage['parts'][number], { type: string }> }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  const state = part.state;

  if (state === 'input-streaming' || state === 'input-available') {
    return (
      <TraceStep
        icon={<ToolIcon name={name} className="size-3" />}
        label={`Tool Call · ${toolLabel(name)}`}
        tone="accent"
        defaultOpen={false}
        badge={
          state === 'input-streaming' ? (
            <span className="animate-omni-pulse text-[11px] text-muted">in preparazione…</span>
          ) : (
            <span className="text-[11px] text-muted">in esecuzione…</span>
          )
        }
      >
        <JsonBlock value={part.input ?? {}} label="Input" />
      </TraceStep>
    );
  }

  if (state === 'output-error') {
    return (
      <TraceStep
        icon={<AlertTriangle className="size-3" />}
        label={`Observation · ${toolLabel(name)}`}
        tone="danger"
        defaultOpen
        badge={<span className="text-[11px] text-danger">errore</span>}
      >
        <p className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs leading-relaxed text-danger">
          {part.errorText ?? 'Il tool ha restituito un errore non specificato.'}
        </p>
        <JsonBlock value={part.input ?? {}} label="Input" />
      </TraceStep>
    );
  }

  if (state === 'output-available') {
    const output = part.output as { ok?: unknown; degraded?: unknown; simulated?: unknown } | null;
    const failed = output !== null && typeof output === 'object' && output.ok === false;
    const degraded = output !== null && typeof output === 'object' && output.degraded === true;
    const simulated = output !== null && typeof output === 'object' && output.simulated === true;

    return (
      <TraceStep
        icon={failed ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
        label={`Observation · ${toolLabel(name)}`}
        tone={failed ? 'danger' : 'success'}
        badge={
          <span className="flex items-center gap-1">
            {failed && <span className="text-[11px] text-danger">fallito</span>}
            {degraded && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 text-[10px] font-medium text-warning">
                dati degradati
              </span>
            )}
            {simulated && (
              <span className="rounded-full border border-border bg-surface-raised px-1.5 text-[10px] font-medium text-muted">
                simulato
              </span>
            )}
          </span>
        }
      >
        <JsonBlock value={part.input ?? {}} label="Input" />
        <JsonBlock value={part.output} label="Output" />
      </TraceStep>
    );
  }

  return null;
}

export function MessageTrace({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n');

    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2 rounded-xl rounded-tr-sm border border-border bg-surface-raised px-3 py-2">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          <User className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
        </div>
      </div>
    );
  }

  let stepCounter = 0;

  return (
    <div className="space-y-0">
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;

        if (part.type === 'step-start') {
          stepCounter += 1;
          // Il primo separatore sarebbe una riga vuota in cima: non serve.
          if (stepCounter === 1) return null;
          return (
            <div key={key} className="flex items-center gap-2 py-2 pl-8">
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                Step {stepCounter}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
          );
        }

        if (part.type === 'reasoning') {
          if (part.text.trim().length === 0) return null;
          return (
            <TraceStep
              key={key}
              icon={<Brain className="size-3" />}
              label="Thought"
              tone="neutral"
            >
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface-raised p-2.5 text-xs italic leading-relaxed text-muted">
                {part.text}
              </p>
            </TraceStep>
          );
        }

        if (isToolUIPart(part)) {
          return <ToolPartView key={key} part={part} />;
        }

        if (part.type === 'text') {
          if (part.text.trim().length === 0) return null;
          return (
            <TraceStep
              key={key}
              icon={<MessageSquare className="size-3" />}
              label="Final Output"
              tone="accent"
              collapsible={false}
            >
              <div className="whitespace-pre-wrap rounded-lg border border-accent/25 bg-accent-soft/40 p-3 text-sm leading-relaxed">
                {part.text}
              </div>
            </TraceStep>
          );
        }

        return null;
      })}
    </div>
  );
}

export function RunningIndicator() {
  return (
    <div className="flex items-center gap-2 pl-8 text-xs text-muted">
      <Play className="size-3 animate-omni-pulse" aria-hidden="true" />
      <span className="animate-omni-pulse">L&apos;agente sta ragionando…</span>
    </div>
  );
}
