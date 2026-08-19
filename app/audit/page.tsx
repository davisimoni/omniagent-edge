import { CircleAlert, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { AuditWorkbench } from '@/components/audit-workbench';
import { SpecBadge } from '@/components/dev-mode/spec-badge';
import { Badge } from '@/components/ui/primitives';
import { getModelId, hasModelCredentials } from '@/lib/ai/model';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';

export const metadata: Metadata = {
  title: 'Audit di conformità',
  description:
    'Verifica automatica di rischi contrattuali, violazioni SLA, clausole penali e lacune GDPR/ISO 27001, con citazione del testo fonte.',
};

export const dynamic = 'force-dynamic';

export default function AuditPage() {
  const modelReady = hasModelCredentials();

  return (
    <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <ShieldCheck className="size-6 text-accent" aria-hidden="true" />
            Audit di conformità fornitori
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
            Rischi contrattuali, violazioni di SLA, clausole penali e lacune GDPR / ISO 27001, con
            citazione del passaggio che genera ogni rilievo. Il punteggio di rischio è calcolato in
            modo deterministico dai rilievi citati: il modello trova le prove, l&apos;aritmetica è
            del sistema.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={modelReady ? 'success' : 'danger'}>
            {modelReady ? getModelId() : 'chiave modello assente'}
          </Badge>
          <Badge tone="accent">{CLAUSE_CATALOG.length} clausole nel catalogo</Badge>
          <SpecBadge id="edge-runtime" />
          <SpecBadge id="prompt-injection" />
        </div>
      </div>

      {!modelReady && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-sm leading-relaxed text-danger print:hidden"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Il modello non è configurato</p>
            <p className="mt-0.5 opacity-90">
              Imposta <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> in{' '}
              <code className="font-mono text-xs">.env.local</code>. Senza chiave l&apos;audit
              risponde 503 con un messaggio esplicito, invece di fallire a metà analisi.
            </p>
          </div>
        </div>
      )}

      <AuditWorkbench />
    </div>
  );
}
