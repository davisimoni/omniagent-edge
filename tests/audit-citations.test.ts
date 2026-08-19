import { describe, expect, it } from 'vitest';
import {
  normalizeForMatch,
  PARTIAL_THRESHOLD,
  tallyCitations,
  toVerifiedCitation,
  toWords,
  verifyCitation,
  VERIFIED_THRESHOLD,
} from '@/lib/audit/citations';
import type { VerifiedCitation } from '@/lib/audit/schema';
import { SOURCE_TEXT } from './fixtures/audit';

/**
 * Test della verifica delle citazioni.
 *
 * È il controllo che impedisce a un rilievo con citazione inventata di arrivare
 * a un tavolo di rinegoziazione. I casi qui sotto coprono le due direzioni in cui
 * può sbagliare: marcare come falsa una citazione corretta arrivata da un PDF con
 * virgolette tipografiche, e marcare come vera una frase assemblata con parole
 * che nel documento ci sono, ma non in quella sequenza.
 */

describe('normalizeForMatch', () => {
  it('uniforma virgolette tipografiche e trattini lunghi', () => {
    expect(normalizeForMatch('“virgolette” e trattino—lungo')).toBe('"virgolette" e trattino-lungo');
  });

  it('collassa gli a capo introdotti dall\'estrazione da PDF', () => {
    expect(normalizeForMatch('prima\nriga    e\t seconda')).toBe('prima riga e seconda');
  });

  it('normalizza lo spazio non separabile', () => {
    expect(normalizeForMatch('canone annuo')).toBe('canone annuo');
  });
});

describe('toWords', () => {
  it('rimuove la punteggiatura e conserva numeri e lettere accentate', () => {
    expect(toWords('Art. 4 — disponibilità 99,9%')).toEqual(['art', '4', 'disponibilità', '99', '9']);
  });
});

describe('verifyCitation', () => {
  it('conferma una citazione copiata alla lettera', () => {
    const result = verifyCitation(
      'Il presente contratto è regolato dalla legge tedesca.',
      SOURCE_TEXT,
    );
    expect(result.verification).toBe('verified');
    expect(result.matchRatio).toBe(1);
  });

  it('conferma una citazione che differisce solo per spaziatura e a capo', () => {
    // Il caso reale: il modello legge un PDF e il testo arriva con gli a capo
    // in punti diversi. Un confronto sui byte grezzi la scarterebbe.
    const result = verifyCitation(
      'Per ogni controversia è competente in via   esclusiva il foro di Amburgo.',
      SOURCE_TEXT,
    );
    expect(result.verification).toBe('verified');
  });

  it('rifiuta una citazione inventata', () => {
    const result = verifyCitation(
      'Il Fornitore si impegna a versare una penale pari al 50% del canone annuo.',
      SOURCE_TEXT,
    );
    expect(result.verification).toBe('unverified');
    expect(result.matchRatio).toBeLessThan(PARTIAL_THRESHOLD);
  });

  it('rifiuta una frase assemblata con parole presenti nel testo ma in altro ordine', () => {
    // Questo è il caso che un confronto a sacchetto di parole promuoverebbe a
    // pieni voti: ogni singola parola è nel documento. Le finestre contigue
    // pretendono la sequenza, che è ciò che rende una citazione tale.
    const result = verifyCitation(
      'Il foro di Amburgo garantisce una disponibilità della responsabilità complessiva del contratto tedesca.',
      SOURCE_TEXT,
    );
    expect(result.verification).toBe('unverified');
  });

  it('dichiara non verificabile una citazione senza testo sorgente', () => {
    // Diverso da "falsa": con un allegato binario non c'è nulla su cui confrontare.
    expect(verifyCitation('qualsiasi cosa', null).verification).toBe('no-source');
    expect(verifyCitation('qualsiasi cosa', '').verification).toBe('no-source');
  });

  it('riconosce come parziale una citazione in gran parte corretta', () => {
    const result = verifyCitation(
      'Il Fornitore garantisce una disponibilità della piattaforma pari al 99,9% su base trimestrale e senza eccezioni di sorta',
      SOURCE_TEXT,
    );
    expect(result.matchRatio).toBeGreaterThan(0);
    expect(result.matchRatio).toBeLessThan(VERIFIED_THRESHOLD);
  });

  it('restituisce un rapporto compreso fra 0 e 1', () => {
    for (const quote of ['legge tedesca', 'testo del tutto estraneo al documento in esame']) {
      const result = verifyCitation(quote, SOURCE_TEXT);
      expect(result.matchRatio).toBeGreaterThanOrEqual(0);
      expect(result.matchRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe('toVerifiedCitation', () => {
  it('conserva testo e posizione aggiungendo l\'esito della verifica', () => {
    const result = toVerifiedCitation(
      { quote: 'Il presente contratto è regolato dalla legge tedesca.', locator: 'art. 11' },
      SOURCE_TEXT,
    );

    expect(result.locator).toBe('art. 11');
    expect(result.verification).toBe('verified');
  });
});

describe('tallyCitations', () => {
  const make = (verification: VerifiedCitation['verification']): VerifiedCitation => ({
    quote: 'q',
    locator: null,
    verification,
    matchRatio: verification === 'verified' ? 1 : 0.3,
  });

  it('conta separatamente confermate, parziali e non trovate', () => {
    const tally = tallyCitations([
      make('verified'),
      make('verified'),
      make('partial'),
      make('unverified'),
    ]);

    expect(tally).toEqual({ total: 4, verified: 2, partial: 1, unverified: 1 });
  });

  it('esclude dal totale le citazioni non verificabili', () => {
    // Includerle abbasserebbe la percentuale di affidabilità per una ragione che
    // non ha nulla a che vedere con la qualità dei rilievi.
    const tally = tallyCitations([make('verified'), make('no-source'), make('no-source')]);
    expect(tally).toEqual({ total: 1, verified: 1, partial: 0, unverified: 0 });
  });

  it('vale zero su una lista vuota', () => {
    expect(tallyCitations([])).toEqual({ total: 0, verified: 0, partial: 0, unverified: 0 });
  });
});
