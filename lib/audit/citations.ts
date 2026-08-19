import type { Citation, CitationVerification, VerifiedCitation } from '@/lib/audit/schema';

/**
 * Verifica delle citazioni contro il testo sorgente.
 *
 * È il controllo più importante dell'intero motore. In un audit di conformità il
 * modo peggiore di sbagliare non è mancare un rilievo: è **produrne uno con una
 * citazione inventata**. Un rilievo mancato viene scoperto alla revisione umana;
 * una citazione plausibile ma inesistente viene portata a un tavolo di
 * rinegoziazione, dove il fornitore apre il contratto e la frase non c'è.
 *
 * Qui ogni citazione prodotta dal modello viene ricercata nel documento
 * originale e marcata `verified`, `partial` o `unverified`. L'esito non viene
 * nascosto: entra nel report, riduce l'affidabilità dichiarata dell'audit e in
 * interfaccia compare accanto al rilievo.
 */

/** Sotto questa soglia di corrispondenza la citazione è considerata confermata. */
export const VERIFIED_THRESHOLD = 0.98;
/** Sopra questa soglia la citazione è parziale: il passaggio esiste ma non è copiato alla lettera. */
export const PARTIAL_THRESHOLD = 0.6;
/** Lunghezza delle finestre di parole confrontate. */
export const SHINGLE_SIZE = 5;

/**
 * Normalizza per il confronto.
 *
 * L'estrazione da PDF introduce sistematicamente virgolette tipografiche, trattini
 * lunghi, spazi non separabili e a capo in mezzo alle frasi. Confrontare i byte
 * grezzi marcherebbe come inventate citazioni perfettamente corrette, ed è il modo
 * più rapido per rendere inutile un controllo giusto.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parole significative, senza punteggiatura: l'unità del confronto a finestre. */
export function toWords(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function shingles(words: readonly string[], size: number): string[] {
  if (words.length < size) return [];
  const result: string[] = [];
  for (let index = 0; index + size <= words.length; index += 1) {
    result.push(words.slice(index, index + size).join(' '));
  }
  return result;
}

export interface CitationMatch {
  readonly verification: CitationVerification;
  readonly matchRatio: number;
}

/**
 * Confronta una citazione con il sorgente.
 *
 * Il confronto avviene su finestre contigue di parole, non su un insieme di
 * parole. Un modello che assembla una frase inesistente usando termini presenti
 * altrove nel documento supererebbe un controllo a sacchetto di parole con
 * punteggio pieno: ogni singola parola è nel testo. Le finestre contigue
 * pretendono invece che sia presente la *sequenza*, che è ciò che rende una
 * citazione una citazione.
 */
export function verifyCitation(quote: string, source: string | null | undefined): CitationMatch {
  if (source === null || source === undefined || source.trim().length === 0) {
    // Audit su un allegato senza testo estratto: nessuna base di confronto.
    // Dichiararlo è diverso da dichiarare la citazione falsa.
    return { verification: 'no-source', matchRatio: 0 };
  }

  const normalizedQuote = normalizeForMatch(quote);
  if (normalizedQuote.length === 0) return { verification: 'unverified', matchRatio: 0 };

  const normalizedSource = normalizeForMatch(source);
  if (normalizedSource.includes(normalizedQuote)) {
    return { verification: 'verified', matchRatio: 1 };
  }

  const quoteWords = toWords(quote);
  const sourceWords = toWords(source);
  if (quoteWords.length === 0 || sourceWords.length === 0) {
    return { verification: 'unverified', matchRatio: 0 };
  }

  const sourceText = sourceWords.join(' ');
  const quoteShingles = shingles(quoteWords, SHINGLE_SIZE);

  let matchRatio: number;
  if (quoteShingles.length === 0) {
    // Citazione più corta di una finestra: si ricade sulla presenza dei termini,
    // accettando che il segnale sia più debole su frammenti così brevi.
    const found = quoteWords.filter((word) => sourceText.includes(word)).length;
    matchRatio = found / quoteWords.length;
  } else {
    const found = quoteShingles.filter((shingle) => sourceText.includes(shingle)).length;
    matchRatio = found / quoteShingles.length;
  }

  const rounded = Math.round(matchRatio * 1000) / 1000;
  const verification: CitationVerification =
    rounded >= VERIFIED_THRESHOLD ? 'verified' : rounded >= PARTIAL_THRESHOLD ? 'partial' : 'unverified';

  return { verification, matchRatio: rounded };
}

export function toVerifiedCitation(
  citation: Citation,
  source: string | null | undefined,
): VerifiedCitation {
  const match = verifyCitation(citation.quote, source);
  return { ...citation, verification: match.verification, matchRatio: match.matchRatio };
}

export interface CitationTally {
  readonly total: number;
  readonly verified: number;
  readonly partial: number;
  readonly unverified: number;
}

/** Conteggio complessivo. Le citazioni senza sorgente non entrano nel totale verificabile. */
export function tallyCitations(citations: readonly VerifiedCitation[]): CitationTally {
  let verified = 0;
  let partial = 0;
  let unverified = 0;
  let total = 0;

  for (const citation of citations) {
    if (citation.verification === 'no-source') continue;
    total += 1;
    if (citation.verification === 'verified') verified += 1;
    else if (citation.verification === 'partial') partial += 1;
    else unverified += 1;
  }

  return { total, verified, partial, unverified };
}
