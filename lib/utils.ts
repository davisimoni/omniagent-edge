import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compone classi Tailwind risolvendo i conflitti.
 *
 * `clsx` gestisce i condizionali, `twMerge` fa vincere l'ultima utility dello
 * stesso gruppo: senza, `cn('p-2', 'p-4')` lascerebbe entrambe nel markup e il
 * risultato dipenderebbe dall'ordine nel CSS generato, non dall'ordine di scrittura.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formattazione numerica italiana (separatore migliaia `.`, decimale `,`). */
export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Copia negli appunti; `false` quando l'API non è disponibile o l'utente nega il permesso. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Avvia il download di un file generato lato client. */
export function downloadTextFile(filename: string, contents: string, mediaType: string): void {
  const blob = new Blob([contents], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Senza revoke il blob resta in memoria per tutta la vita del documento.
  URL.revokeObjectURL(url);
}
