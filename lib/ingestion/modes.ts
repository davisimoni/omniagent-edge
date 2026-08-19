/**
 * Modalità di acquisizione ed etichette.
 *
 * File separato dalla pipeline, e la ragione è di confine fra client e server:
 * `lib/ingestion/pipeline.ts` importa il lettore visivo, che importa l'AI SDK.
 * L'interfaccia ha bisogno solo di queste etichette per dire "Lettura visiva"
 * accanto a un risultato, e prenderle da lì trascinerebbe l'intero SDK nel
 * bundle del browser — decine di kilobyte scaricati da ogni visitatore per
 * mostrare tre parole.
 *
 * Non ha dipendenze, e non deve acquisirne.
 */

export const INGESTION_MODES = [
  'text',
  'ocr_fallback',
  'ocr_primary',
  'attachment_passthrough',
] as const;
export type IngestionMode = (typeof INGESTION_MODES)[number];

export const MODE_LABELS: Readonly<Record<IngestionMode, string>> = {
  text: 'Testo fornito',
  ocr_fallback: 'Lettura visiva (ripiego)',
  ocr_primary: 'Lettura visiva',
  attachment_passthrough: 'Allegato non trascritto',
};
