import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { readEnv } from '@/lib/env';

/**
 * Client PostgreSQL condiviso.
 *
 * **Perché un modulo a sé e non la connessione già presente in `lib/vector.ts`.**
 * Quella serve il vector store, che è opzionale per costruzione: senza database
 * la ricerca ripiega su un corpus dimostrativo e l'applicazione funziona lo
 * stesso. Qui il database non è opzionale allo stesso modo — senza, non
 * esistono account né cronologia — ma il modo di dirlo deve restare identico:
 * si dichiara che manca, non si finge che ci sia.
 *
 * `isDatabaseConfigured()` è la guardia che ogni repository chiama prima di
 * toccare la rete, così l'assenza di configurazione produce un messaggio
 * azionabile invece di un'eccezione del driver a metà richiesta.
 */

export function isDatabaseConfigured(): boolean {
  return readEnv('DATABASE_URL') !== undefined;
}

export class DatabaseNotConfiguredError extends Error {
  readonly code = 'database_not_configured';
  constructor() {
    super(
      'DATABASE_URL non è configurata. Account, cronologia degli audit e quote ' +
        'richiedono un database PostgreSQL: vedi db/schema-app.sql.',
    );
    this.name = 'DatabaseNotConfiguredError';
  }
}

/**
 * Costruisce il client.
 *
 * Per invocazione e non a livello di modulo: su Edge il bundle è valutato una
 * volta e riusato fra le invocazioni, quindi una connection string letta
 * all'import resterebbe congelata per tutta la vita dell'isolate — e nei test
 * renderebbe impossibile cambiare ambiente senza reimportare il modulo.
 */
export function getSql(): NeonQueryFunction<false, false> {
  const connectionString = readEnv('DATABASE_URL');
  if (connectionString === undefined) throw new DatabaseNotConfiguredError();
  return neon(connectionString, { fullResults: false, arrayMode: false });
}

/**
 * Identificativo opaco e ordinabile nel tempo.
 *
 * Prefisso temporale in base 36 più entropia casuale: due record creati nello
 * stesso millisecondo restano distinti, e l'ordinamento lessicografico degli id
 * coincide con quello cronologico — utile quando si pagina su `created_at` e
 * serve un discriminante stabile a parità di timestamp.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}_${time}${random}`;
}

/** Riduce un nome a uno slug utilizzabile come identificativo leggibile. */
export function slugify(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : 'workspace';
}
