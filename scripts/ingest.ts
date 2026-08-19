import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { DEMO_CORPUS, type CorpusDocument } from '@/lib/demo-corpus';
import { embedText, getEmbeddingDimensions, getVectorTable, toPgVectorLiteral } from '@/lib/vector';

/**
 * Popolamento del vector store.
 *
 *   npm run db:ingest                 # carica il corpus dimostrativo
 *   npm run db:ingest -- documenti.json
 *
 * Il file JSON deve contenere un array di oggetti
 * `{ id, title, content, source?, metadata? }`.
 *
 * Riusa `embedText` di `lib/vector.ts` anziché reimplementare la chiamata al
 * servizio di embedding. Non è pigrizia: indicizzare con un modello e
 * interrogare con un altro produce un archivio che risponde sempre, sempre a
 * caso — il guasto peggiore possibile per un sistema RAG, perché non somiglia a
 * un guasto.
 */

const ALLOW_LOCAL_FLAG = '--allow-local-embeddings';

interface IngestDocument extends CorpusDocument {
  readonly tenantId?: string;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function loadDocuments(path: string | undefined): Promise<IngestDocument[]> {
  if (path === undefined) return [...DEMO_CORPUS];

  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) fail(`${path} non contiene un array JSON.`);

  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) fail(`Elemento ${index} non è un oggetto.`);
    const candidate = entry as Record<string, unknown>;
    const { id, title, content } = candidate;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof content !== 'string') {
      fail(`Elemento ${index}: servono i campi stringa "id", "title" e "content".`);
    }
    return {
      id,
      title,
      content,
      source: typeof candidate.source === 'string' ? candidate.source : 'ingest',
      metadata: (candidate.metadata ?? {}) as Record<string, string>,
      ...(typeof candidate.tenantId === 'string' ? { tenantId: candidate.tenantId } : {}),
    };
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowLocal = args.includes(ALLOW_LOCAL_FLAG);
  const inputPath = args.find((arg) => !arg.startsWith('--'));

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim().length === 0) {
    fail('DATABASE_URL non è impostata. Vedi .env.example.');
  }

  const documents = await loadDocuments(inputPath);
  console.log(`→ ${documents.length} documenti da indicizzare.`);

  // Sonda su un documento solo: se l'embedder è quello locale deterministico,
  // l'archivio finirebbe in uno spazio vettoriale diverso da quello usato in
  // interrogazione, e ogni ricerca restituirebbe risultati plausibili e casuali.
  const probe = await embedText(documents[0]?.content ?? 'sonda');
  if (probe.backend === 'deterministic' && !allowLocal) {
    fail(
      'EMBEDDINGS_API_URL non è configurata: l\'indicizzazione userebbe l\'embedder ' +
        'locale deterministico, che non è lo stesso spazio vettoriale usato in ' +
        `produzione. Configura il servizio di embedding, oppure passa ${ALLOW_LOCAL_FLAG} ` +
        'se stai facendo una prova end-to-end in locale.',
    );
  }

  const expected = getEmbeddingDimensions();
  if (probe.vector.length !== expected) {
    fail(
      `Il modello "${probe.model}" produce vettori a ${probe.vector.length} dimensioni, ` +
        `ma EMBEDDING_DIMENSIONS vale ${expected} e la colonna è dichiarata di ` +
        'conseguenza in db/schema.sql. Allinea i due valori prima di procedere.',
    );
  }

  const table = getVectorTable();
  const sql = neon(connectionString);
  let indexed = 0;

  for (const document of documents) {
    const embedding = await embedText(`${document.title}\n\n${document.content}`);
    await sql.query(
      `INSERT INTO ${table} (id, title, content, source, tenant_id, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         source = EXCLUDED.source,
         metadata = EXCLUDED.metadata,
         embedding = EXCLUDED.embedding`,
      [
        document.id,
        document.title,
        document.content,
        document.source,
        document.tenantId ?? 'public',
        JSON.stringify(document.metadata),
        toPgVectorLiteral(embedding.vector),
      ],
    );
    indexed += 1;
    process.stdout.write(`\r  indicizzati ${indexed}/${documents.length}`);
  }

  console.log(`\n✓ Fatto. Modello di embedding: ${probe.model} (${expected} dimensioni).`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
