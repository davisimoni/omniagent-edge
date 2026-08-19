'use client';

import { Activity, Coins, Cpu, Gauge, Layers, Timer, Wrench, Zap } from 'lucide-react';
import { Badge, StatTile } from '@/components/ui/primitives';
import { formatCostUsd, formatLatency, formatTokens } from '@/lib/metrics';
import type { ChatMessageMetadata } from '@/lib/schemas';

/**
 * Pannello di telemetria della run.
 *
 * I valori arrivano dal server allegati al messaggio in streaming: sono gli
 * stessi numeri che il provider ha riportato, non una stima ricalcolata sul
 * client — che divergerebbe al primo cambio di tokenizzatore.
 *
 * Il costo resta dichiarato come stima: il dato fatturato è quello di Anthropic,
 * e il prompt caching può spostarlo verso il basso rispetto al listino pieno.
 */
export function MetricsPanel({
  metadata,
  running,
}: {
  metadata: ChatMessageMetadata | undefined;
  running: boolean;
}) {
  const hasData = metadata?.latencyMs !== undefined;

  if (!hasData) {
    return (
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {['Latenza', 'Token', 'Costo stimato', 'Step'].map((label) => (
          <StatTile
            key={label}
            label={label}
            value={running ? <span className="animate-omni-pulse">…</span> : '—'}
            hint={running ? 'run in corso' : 'nessuna run'}
          />
        ))}
      </div>
    );
  }

  const {
    latencyMs = 0,
    timeToFirstTokenMs,
    totalTokens = 0,
    inputTokens = 0,
    outputTokens = 0,
    reasoningTokens = 0,
    cachedInputTokens = 0,
    costUsd = null,
    steps = 0,
    toolCalls = 0,
    modelId,
    finishReason,
  } = metadata;

  const throughput =
    latencyMs >= 50 && outputTokens > 0
      ? Math.round((outputTokens / (latencyMs / 1000)) * 10) / 10
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          label="Latenza"
          value={formatLatency(latencyMs)}
          hint={
            timeToFirstTokenMs !== null && timeToFirstTokenMs !== undefined
              ? `primo token a ${formatLatency(timeToFirstTokenMs)}`
              : 'end-to-end'
          }
          tone="accent"
        />
        <StatTile
          label="Token"
          value={formatTokens(totalTokens)}
          hint={`${formatTokens(inputTokens)} in · ${formatTokens(outputTokens)} out`}
        />
        <StatTile
          label="Costo stimato"
          value={formatCostUsd(costUsd)}
          hint={costUsd === null ? 'listino non noto' : 'stima da listino'}
        />
        <StatTile
          label="Step ReAct"
          value={steps}
          hint={`${toolCalls} tool call`}
          tone={steps > 1 ? 'accent' : 'neutral'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {modelId !== undefined && (
          <Badge tone="accent">
            <Cpu className="size-3" aria-hidden="true" />
            {modelId}
          </Badge>
        )}
        {throughput !== null && (
          <Badge>
            <Zap className="size-3" aria-hidden="true" />
            {throughput} tok/s
          </Badge>
        )}
        {reasoningTokens > 0 && (
          <Badge>
            <Activity className="size-3" aria-hidden="true" />
            {formatTokens(reasoningTokens)} reasoning
          </Badge>
        )}
        {cachedInputTokens > 0 && (
          <Badge tone="success">
            <Layers className="size-3" aria-hidden="true" />
            {formatTokens(cachedInputTokens)} da cache
          </Badge>
        )}
        {toolCalls > 0 && (
          <Badge>
            <Wrench className="size-3" aria-hidden="true" />
            {toolCalls} tool call
          </Badge>
        )}
        {finishReason !== null && finishReason !== undefined && (
          <Badge tone={finishReason === 'stop' ? 'neutral' : 'warning'}>
            <Gauge className="size-3" aria-hidden="true" />
            {finishReason}
          </Badge>
        )}
        <Badge>
          <Timer className="size-3" aria-hidden="true" />
          Edge · fra1
        </Badge>
        <Badge>
          <Coins className="size-3" aria-hidden="true" />
          stima, non fatturato
        </Badge>
      </div>
    </div>
  );
}
