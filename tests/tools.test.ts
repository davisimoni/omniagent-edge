import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionOptions } from 'ai';
import { AGENT_TOOL_NAMES, TOOL_LABELS } from '@/lib/agent/tool-metadata';
import {
  createAgentTools,
  extractStructuredDataInput,
  fetchExternalApiInput,
  searchVectorDbInput,
  type ToolDependencies,
} from '@/lib/agent/tools';
import type { ExtractOutcome } from '@/lib/ai/extract';
import { EMPTY_USAGE } from '@/lib/metrics';
import type { SearchResponse } from '@/lib/vector';

/**
 * Test dei tool dell'agente.
 *
 * Nessuna rete, nessun database, nessuna chiamata al modello: `createAgentTools`
 * accetta dipendenze sostituibili, e ciò che qui si verifica è esattamente ciò
 * che il loop ReAct esegue in produzione — lo stesso `execute`, lo stesso schema.
 */

/**
 * `execute` riceve un secondo argomento che l'SDK popola durante la run. I tool
 * di questo progetto non lo leggono, quindi un oggetto minimo basta; il cast è
 * confinato qui invece di ripetersi in ogni test.
 */
const EXEC_OPTIONS = {
  toolCallId: 'test-call',
  messages: [],
} as unknown as ToolExecutionOptions<never>;

function searchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    hits: [
      {
        id: 'doc-1',
        title: 'SLA Enterprise',
        snippet: 'Primo riscontro entro 1 ora per la severità 1.',
        source: 'contracts/sla.md',
        score: 0.031,
        rank: 1,
        matchedIn: ['semantic', 'keyword'],
      },
    ],
    mode: 'hybrid',
    backend: 'pgvector',
    embeddingBackend: 'remote',
    latencyMs: 42,
    degraded: false,
    ...overrides,
  };
}

function extractOutcome(): ExtractOutcome {
  return {
    data: {
      documentType: 'fattura',
      language: 'it',
      title: 'Fattura 2026/318',
      summary: 'Fattura da Rossi Logistica a Delta Energia.',
      entities: [
        {
          type: 'monetary_amount',
          value: '5.185,00 EUR',
          normalized: '5185.00',
          confidence: 0.95,
          evidence: 'totale 5.185,00 EUR',
        },
      ],
      keyFields: [{ key: 'numero_fattura', value: '2026/318', confidence: 1 }],
      openQuestions: [],
      overallConfidence: 0.9,
    },
    modelId: 'claude-opus-5',
    usage: { ...EMPTY_USAGE, inputTokens: 120, outputTokens: 80 },
    latencyMs: 900,
    finishReason: 'stop',
  };
}

