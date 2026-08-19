import type { Metadata } from 'next';
import { ExtractorWorkbench } from '@/components/extractor-workbench';
import { Badge } from '@/components/ui/primitives';
import { getModelId, hasModelCredentials } from '@/lib/ai/model';

export const metadata: Metadata = {
  title: 'Estrattore strutturato',
  description:
    'Da testo o documento a JSON validato: entità con citazione a supporto, campi salienti e informazioni non determinabili.',
};

export const dynamic = 'force-dynamic';

export default function ExtractorPage() {
  const modelReady = hasModelCredentials();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Estrattore strutturato
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Da documento a JSON conforme a uno schema Zod. Ogni entità porta con sé la citazione
            letterale che la giustifica, e ciò che il documento non dice finisce fra le domande
            aperte anziché essere colmato con una supposizione.
          </p>
        </div>
        <Badge tone={modelReady ? 'success' : 'danger'}>
          {modelReady ? getModelId() : 'chiave modello assente'}
        </Badge>
      </div>

      <ExtractorWorkbench />
    </div>
  );
}
