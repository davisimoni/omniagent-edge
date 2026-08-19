import { getEffort, getMaxSteps, getModelId, hasModelCredentials } from '@/lib/ai/model';
import { readEnv } from '@/lib/env';
import { isVectorStoreConfigured } from '@/lib/vector';

/**
 * Diagnostica di configurazione.
 *
 * Riporta *se* ogni dipendenza è configurata, mai *con cosa*: nessun valore di
 * variabile d'ambiente compare nella risposta. Un endpoint di health che espone
 * un frammento di connection string è un endpoint di ricognizione.
 */
export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body = {
    status: 'ok' as const,
    model: {
      configured: hasModelCredentials(),
      id: getModelId(),
      effort: getEffort(),
      maxSteps: getMaxSteps(),
    },
    vectorStore: {
      configured: isVectorStoreConfigured(),
      backend: isVectorStoreConfigured() ? 'pgvector' : 'demo-corpus',
    },
    embeddings: {
      configured: readEnv('EMBEDDINGS_API_URL') !== undefined,
      backend: readEnv('EMBEDDINGS_API_URL') !== undefined ? 'remote' : 'deterministic',
    },
    region: readEnv('VERCEL_REGION') ?? 'local',
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
