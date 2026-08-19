/**
 * Valutazione della qualità del testo estratto da un documento.
 *
 * Il problema che risolve è concreto: un PDF scansionato è, dal punto di vista
 * di un estrattore di testo, un PDF vuoto. Non fallisce — restituisce zero
 * caratteri, o poche decine di simboli sparsi prodotti da un OCR di scarto già
 * incorporato nel file. Se nessuno se ne accorge, l'audit gira su una stringa
 * vuota, non trova alcuna clausola, e riporta con la massima serietà che il
 * contratto manca di venti clausole su venti. È l'errore peggiore possibile per
 * questo prodotto: un risultato catastrofico, sicuro di sé e completamente falso.
 *
 * Modulo puro: solo aritmetica su una stringa. Le soglie sono costanti esportate
 * perché i test le usano come riferimento invece di ricopiarne i valori.
 */

export const TEXT_QUALITIES = ['rich', 'sparse', 'empty'] as const;
export type TextQuality = (typeof TEXT_QUALITIES)[number];

/**
 * Caratteri per pagina sotto cui una pagina è da considerarsi non testuale.
 *
 * Una pagina di contratto composta a corpo 11 porta fra i 1.500 e i 3.000
 * caratteri. Una pagina scansionata ne produce fra 0 e qualche decina. La soglia
 * sta volutamente in mezzo, molto più vicina al fondo: serve a separare due
 * popolazioni lontanissime, non a misurare la densità del testo.
 */
export const MIN_CHARS_PER_PAGE = 180;

/** Sotto questa soglia complessiva il documento è vuoto a prescindere dalle pagine. */
export const MIN_TOTAL_CHARS = 200;

/** Sotto questa soglia il documento non contiene abbastanza testo per un audit. */
export const EMPTY_THRESHOLD_CHARS = 50;

/**
 * Quota minima di caratteri alfanumerici.
 *
 * Un'estrazione con la codifica sbagliata produce lunghe sequenze di simboli e
 * caratteri di sostituzione: molti caratteri, nessuna parola. Il conteggio da
 * solo la promuoverebbe a documento ricco.
 */
export const MIN_ALPHANUMERIC_RATIO = 0.55;

/** Oltre questa quota di caratteri di sostituzione la codifica è compromessa. */
export const MAX_REPLACEMENT_RATIO = 0.02;

export interface TextAssessment {
  readonly quality: TextQuality;
  readonly characters: number;
  readonly wordCount: number;
  readonly pageCount: number | null;
  readonly charactersPerPage: number | null;
  readonly alphanumericRatio: number;
  readonly replacementRatio: number;
  /** True quando conviene tentare la lettura visiva del documento. */
  readonly needsOcr: boolean;
  /** Motivo in italiano: finisce nei metadati del report e nell'interfaccia. */
  readonly reason: string;
}

export interface AssessOptions {
  /** Numero di pagine, se noto: rende la soglia proporzionata al documento. */
  readonly pageCount?: number | null;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function assessExtractedText(
  text: string | null | undefined,
  options: AssessOptions = {},
): TextAssessment {
  const value = text ?? '';
  const characters = value.trim().length;
  const pageCount =
    typeof options.pageCount === 'number' && options.pageCount > 0
      ? Math.round(options.pageCount)
      : null;
  const charactersPerPage = pageCount !== null ? characters / pageCount : null;

  const alphanumeric = countMatches(value, /[\p{L}\p{N}]/gu);
  const replacement = countMatches(value, /�/gu);
  const alphanumericRatio = characters === 0 ? 0 : round(alphanumeric / characters);
  const replacementRatio = characters === 0 ? 0 : round(replacement / characters);
  const wordCount = value.trim().length === 0 ? 0 : value.trim().split(/\s+/).length;

  const base = {
    characters,
    wordCount,
    pageCount,
    charactersPerPage: charactersPerPage === null ? null : round(charactersPerPage),
    alphanumericRatio,
    replacementRatio,
  };

  if (characters < EMPTY_THRESHOLD_CHARS) {
    return {
      ...base,
      quality: 'empty',
      needsOcr: true,
      reason:
        characters === 0
          ? 'Nessun testo estraibile dal documento: quasi certamente una scansione o un PDF di sole immagini.'
          : `Solo ${characters} caratteri estratti: troppo pochi perché il documento sia testuale.`,
    };
  }

  if (replacementRatio > MAX_REPLACEMENT_RATIO) {
    return {
      ...base,
      quality: 'sparse',
      needsOcr: true,
      reason:
        `Il ${Math.round(replacementRatio * 100)}% dei caratteri è illeggibile: l'estrazione ha ` +
        'prodotto testo con una codifica compromessa.',
    };
  }

  if (alphanumericRatio < MIN_ALPHANUMERIC_RATIO) {
    return {
      ...base,
      quality: 'sparse',
      needsOcr: true,
      reason:
        `Solo il ${Math.round(alphanumericRatio * 100)}% dei caratteri estratti è alfanumerico: ` +
        'il testo è composto in prevalenza da simboli, non da parole.',
    };
  }

  if (charactersPerPage !== null && charactersPerPage < MIN_CHARS_PER_PAGE) {
    return {
      ...base,
      quality: 'sparse',
      needsOcr: true,
      reason:
        `Circa ${Math.round(charactersPerPage)} caratteri per pagina su ${pageCount}: ` +
        'una pagina di contratto ne porta oltre mille, quindi parte del documento è a immagine.',
    };
  }

  if (charactersPerPage === null && characters < MIN_TOTAL_CHARS) {
    return {
      ...base,
      quality: 'sparse',
      needsOcr: true,
      reason: `Solo ${characters} caratteri estratti in tutto il documento.`,
    };
  }

  return {
    ...base,
    quality: 'rich',
    needsOcr: false,
    reason: `Testo estratto correttamente: ${characters} caratteri, ${wordCount} parole.`,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
