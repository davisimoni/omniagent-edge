import { neon } from '@neondatabase/serverless';
import { DEMO_CORPUS, type CorpusDocument } from '@/lib/demo-corpus';
import { isProduction, readEnv, readEnvInt } from '@/lib/env';
import { fnv1a } from '@/lib/hash';

export { fnv1a };

/**
 * Edge RAG — ricerca ibrida su PostgreSQL + pgvector.
 *
 * Tre vincoli guidano il progetto di questo modulo:
 *
 * 1. **Edge runtime.** Nessun socket TCP: il driver Neon parla HTTP via `fetch`,
 *    l'unico trasporto disponibile in un isolate Edge. I due rami della ricerca
 *    viaggiano in un'unica transazione, quindi un solo round trip di rete — su
 *    Edge la latenza di rete pesa più dell'esecuzione delle query.
 * 2. **Nessun risultato inventato.** Senza database la ricerca ripiega sul corpus
 *    dimostrativo, ma il ripiego è dichiarato (`backend`, `degraded`, `note`)
 *    fino alla UI e all'osservazione che legge l'agente.
 * 3. **Logica di fusione pura.** RRF, snippet e tokenizzazione non toccano rete
 *    né database: sono la parte che i test coprono davvero.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipi pubblici
// ─────────────────────────────────────────────────────────────────────────────

export type RetrievalMode = 'hybrid' | 'semantic' | 'keyword';
export type RetrievalBackend = 'pgvector' | 'demo-corpus';
export type EmbeddingBackend = 'remote' | 'deterministic';
export type BranchLabel = Exclude<RetrievalMode, 'hybrid'>;

export interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly source: string;
  /** Punteggio di fusione RRF: comparabile fra risultati della stessa run, non fra run diverse. */
  readonly score: number;
  readonly rank: number;
  /** Da quali rami della ricerca proviene il documento. */
  readonly matchedIn: readonly BranchLabel[];
}

export interface SearchResponse {
  readonly hits: readonly SearchHit[];
  readonly mode: RetrievalMode;
  readonly backend: RetrievalBackend;
  readonly embeddingBackend: EmbeddingBackend | null;
  readonly latencyMs: number;
  /** True quando la risposta NON viene da un vector store reale. */
  readonly degraded: boolean;
  /** Spiegazione leggibile del degrado, destinata sia alla UI sia all'agente. */
  readonly note?: string;
}

export interface SearchOptions {
  readonly topK?: number;
  readonly mode?: RetrievalMode;
  readonly tenantId?: string;
  readonly minScore?: number;
}

export class InvalidIdentifierError extends Error {
  readonly code = 'invalid_identifier';
  constructor(value: string) {
    super(`Identificatore SQL non valido: "${value}". Ammessi solo [A-Za-z_][A-Za-z0-9_]*.`);
    this.name = 'InvalidIdentifierError';
  }
}

