import { CircleAlert, Database, KeyRound, Sparkles } from 'lucide-react';
import { AgentConsole } from '@/components/agent-console';
import { Badge } from '@/components/ui/primitives';
import { getEffort, getMaxSteps, getModelId, hasModelCredentials } from '@/lib/ai/model';
import { readEnv } from '@/lib/env';
import { isVectorStoreConfigured } from '@/lib/vector';

/**
 * Dashboard.
 *
 * Server component: legge la configurazione a runtime e la dichiara in testa alla
 * pagina. Una demo che non dice quali dipendenze le mancano lascia l'utente a
 * chiedersi se un risultato scarso sia colpa del modello o di una variabile
 * d'ambiente non impostata.
 */
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const modelReady = hasModelCredentials();
  const vectorReady = isVectorStoreConfigured();
  const embeddingsReady = readEnv('EMBEDDINGS_API_URL') !== undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Console dell&apos;agente
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Un agente ReAct che pianifica, chiama strumenti tipizzati e osserva i risultati finché
            non ha di che rispondere. Ogni passo del ciclo è visibile qui sotto, con latenza, token
            e costo stimato della run.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={modelReady ? 'success' : 'danger'}>
            <KeyRound className="size-3" aria-hidden="true" />
            {modelReady ? getModelId() : 'chiave modello assente'}
          </Badge>
          <Badge tone={vectorReady ? 'success' : 'warning'}>
            <Database className="size-3" aria-hidden="true" />
            {vectorReady ? 'pgvector' : 'corpus demo'}
          </Badge>
          <Badge tone="accent">
            <Sparkles className="size-3" aria-hidden="true" />
            effort {getEffort()} · max {getMaxSteps()} step
          </Badge>
        </div>
      </div>

      {!modelReady && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-sm leading-relaxed text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Il modello non è configurato</p>
            <p className="mt-0.5 opacity-90">
              Copia <code className="font-mono text-xs">.env.example</code> in{' '}
              <code className="font-mono text-xs">.env.local</code> e imposta{' '}
              <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>. Finché manca, le run
              rispondono 503 anziché fallire a metà stream.
            </p>
          </div>
        </div>
      )}

      {modelReady && !vectorReady && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-sm leading-relaxed text-warning"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Vector store non collegato — la demo funziona lo stesso</p>
            <p className="mt-0.5 opacity-90">
              Senza <code className="font-mono text-xs">DATABASE_URL</code> la ricerca usa il corpus
              dimostrativo in memoria{embeddingsReady ? '' : ' con embedding deterministici locali'}.
              I risultati sono marcati <code className="font-mono text-xs">degraded</code> nella
              traccia e l&apos;agente è istruito a dichiararlo: nessun dato finto passa per reale.
            </p>
          </div>
        </div>
      )}

      <AgentConsole />
    </div>
  );
}
