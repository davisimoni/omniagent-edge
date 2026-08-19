import { describe, expect, it } from 'vitest';
import { base64ByteLength } from '@/app/api/extract/route';
import {
  chatRequestSchema,
  extractRequestSchema,
  structuredExtractionSchema,
} from '@/lib/schemas';

/**
 * Test dei contratti dati.
 *
 * Gli schemi qui sotto sono contemporaneamente il JSON Schema che il modello
 * legge e la validazione che protegge le rotte: un test su queste forme copre
 * entrambi i lati con la stessa asserzione.
 */

const validExtraction = {
  documentType: 'fattura',
  language: 'it',
  title: 'Fattura 2026/318',
  summary: 'Fattura emessa da Rossi Logistica SpA.',
  entities: [
    {
      type: 'monetary_amount' as const,
      value: '5.185,00 EUR',
      normalized: '5185.00',
      confidence: 0.95,
      evidence: 'totale 5.185,00 EUR',
    },
  ],
  keyFields: [{ key: 'numero', value: '2026/318', confidence: 1 }],
  openQuestions: ['Modalità di pagamento non indicata.'],
  overallConfidence: 0.9,
};

describe('structuredExtractionSchema', () => {
  it('accetta un\'estrazione completa', () => {
    expect(structuredExtractionSchema.safeParse(validExtraction).success).toBe(true);
  });

  it('accetta `normalized` e `title` nulli: un vuoto dichiarato è un dato', () => {
    const parsed = structuredExtractionSchema.safeParse({
      ...validExtraction,
      title: null,
      entities: [{ ...validExtraction.entities[0], normalized: null }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rifiuta un\'entità senza citazione a supporto', () => {
    const parsed = structuredExtractionSchema.safeParse({
      ...validExtraction,
      entities: [{ ...validExtraction.entities[0], evidence: '' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rifiuta un tipo di entità fuori dall\'enumerazione', () => {
    const parsed = structuredExtractionSchema.safeParse({
      ...validExtraction,
      entities: [{ ...validExtraction.entities[0], type: 'aliena' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rifiuta una confidenza fuori dall\'intervallo 0-1', () => {
    const parsed = structuredExtractionSchema.safeParse({
      ...validExtraction,
      overallConfidence: 1.4,
    });
    expect(parsed.success).toBe(false);
  });

  it('accetta liste vuote di entità e domande aperte', () => {
    const parsed = structuredExtractionSchema.safeParse({
      ...validExtraction,
      entities: [],
      keyFields: [],
      openQuestions: [],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('extractRequestSchema', () => {
  it('accetta il solo testo', () => {
    expect(extractRequestSchema.safeParse({ text: 'Un documento qualsiasi.' }).success).toBe(true);
  });

  it('accetta il solo allegato', () => {
    const parsed = extractRequestSchema.safeParse({
      attachment: { name: 'fattura.pdf', mediaType: 'application/pdf', data: 'JVBERi0=' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rifiuta una richiesta senza né testo né allegato', () => {
    expect(extractRequestSchema.safeParse({}).success).toBe(false);
    expect(extractRequestSchema.safeParse({ text: '   ' }).success).toBe(false);
  });

  it('rifiuta un allegato SVG: è un documento eseguibile, non un\'immagine', () => {
    const parsed = extractRequestSchema.safeParse({
      attachment: { name: 'exploit.svg', mediaType: 'image/svg+xml', data: 'PHN2Zz4=' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('chatRequestSchema', () => {
  it('accetta una cronologia non vuota', () => {
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'user' }] }).success).toBe(true);
  });

  it('rifiuta una cronologia vuota', () => {
    expect(chatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it('rifiuta un tenant con caratteri fuori dall\'alfabeto ammesso', () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: 'user' }],
      tenantId: "acme'; DROP--",
    });
    expect(parsed.success).toBe(false);
  });

  it('accetta un tenant alfanumerico con trattini', () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: 'user' }],
      tenantId: 'acme-spa_01',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('base64ByteLength', () => {
  it('calcola la dimensione reale tenendo conto del padding', () => {
    // "abc" → "YWJj" (nessun padding), "ab" → "YWI=" (un byte di padding).
    expect(base64ByteLength('YWJj')).toBe(3);
    expect(base64ByteLength('YWI=')).toBe(2);
    expect(base64ByteLength('YQ==')).toBe(1);
  });

  it('vale zero su input vuoto', () => {
    expect(base64ByteLength('')).toBe(0);
  });
});