export class EmbeddingProviderUnavailableError extends Error {
  readonly code = 'embedding_provider_unavailable';
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingProviderUnavailableError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configurazione
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;
export const DEFAULT_DIMENSIONS = 1024;
/** Costante di smorzamento RRF. 60 è il valore dell'articolo originale di Cormack et al. */
export const RRF_K = 60;

const EMBEDDING_TIMEOUT_MS = 8_000;
const QUERY_TIMEOUT_MS = 10_000;

export function isVectorStoreConfigured(): boolean {
  return readEnv('DATABASE_URL') !== undefined;
}

export function getEmbeddingDimensions(): number {
  return readEnvInt('EMBEDDING_DIMENSIONS', DEFAULT_DIMENSIONS, 8, 4096);
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Convalida un identificatore SQL prima di interpolarlo.
 *
 * Il nome della tabella arriva dall'ambiente e non può essere un parametro
 * associato: PostgreSQL non accetta placeholder al posto di un identificatore.
 * Interpolare senza convalidare renderebbe `VECTOR_TABLE` un'iniezione SQL a
 * disposizione di chiunque controlli le variabili di deploy.
 */
export function assertSafeIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new InvalidIdentifierError(value);
  return value;
}

export function getVectorTable(): string {
  return assertSafeIdentifier(readEnv('VECTOR_TABLE') ?? 'documents');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizzazione (pura)
// ─────────────────────────────────────────────────────────────────────────────

/** Stopword italiane e inglesi: poche e ad alta frequenza, per non svuotare query brevi. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'il', 'lo', 'la', 'gli', 'le', 'un', 'uno', 'una', 'di', 'da', 'in', 'con', 'su', 'per',
  'tra', 'fra', 'ed', 'ma', 'se', 'che', 'chi', 'cui', 'non', 'come', 'dove', 'quando',
  'quale', 'quali', 'del', 'della', 'dei', 'delle', 'degli', 'al', 'allo', 'alla', 'ai',
  'agli', 'alle', 'dal', 'dalla', 'nel', 'nella', 'sul', 'sulla', 'sono', 'essere', 'ha',
  'hanno', 'the', 'an', 'of', 'to', 'on', 'for', 'and', 'or', 'but', 'if', 'is', 'are',
  'was', 'were', 'be', 'been', 'with', 'as', 'at', 'by', 'it', 'this', 'that',
]);

/** Intervallo Unicode dei segni diacritici combinanti, rimossi dopo la normalizzazione NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Normalizza, rimuove i diacritici e scarta stopword e token troppo corti. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function l2Normalize(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

/**
 * Embedding deterministico locale (hashing trick).
 *
 * Non è un modello: è una proiezione stabile di token in `dimensions` bucket con
 * segno, sufficiente a far funzionare demo e test senza chiavi né rete. Ogni
 * token contribuisce anche con il proprio prefisso a peso ridotto, così varianti
 * morfologiche italiane ("contratto"/"contratti") restano vicine.
 *
 * Non è mai attivo in produzione: `embedText` lo esclude esplicitamente.
 */
export function deterministicEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  const bump = (key: string, weight: number): void => {
    const index = fnv1a(key) % dimensions;
    const sign = (fnv1a(`${key}#sign`) & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign * weight;
  };

  for (const token of tokens) {
    bump(token, 1);
    if (token.length > 4) bump(token.slice(0, 4), 0.35);
  }

  return l2Normalize(vector);
}

/** Similarità coseno; `0` per vettori vuoti, di lunghezza diversa o nulli. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  readonly vector: number[];
  readonly backend: EmbeddingBackend;
  readonly model: string;
  readonly dimensions: number;
}

/** Estrae `data[0].embedding` da una risposta compatibile OpenAI, senza fidarsi della forma. */
export function extractEmbeddingVector(payload: unknown): number[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first: unknown = data[0];
  if (typeof first !== 'object' || first === null) return null;
  const embedding = (first as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const vector = embedding.filter((value): value is number => typeof value === 'number');
  return vector.length === embedding.length ? vector : null;
}

/**
 * Genera l'embedding di un testo.
 *
 * Anthropic non espone un endpoint di embedding: questo è un seam agnostico
 * rispetto al fornitore. Con `EMBEDDINGS_API_URL` configurata parla con qualunque
 * endpoint compatibile OpenAI (Voyage, Mistral, gateway self-hosted); senza
 * configurazione ripiega sull'embedder deterministico — ma solo fuori produzione.
 *
 * In produzione senza configurazione **lancia**: un embedding finto produrrebbe
 * risultati plausibili e sbagliati, che è il modo peggiore in cui un sistema RAG
 * può rompersi, perché nessuno se ne accorge.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const dimensions = getEmbeddingDimensions();
  const endpoint = readEnv('EMBEDDINGS_API_URL');
  const apiKey = readEnv('EMBEDDINGS_API_KEY');
  const model = readEnv('EMBEDDINGS_MODEL') ?? 'voyage-3-lite';

  if (endpoint === undefined) {
    if (isProduction()) {
      throw new EmbeddingProviderUnavailableError(
        'EMBEDDINGS_API_URL non è configurata. In produzione la ricerca semantica è ' +
          'disattivata anziché ripiegare su un embedder locale: risultati plausibili ma ' +
          'privi di significato sarebbero peggio di nessun risultato.',
      );
    }
    return {
      vector: deterministicEmbedding(text, dimensions),
      backend: 'deterministic',
      model: 'local-hashing',
      dimensions,
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Il corpo dell'errore può contenere la richiesta in eco: non lo propaghiamo.
    throw new EmbeddingProviderUnavailableError(
      `Il servizio di embedding ha risposto ${response.status}. ` +
        'Verifica EMBEDDINGS_API_URL e EMBEDDINGS_API_KEY.',
    );
  }

  const payload: unknown = await response.json();
  const vector = extractEmbeddingVector(payload);
  if (vector === null) {
    throw new EmbeddingProviderUnavailableError(
      'Risposta del servizio di embedding in formato inatteso: manca `data[0].embedding`.',
    );
  }

  return { vector, backend: 'remote', model, dimensions: vector.length };
}

/** Serializza un vettore nel formato letterale di pgvector. */
export function toPgVectorLiteral(vector: readonly number[]): string {
  const parts = vector.map((value) => (Number.isFinite(value) ? value.toFixed(6) : '0'));
  return `[${parts.join(',')}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reciprocal Rank Fusion (pura)
// ─────────────────────────────────────────────────────────────────────────────

export interface FusionBranch<T> {
  readonly label: BranchLabel;
  /** Elementi già ordinati per rilevanza decrescente all'interno del ramo. */
  readonly items: readonly T[];
  /** Peso del ramo nella fusione. Default 1. */
  readonly weight?: number;
}

export interface FusedItem<T> {
  readonly item: T;
  readonly score: number;
  readonly rank: number;
  readonly matchedIn: readonly BranchLabel[];
}

/**
 * Fonde più liste ordinate con Reciprocal Rank Fusion.
 *
 * RRF somma `peso / (k + posizione)` invece dei punteggi grezzi, e questo è il
 * punto: distanza coseno e `ts_rank` vivono su scale incomparabili, e nessuna
 * normalizzazione lineare le rende sommabili in modo sensato. La posizione in
 * classifica, sì.
 *
 * A parità di punteggio l'ordine resta quello di prima apparizione, così la
 * funzione è deterministica e i test non dipendono dalla stabilità di `sort`.
 */
export function reciprocalRankFusion<T>(
  branches: readonly FusionBranch<T>[],
  identify: (item: T) => string,
  options: { readonly k?: number } = {},
): FusedItem<T>[] {
  const k = options.k ?? RRF_K;

  interface Accumulator {
    item: T;
    score: number;
    matchedIn: BranchLabel[];
    firstSeen: number;
  }

  const accumulators = new Map<string, Accumulator>();
  let insertionCounter = 0;

  for (const branch of branches) {
    const weight = branch.weight ?? 1;
    branch.items.forEach((item, index) => {
      const id = identify(item);
      const contribution = weight / (k + index + 1);
      const existing = accumulators.get(id);
      if (existing === undefined) {
        accumulators.set(id, {
          item,
          score: contribution,
          matchedIn: [branch.label],
          firstSeen: insertionCounter,
        });
        insertionCounter += 1;
        return;
      }
      existing.score += contribution;
      if (!existing.matchedIn.includes(branch.label)) existing.matchedIn.push(branch.label);
    });
  }

  return [...accumulators.values()]
    .sort((a, b) => (b.score === a.score ? a.firstSeen - b.firstSeen : b.score - a.score))
    .map((entry, index) => ({
      item: entry.item,
      score: Math.round(entry.score * 1_000_000) / 1_000_000,
      rank: index + 1,
      matchedIn: entry.matchedIn,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Snippet (pura)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ritaglia dal contenuto una finestra centrata sul primo termine della query.
 *
 * Il taglio avviene su confine di parola: uno snippet che inizia a metà di una
 * parola costa credibilità all'agente che lo cita.
 */
export function buildSnippet(content: string, query: string, maxLength = 260): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const haystack = normalized.toLowerCase();
  let anchor = -1;
  for (const term of tokenize(query)) {
    const found = haystack.indexOf(term);
    if (found !== -1 && (anchor === -1 || found < anchor)) anchor = found;
  }

  if (anchor === -1) return `${normalized.slice(0, maxLength).trimEnd()}…`;

  const half = Math.floor(maxLength / 2);
  let start = Math.max(0, anchor - half);
  let end = Math.min(normalized.length, start + maxLength);

  if (start > 0) {
    const boundary = normalized.indexOf(' ', start);
    if (boundary !== -1 && boundary < start + 30) start = boundary + 1;
  }
  if (end < normalized.length) {
    const boundary = normalized.lastIndexOf(' ', end);
    if (boundary > start) end = boundary;
  }

  const core = normalized.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${core}${end < normalized.length ? '…' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ricerca su pgvector
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
}

function toDocumentRows(rows: unknown): DocumentRow[] {
  if (!Array.isArray(rows)) return [];
  const mapped: DocumentRow[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const candidate = row as Record<string, unknown>;
    if (typeof candidate.id !== 'string') continue;
    mapped.push({
      id: candidate.id,
      title: typeof candidate.title === 'string' ? candidate.title : '(senza titolo)',
      content: typeof candidate.content === 'string' ? candidate.content : '',
      source: typeof candidate.source === 'string' ? candidate.source : 'unknown',
    });
  }
  return mapped;
}

function toSearchHits<T extends { id: string; title: string; content: string; source: string }>(
  fused: readonly FusedItem<T>[],
  query: string,
): SearchHit[] {
  return fused.map((entry) => ({
    id: entry.item.id,
    title: entry.item.title,
    snippet: buildSnippet(entry.item.content, query),
    source: entry.item.source,
    score: entry.score,
    rank: entry.rank,
    matchedIn: entry.matchedIn,
  }));
}

const SEMANTIC_SQL = (table: string): string => `
  SELECT id, title, content, source
  FROM ${table}
  WHERE tenant_id = $2 AND embedding IS NOT NULL
  ORDER BY embedding <=> $1::vector
  LIMIT $3`;

const KEYWORD_SQL = (table: string): string => `
  SELECT id, title, content, source
  FROM ${table}
  WHERE tenant_id = $2 AND tsv @@ websearch_to_tsquery('simple', $1)
  ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('simple', $1)) DESC
  LIMIT $3`;

async function searchPgVector(
  query: string,
  mode: RetrievalMode,
  topK: number,
  tenantId: string,
): Promise<{ hits: SearchHit[]; embeddingBackend: EmbeddingBackend | null }> {
  const connectionString = readEnv('DATABASE_URL');
  if (connectionString === undefined) throw new Error('DATABASE_URL non configurata.');

  const table = getVectorTable();
  const sql = neon(connectionString, {
    fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) },
  });

  // Sovra-campionamento: la fusione ha bisogno di più candidati per ramo di quanti
  // ne restituirà, o i documenti trovati da un solo ramo sparirebbero dalla coda.
  const candidateLimit = Math.min(MAX_TOP_K * 2, Math.max(topK * 3, topK + 5));

  const wantsSemantic = mode === 'hybrid' || mode === 'semantic';
  const wantsKeyword = mode === 'hybrid' || mode === 'keyword';

  let embeddingBackend: EmbeddingBackend | null = null;
  const branches: FusionBranch<DocumentRow>[] = [];

  if (wantsSemantic && wantsKeyword) {
    const embedding = await embedText(query);
    embeddingBackend = embedding.backend;
    // Una sola transazione = un solo round trip HTTP.
    const [semanticRows, keywordRows] = await sql.transaction([
      sql.query(SEMANTIC_SQL(table), [
        toPgVectorLiteral(embedding.vector),
        tenantId,
        candidateLimit,
      ]),
      sql.query(KEYWORD_SQL(table), [query, tenantId, candidateLimit]),
    ]);
    branches.push(
      { label: 'semantic', items: toDocumentRows(semanticRows), weight: 1 },
      { label: 'keyword', items: toDocumentRows(keywordRows), weight: 0.8 },
    );
  } else if (wantsSemantic) {
    const embedding = await embedText(query);
    embeddingBackend = embedding.backend;
    const rows = await sql.query(SEMANTIC_SQL(table), [
      toPgVectorLiteral(embedding.vector),
      tenantId,
      candidateLimit,
    ]);
    branches.push({ label: 'semantic', items: toDocumentRows(rows) });
  } else {
    const rows = await sql.query(KEYWORD_SQL(table), [query, tenantId, candidateLimit]);
    branches.push({ label: 'keyword', items: toDocumentRows(rows) });
  }

  const fused = reciprocalRankFusion(branches, (row) => row.id).slice(0, topK);
  return { hits: toSearchHits(fused, query), embeddingBackend };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ricerca sul corpus dimostrativo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dimensionalità del corpus in-memory.
 *
 * Non è un numero scelto a caso. Con l'hashing trick le collisioni fra bucket
 * producono similarità spurie, e su 256 dimensioni una query priva di senso
 * ("zqxjvwk") otteneva un punteggio positivo su metà del corpus: la demo avrebbe
 * restituito documenti irrilevanti a *qualunque* domanda, e l'agente li avrebbe
 * citati. A 4096 le collisioni spariscono — le query senza corrispondenza vanno
 * a zero secco — mentre quelle pertinenti restano fra 0.16 e 0.40. È il motivo
 * per cui il filtro qui sotto può essere il semplice `score > 0` invece di una
 * soglia arbitraria da tarare.
 */
const DEMO_DIMENSIONS = 4096;

/**
 * Embedding del corpus, calcolati una volta per array.
 *
 * A 4096 dimensioni ricalcolarli a ogni query sarebbe uno spreco misurabile.
 * La chiave è l'identità dell'array, così anche un corpus iniettato dai test
 * viene memoizzato senza che la cache del corpus reale ne risenta.
 */
const corpusEmbeddingCache = new WeakMap<readonly CorpusDocument[], number[][]>();

function corpusEmbeddings(corpus: readonly CorpusDocument[]): number[][] {
  const cached = corpusEmbeddingCache.get(corpus);
  if (cached !== undefined) return cached;
  const computed = corpus.map((doc) =>
    deterministicEmbedding(`${doc.title} ${doc.content}`, DEMO_DIMENSIONS),
  );
  corpusEmbeddingCache.set(corpus, computed);
  return computed;
}

/** Replica in memoria la stessa fusione a due rami applicata su pgvector. */
export function searchDemoCorpus(
  query: string,
  topK: number,
  mode: RetrievalMode = 'hybrid',
  corpus: readonly CorpusDocument[] = DEMO_CORPUS,
): SearchHit[] {
  const queryVector = deterministicEmbedding(query, DEMO_DIMENSIONS);
  const queryTokens = tokenize(query);
  const embeddings = corpusEmbeddings(corpus);

  const semantic = corpus
    .map((doc, index) => ({
      doc,
      score: cosineSimilarity(queryVector, embeddings[index] ?? []),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.doc);

  const keyword = corpus
    .map((doc) => {
      const haystack = tokenize(`${doc.title} ${doc.content}`);
      const matches = queryTokens.filter((token) =>
        haystack.some((word) => word === token || word.startsWith(token)),
      ).length;
      return { doc, matches };
    })
    .filter((entry) => entry.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .map((entry) => entry.doc);

  const branches: FusionBranch<CorpusDocument>[] = [];
  if (mode === 'hybrid' || mode === 'semantic') {
    branches.push({ label: 'semantic', items: semantic, weight: 1 });
  }
  if (mode === 'hybrid' || mode === 'keyword') {
    branches.push({ label: 'keyword', items: keyword, weight: 0.8 });
  }

  const fused = reciprocalRankFusion(branches, (doc) => doc.id).slice(0, topK);
  return toSearchHits(fused, query);
}

// ─────────────────────────────────────────────────────────────────────────────
// Punto d'ingresso
// ─────────────────────────────────────────────────────────────────────────────

export function clampTopK(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOP_K;
  return Math.min(MAX_TOP_K, Math.max(1, Math.round(value)));
}

/**
 * Esegue la ricerca ibrida.
 *
 * Non lancia mai per un guasto dell'infrastruttura: un vector store irraggiungibile
 * deve diventare un'osservazione che l'agente può leggere e riferire, non
 * un'eccezione che interrompe uno stream già iniziato.
 */
export async function searchVectorStore(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const mode = options.mode ?? 'hybrid';
  const topK = clampTopK(options.topK);
  const tenantId = options.tenantId ?? 'public';
  const minScore = options.minScore ?? 0;

  const finalize = (
    hits: readonly SearchHit[],
    backend: RetrievalBackend,
    embeddingBackend: EmbeddingBackend | null,
    note?: string,
  ): SearchResponse => ({
    hits: hits.filter((hit) => hit.score >= minScore),
    mode,
    backend,
    embeddingBackend,
    latencyMs: Date.now() - startedAt,
    degraded: backend !== 'pgvector',
    ...(note !== undefined ? { note } : {}),
  });

  if (!isVectorStoreConfigured()) {
    return finalize(
      searchDemoCorpus(query, topK, mode),
      'demo-corpus',
      'deterministic',
      'DATABASE_URL non è configurata: i risultati provengono dal corpus dimostrativo ' +
        'in-memory, non da un vector store reale. Dichiaralo se citi queste fonti.',
    );
  }

  try {
    const { hits, embeddingBackend } = await searchPgVector(query, mode, topK, tenantId);
    return finalize(hits, 'pgvector', embeddingBackend);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'errore sconosciuto';
    return finalize(
      searchDemoCorpus(query, topK, mode),
      'demo-corpus',
      'deterministic',
      `Il vector store non ha risposto (${reason}). Risultati dal corpus dimostrativo: ` +
        'trattali come non autorevoli.',
    );
  }
}
