import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSafeIdentifier,
  buildSnippet,
  clampTopK,
  cosineSimilarity,
  deterministicEmbedding,
  extractEmbeddingVector,
  InvalidIdentifierError,
  reciprocalRankFusion,
  searchDemoCorpus,
  searchVectorStore,
  toPgVectorLiteral,
  tokenize,
  type FusionBranch,
} from '@/lib/vector';

/**
 * Test del layer RAG.
 *
 * Coprono la parte deterministica — fusione, tokenizzazione, snippet, guardie —
 * più il percorso di degrado, che è quello che gira davvero quando manca una
 * variabile d'ambiente e quindi quello che si rompe più spesso in silenzio.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────
// Reciprocal Rank Fusion
// ─────────────────────────────────────────────────────────────────────────────

interface Doc {
  id: string;
}

const docs = (...ids: string[]): Doc[] => ids.map((id) => ({ id }));

describe('reciprocalRankFusion', () => {
  it('premia il documento trovato da entrambi i rami rispetto a chi guida un solo ramo', () => {
    const branches: FusionBranch<Doc>[] = [
      { label: 'semantic', items: docs('a', 'b', 'c') },
      { label: 'keyword', items: docs('c', 'a', 'd') },
    ];

    const fused = reciprocalRankFusion(branches, (doc) => doc.id, { k: 1 });

    // 'a' compare 1° e 2°, 'c' compare 3° e 1°: entrambi battono chi è in una
    // sola lista, ed è esattamente il comportamento per cui si adotta RRF.
    expect(fused.slice(0, 2).map((entry) => entry.item.id).sort()).toEqual(['a', 'c']);
    expect(fused.at(-1)?.item.id).toBe('d');
  });

  it('registra da quali rami proviene ogni documento', () => {
    const fused = reciprocalRankFusion(
      [
        { label: 'semantic', items: docs('a') },
        { label: 'keyword', items: docs('a', 'b') },
      ],
      (doc) => doc.id,
    );

    expect(fused[0]?.matchedIn).toEqual(['semantic', 'keyword']);
    expect(fused[1]?.matchedIn).toEqual(['keyword']);
  });

  it('applica i pesi di ramo', () => {
    const pesato = reciprocalRankFusion(
      [
        { label: 'semantic', items: docs('a'), weight: 1 },
        { label: 'keyword', items: docs('b'), weight: 0.1 },
      ],
      (doc) => doc.id,
    );

    expect(pesato[0]?.item.id).toBe('a');
    expect(pesato[0]?.score).toBeGreaterThan(pesato[1]?.score ?? 0);
  });

  it('a parità di punteggio conserva l\'ordine di prima apparizione', () => {
    const fused = reciprocalRankFusion(
      [{ label: 'semantic', items: docs('primo', 'secondo', 'terzo') }],
      (doc) => doc.id,
      { k: 0 },
    );

    expect(fused.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(fused[0]?.item.id).toBe('primo');
  });

  it('restituisce una lista vuota senza rami', () => {
    expect(reciprocalRankFusion<Doc>([], (doc) => doc.id)).toEqual([]);
  });

  it('numera i ranghi a partire da 1', () => {
    const fused = reciprocalRankFusion(
      [{ label: 'keyword', items: docs('x', 'y') }],
      (doc) => doc.id,
    );
    expect(fused.map((entry) => entry.rank)).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizzazione ed embedding
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('rimuove i diacritici, così "società" e "societa" collidono', () => {
    expect(tokenize('Società')).toEqual(['societa']);
  });

  it('scarta stopword e token di un solo carattere', () => {
    expect(tokenize('il contratto e la fattura a b')).toEqual(['contratto', 'fattura']);
  });

  it('spezza su punteggiatura e simboli', () => {
    expect(tokenize('SLA-2026/01, rev.3')).toEqual(['sla', '2026', '01', 'rev']);
  });
});

describe('deterministicEmbedding', () => {
  it('produce lo stesso vettore per lo stesso testo', () => {
    expect(deterministicEmbedding('contratto quadro', 64)).toEqual(
      deterministicEmbedding('contratto quadro', 64),
    );
  });

  it('rispetta la dimensione richiesta', () => {
    expect(deterministicEmbedding('qualsiasi testo', 128)).toHaveLength(128);
  });

  it('restituisce un vettore normalizzato', () => {
    const vector = deterministicEmbedding('fatturazione elettronica', 64);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('avvicina varianti morfologiche più di testi non correlati', () => {
    const base = deterministicEmbedding('contratto', 512);
    const variante = deterministicEmbedding('contratti', 512);
    const estraneo = deterministicEmbedding('magazzino', 512);

    expect(cosineSimilarity(base, variante)).toBeGreaterThan(cosineSimilarity(base, estraneo));
  });

  it('su testo senza token utili restituisce un vettore nullo, non NaN', () => {
    const vector = deterministicEmbedding('il la e', 32);
    expect(vector.every((value) => value === 0)).toBe(true);
  });
});

describe('cosineSimilarity', () => {
  it('vale 1 per vettori identici', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('vale 0 per vettori ortogonali', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('vale 0 su lunghezze diverse invece di confrontare a caso', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('vale 0 quando un vettore è nullo, senza dividere per zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snippet e serializzazione
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSnippet', () => {
  it('restituisce il testo intero quando è già abbastanza corto', () => {
    expect(buildSnippet('Testo breve.', 'testo')).toBe('Testo breve.');
  });

  it('normalizza gli spazi multipli', () => {
    expect(buildSnippet('Testo   con\n\nspazi.', 'testo')).toBe('Testo con spazi.');
  });

  it('centra la finestra sul primo termine della query', () => {
    const content = `${'riempimento '.repeat(40)}scadenza contrattuale ${'coda '.repeat(40)}`;
    const snippet = buildSnippet(content, 'scadenza', 120);

    expect(snippet).toContain('scadenza');
    expect(snippet.startsWith('…')).toBe(true);
  });

  it('tronca dall\'inizio quando nessun termine compare nel testo', () => {
    const content = 'a'.repeat(500);
    const snippet = buildSnippet(content, 'inesistente', 100);

    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.startsWith('…')).toBe(false);
  });
});

describe('toPgVectorLiteral', () => {
  it('serializza nel formato atteso da pgvector', () => {
    expect(toPgVectorLiteral([1, -0.5])).toBe('[1.000000,-0.500000]');
  });

  it('sostituisce i valori non finiti con zero anziché produrre SQL non valido', () => {
    expect(toPgVectorLiteral([Number.NaN, Number.POSITIVE_INFINITY])).toBe('[0,0]');
  });
});

describe('extractEmbeddingVector', () => {
  it('legge una risposta compatibile OpenAI', () => {
    expect(extractEmbeddingVector({ data: [{ embedding: [0.1, 0.2] }] })).toEqual([0.1, 0.2]);
  });

  it('rifiuta forme inattese invece di restituire un vettore parziale', () => {
    expect(extractEmbeddingVector({ data: [] })).toBeNull();
    expect(extractEmbeddingVector({ data: [{ embedding: [0.1, 'x'] }] })).toBeNull();
    expect(extractEmbeddingVector(null)).toBeNull();
    expect(extractEmbeddingVector('stringa')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardie
// ─────────────────────────────────────────────────────────────────────────────

describe('assertSafeIdentifier', () => {
  it('accetta un identificatore SQL legittimo', () => {
    expect(assertSafeIdentifier('documents_v2')).toBe('documents_v2');
  });

  it('rifiuta un tentativo di iniezione dal nome della tabella', () => {
    expect(() => assertSafeIdentifier('documents; DROP TABLE users')).toThrow(
      InvalidIdentifierError,
    );
  });

  it('rifiuta un nome che inizia per cifra', () => {
    expect(() => assertSafeIdentifier('1documents')).toThrow(InvalidIdentifierError);
  });
});

describe('clampTopK', () => {
  it('usa il default quando il valore manca o non è un numero', () => {
    expect(clampTopK(undefined)).toBe(5);
    expect(clampTopK(Number.NaN)).toBe(5);
  });

  it('costringe il valore entro i limiti', () => {
    expect(clampTopK(0)).toBe(1);
    expect(clampTopK(999)).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ricerca
// ─────────────────────────────────────────────────────────────────────────────

describe('searchDemoCorpus', () => {
  it('trova il documento pertinente a una domanda sullo SLA', () => {
    const hits = searchDemoCorpus('tempi di risposta garantiti dallo SLA', 3);
    expect(hits[0]?.id).toBe('doc-sla-001');
  });

  it('rispetta il numero di risultati richiesto', () => {
    expect(searchDemoCorpus('cliente', 2)).toHaveLength(2);
  });

  it('non restituisce nulla per una query senza corrispondenze', () => {
    expect(searchDemoCorpus('zqxjvwk', 5)).toEqual([]);
  });

  it('in modalità keyword usa solo il ramo lessicale', () => {
    const hits = searchDemoCorpus('rate limiting', 3, 'keyword');
    expect(hits.every((hit) => hit.matchedIn.every((label) => label === 'keyword'))).toBe(true);
  });
});

describe('searchVectorStore', () => {
  it('senza DATABASE_URL ripiega sul corpus demo e lo dichiara', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const response = await searchVectorStore('procedura di onboarding', { topK: 2 });

    expect(response.backend).toBe('demo-corpus');
    expect(response.degraded).toBe(true);
    // La nota finisce nell'osservazione dell'agente: senza, un dato dimostrativo
    // sarebbe indistinguibile da uno reale.
    expect(response.note).toMatch(/DATABASE_URL/);
    expect(response.hits.length).toBeGreaterThan(0);
  });

  it('filtra i risultati sotto la soglia di punteggio richiesta', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const response = await searchVectorStore('onboarding', { topK: 5, minScore: 1 });
    expect(response.hits).toEqual([]);
  });

  it('riporta sempre una latenza misurabile', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const response = await searchVectorStore('incidenti', { topK: 1 });
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
