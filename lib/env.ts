/**
 * Accesso tipizzato e *lazy* alle variabili d'ambiente.
 *
 * Lazy e non costanti a livello di modulo per due motivi: su Vercel Edge il
 * bundle è valutato una volta e riusato tra invocazioni, e i test devono poter
 * cambiare l'ambiente senza reimportare i moduli.
 */

/** Legge una variabile trattando la stringa vuota come "non impostata". */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Legge un intero entro un intervallo, ripiegando sul default se assente o fuori range. */
export function readEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/** True quando gira su Vercel/Node in modalità produzione. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export const IS_TEST = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
