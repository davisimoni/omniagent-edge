/**
 * Primitive di hashing deterministico condivise.
 *
 * Stanno in un modulo a sé perché servono sia al vector store (hashing trick per
 * gli embedding locali) sia ai connettori simulati (dati finti ma stabili fra
 * una run e l'altra). Duplicarle significherebbe che una demo e un test possono
 * divergere su un dato che dovrebbe essere identico per costruzione.
 */

/** FNV-1a a 32 bit: deterministico, senza dipendenze, disponibile su Edge. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Generatore pseudo-casuale riproducibile (mulberry32).
 *
 * I dati dei connettori simulati devono essere stabili: se la stessa chiamata
 * restituisse valori diversi a ogni run, la dashboard sembrerebbe instabile e i
 * test non potrebbero asserire nulla sul contenuto.
 */
export function createSeededRandom(seed: string): () => number {
  let state = fnv1a(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sceglie un elemento da una lista non vuota in modo deterministico. */
export function pickDeterministic<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) throw new Error('pickDeterministic richiede una lista non vuota.');
  const index = fnv1a(seed) % items.length;
  return items[index] as T;
}