function tools(overrides: Partial<ToolDependencies> = {}, tenantId = 'public') {
  return createAgentTools({ tenantId }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

describe('registro dei tool', () => {
  it('espone esattamente i tre tool dichiarati nei metadati della UI', () => {
    expect(Object.keys(tools()).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it('assegna a ogni tool una descrizione: è il contratto che legge il modello', () => {
    for (const definition of Object.values(tools())) {
      expect(definition.description).toBeTypeOf('string');
      expect((definition.description ?? '').length).toBeGreaterThan(60);
    }
  });

  it('mantiene un\'etichetta leggibile per ogni tool', () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(TOOL_LABELS[name]).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// searchVectorDB
// ─────────────────────────────────────────────────────────────────────────────

describe('searchVectorDB — schema di input', () => {
  it('rifiuta una query troppo corta', () => {
    expect(searchVectorDbInput.safeParse({ query: 'ab' }).success).toBe(false);
  });

  it('applica i default: ricerca ibrida, cinque risultati', () => {
    const parsed = searchVectorDbInput.parse({ query: 'tempi di risposta SLA' });
    expect(parsed.mode).toBe('hybrid');
    expect(parsed.topK).toBe(5);
  });

  it('rifiuta un topK oltre il tetto invece di troncarlo in silenzio', () => {
    expect(searchVectorDbInput.safeParse({ query: 'contratti', topK: 500 }).success).toBe(false);
  });

  it('rifiuta una modalità di ricerca non prevista', () => {
    expect(searchVectorDbInput.safeParse({ query: 'contratti', mode: 'fuzzy' }).success).toBe(false);
  });
});

describe('searchVectorDB — esecuzione', () => {
  it('restituisce i risultati con rango, fonte e punteggio', async () => {
    const search = vi.fn(async () => searchResponse());
    const { searchVectorDB } = tools({ search });

    const input = searchVectorDbInput.parse({ query: 'tempi di risposta SLA' });
    const output = await searchVectorDB.execute?.(input, EXEC_OPTIONS);

    expect(output).toMatchObject({ ok: true, resultCount: 1, backend: 'pgvector' });
    expect(output).toHaveProperty('results.0.source', 'contracts/sla.md');
  });

  it('propaga il tenant deciso dal server, non quello scelto dal modello', async () => {
    const search = vi.fn(async () => searchResponse());
    const { searchVectorDB } = tools({ search }, 'acme-spa');

    await searchVectorDB.execute?.(
      searchVectorDbInput.parse({ query: 'policy di rimborso' }),
      EXEC_OPTIONS,
    );

    expect(search).toHaveBeenCalledWith(
      'policy di rimborso',
      expect.objectContaining({ tenantId: 'acme-spa' }),
    );
  });

  it('riporta il degrado e la nota, così l\'agente può dichiararlo all\'utente', async () => {
    const search = vi.fn(async () =>
      searchResponse({
        backend: 'demo-corpus',
        degraded: true,
        note: 'DATABASE_URL non configurata.',
      }),
    );
    const { searchVectorDB } = tools({ search });

    const output = await searchVectorDB.execute?.(
      searchVectorDbInput.parse({ query: 'onboarding cliente' }),
      EXEC_OPTIONS,
    );

    expect(output).toMatchObject({ degraded: true, note: 'DATABASE_URL non configurata.' });
  });

  it('trasforma un guasto in un risultato leggibile invece di lanciare', async () => {
    const search = vi.fn(async () => {
      throw new Error('connessione rifiutata');
    });
    const { searchVectorDB } = tools({ search });

    const output = await searchVectorDB.execute?.(
      searchVectorDbInput.parse({ query: 'qualsiasi cosa' }),
      EXEC_OPTIONS,
    );

    // Un'eccezione qui interromperebbe una run già iniziata; un errore descritto
    // lascia al modello la possibilità di correggere allo step successivo.
    expect(output).toMatchObject({ ok: false, message: 'connessione rifiutata' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractStructuredData
// ─────────────────────────────────────────────────────────────────────────────

describe('extractStructuredData', () => {
  it('rifiuta un testo troppo breve per contenere qualcosa di strutturabile', () => {
    expect(extractStructuredDataInput.safeParse({ text: 'ciao' }).success).toBe(false);
  });

  it('accetta istruzioni facoltative di dominio', () => {
    const parsed = extractStructuredDataInput.parse({
      text: 'Fattura numero 2026/318 emessa il 12 marzo 2026 per 5.185,00 EUR.',
      instructions: 'servono imponibile e IVA',
    });
    expect(parsed.instructions).toBe('servono imponibile e IVA');
  });

  it('restituisce l\'estrazione e il conteggio dei token consumati', async () => {
    const extract = vi.fn(async () => extractOutcome());
    const { extractStructuredData } = tools({ extract });

    const output = await extractStructuredData.execute?.(
      extractStructuredDataInput.parse({
        text: 'Fattura numero 2026/318 emessa il 12 marzo 2026 per 5.185,00 EUR.',
      }),
      EXEC_OPTIONS,
    );

    expect(output).toMatchObject({ ok: true, tokensUsed: 200 });
    expect(output).toHaveProperty('extraction.documentType', 'fattura');
  });

  it('inoltra le istruzioni al motore di estrazione', async () => {
    const extract = vi.fn(async () => extractOutcome());
    const { extractStructuredData } = tools({ extract });

    await extractStructuredData.execute?.(
      extractStructuredDataInput.parse({
        text: 'Contratto di fornitura fra le parti, durata trentasei mesi.',
        instructions: 'estrai durata e parti',
      }),
      EXEC_OPTIONS,
    );

    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: 'estrai durata e parti' }),
    );
  });

  it('riporta il fallimento senza lanciare', async () => {
    const extract = vi.fn(async () => {
      throw new Error('schema non rispettato dal modello');
    });
    const { extractStructuredData } = tools({ extract });

    const output = await extractStructuredData.execute?.(
      extractStructuredDataInput.parse({ text: 'Testo abbastanza lungo da superare il minimo.' }),
      EXEC_OPTIONS,
    );

    expect(output).toMatchObject({ ok: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchExternalAPI
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchExternalAPI', () => {
  it('accetta solo connettori del catalogo: un URL libero non è rappresentabile', () => {
    expect(
      fetchExternalApiInput.safeParse({ connector: 'http://169.254.169.254/', resource: 'x' })
        .success,
    ).toBe(false);
  });

  it('applica i default di limite', () => {
    const parsed = fetchExternalApiInput.parse({ connector: 'crm', resource: 'accounts' });
    expect(parsed.limit).toBe(10);
  });

  it('interroga il connettore reale e restituisce record marcati come simulati', async () => {
    const { fetchExternalAPI } = tools();

    const output = await fetchExternalAPI.execute?.(
      fetchExternalApiInput.parse({ connector: 'crm', resource: 'accounts', limit: 3 }),
      EXEC_OPTIONS,
    );

    expect(output).toMatchObject({ ok: true, simulated: true, returned: 3 });
  });

  it('su risorsa sconosciuta restituisce le alternative valide, non un elenco vuoto', async () => {
    const { fetchExternalAPI } = tools();

    const output = await fetchExternalAPI.execute?.(
      fetchExternalApiInput.parse({ connector: 'erp', resource: 'clienti' }),
      EXEC_OPTIONS,
    );

    expect(output).toMatchObject({ ok: false, error: 'unknown_resource' });
    // `execute` è tipizzato anche per il caso streaming, che questi tool non usano.
    expect((output as unknown as { hint: string[] }).hint).toContain('invoices');
  });

  it('inoltra i filtri al connettore', async () => {
    const callConnector = vi.fn(() => ({
      ok: true as const,
      connector: 'support' as const,
      resource: 'tickets',
      endpoint: 'GET /support/v1/tickets',
      records: [],
      returned: 0,
      totalMatching: 0,
      appliedFilters: { severity: 'S1' },
      simulatedLatencyMs: 80,
      simulated: true as const,
    }));
    const { fetchExternalAPI } = tools({ callConnector });

    await fetchExternalAPI.execute?.(
      fetchExternalApiInput.parse({
        connector: 'support',
        resource: 'tickets',
        filters: { severity: 'S1' },
      }),
      EXEC_OPTIONS,
    );

    expect(callConnector).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { severity: 'S1' } }),
    );
  });
});
