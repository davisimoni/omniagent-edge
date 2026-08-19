import { createSeededRandom, pickDeterministic } from '@/lib/hash';

/**
 * Simulazione di integrazioni enterprise (CRM, ERP, ticketing).
 *
 * Due scelte strutturali, entrambe deliberate:
 *
 * **1. Nessun URL libero.** Il tool `fetchExternalAPI` non accetta un indirizzo
 * dal modello: accetta un `connector` e una `resource` scelti da questo catalogo.
 * Un tool che accetta URL arbitrari è una SSRF con un prompt come vettore — basta
 * un documento indicizzato che "suggerisca" di consultare `169.254.169.254` e
 * l'agente esfiltra le credenziali dell'istanza. Vincolare l'input a un catalogo
 * chiuso rende quella classe di attacchi irrappresentabile, non solo filtrata.
 *
 * **2. Dati finti ma stabili.** I record sono generati da un PRNG seminato su
 * `connettore + risorsa + indice`: la stessa chiamata restituisce sempre gli
 * stessi valori. Dati che cambiano a ogni run renderebbero la dashboard
 * inaffidabile da leggere e i test impossibili da scrivere.
 *
 * Sostituire questo modulo con chiamate HTTP reali significa riscrivere solo
 * `executeConnectorCall`: la forma dell'input e dell'output resta la stessa.
 */

export const CONNECTOR_IDS = ['crm', 'erp', 'support'] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export type ConnectorRecord = Readonly<Record<string, string | number>>;

export interface ConnectorResource {
  readonly description: string;
  /** Campi filtrabili: un filtro su un campo inesistente è un errore, non un risultato vuoto. */
  readonly fields: readonly string[];
  /** Numero di record nel dataset simulato. */
  readonly size: number;
  readonly build: (index: number, random: () => number) => ConnectorRecord;
}

export interface Connector {
  readonly label: string;
  readonly system: string;
  readonly resources: Readonly<Record<string, ConnectorResource>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vocabolari deterministici
// ─────────────────────────────────────────────────────────────────────────────

const COMPANIES = [
  'Rossi Logistica SpA', 'Bianchi Manifattura Srl', 'Delta Energia SpA',
  'Novaform Industriale', 'Costa Retail Group', 'Ferrari Componenti Srl',
  'Adriatica Servizi', 'Monviso Chimica SpA', 'Lucania Agrifood Srl', 'Verde Mobilità SpA',
] as const;

const INDUSTRIES = ['logistica', 'manifattura', 'energia', 'retail', 'agroalimentare', 'servizi'] as const;
const COUNTRIES = ['IT', 'DE', 'FR', 'ES', 'NL'] as const;
const PLANS = ['starter', 'professional', 'enterprise'] as const;
const OWNERS = ['g.moretti', 'l.ferraro', 's.dangelo', 'm.rinaldi'] as const;
const STAGES = ['qualificazione', 'proposta', 'negoziazione', 'chiusa_vinta', 'chiusa_persa'] as const;
const INVOICE_STATUS = ['emessa', 'pagata', 'scaduta', 'contestata'] as const;
const TICKET_STATUS = ['aperto', 'in_lavorazione', 'in_attesa_cliente', 'risolto'] as const;
const SEVERITIES = ['S1', 'S2', 'S3', 'S4'] as const;
const WAREHOUSES = ['MI-01', 'BO-02', 'NA-03'] as const;
const TICKET_SUBJECTS = [
  'Errore 429 sulle chiamate batch',
  'Import CSV interrotto a metà',
  'SSO non reindirizza dopo il login',
  'Discrepanza nel report mensile',
  'Richiesta aumento quota API',
] as const;

/** Data ISO deterministica a partire da un offset in giorni da una base fissa. */
function isoDate(baseDaysFromEpoch: number, offsetDays: number): string {
  const millis = (baseDaysFromEpoch + offsetDays) * 86_400_000;
  return new Date(millis).toISOString().slice(0, 10);
}

/** 2026-01-01, base fissa: i dati simulati non devono cambiare col passare del tempo reale. */
const BASE_DAY = Math.floor(Date.UTC(2026, 0, 1) / 86_400_000);

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

// ─────────────────────────────────────────────────────────────────────────────
// Catalogo
// ─────────────────────────────────────────────────────────────────────────────

export const CONNECTORS: Readonly<Record<ConnectorId, Connector>> = {
  crm: {
    label: 'CRM commerciale',
    system: 'salesforce-like',
    resources: {
      accounts: {
        description: 'Anagrafica clienti con piano attivo, ARR e health score.',
        fields: ['id', 'name', 'industry', 'country', 'plan', 'arr_eur', 'health_score', 'owner'],
        size: 24,
        build: (index, random) => ({
          id: `ACC-${pad(1000 + index, 4)}`,
          name: pickDeterministic(COMPANIES, `acc-name-${index}`),
          industry: pickDeterministic(INDUSTRIES, `acc-ind-${index}`),
          country: pickDeterministic(COUNTRIES, `acc-country-${index}`),
          plan: pickDeterministic(PLANS, `acc-plan-${index}`),
          arr_eur: Math.round((12_000 + random() * 180_000) / 100) * 100,
          health_score: Math.round(40 + random() * 60),
          owner: pickDeterministic(OWNERS, `acc-owner-${index}`),
        }),
      },
      opportunities: {
        description: 'Trattative aperte e chiuse con stadio, valore e data di chiusura attesa.',
        fields: ['id', 'account', 'stage', 'amount_eur', 'probability', 'close_date', 'owner'],
        size: 30,
        build: (index, random) => ({
          id: `OPP-${pad(5000 + index, 4)}`,
          account: pickDeterministic(COMPANIES, `opp-acc-${index}`),
          stage: pickDeterministic(STAGES, `opp-stage-${index}`),
          amount_eur: Math.round((5_000 + random() * 120_000) / 500) * 500,
          probability: Math.round(random() * 100),
          close_date: isoDate(BASE_DAY, 30 + index * 3),
          owner: pickDeterministic(OWNERS, `opp-owner-${index}`),
        }),
      },
    },
  },

  erp: {
    label: 'ERP amministrativo',
    system: 'sap-like',
    resources: {
      invoices: {
        description: 'Fatture emesse con stato di incasso e scadenza.',
        fields: ['id', 'account', 'issue_date', 'due_date', 'amount_eur', 'status'],
        size: 36,
        build: (index, random) => ({
          id: `INV-2026-${pad(index + 1, 4)}`,
          account: pickDeterministic(COMPANIES, `inv-acc-${index}`),
          issue_date: isoDate(BASE_DAY, index * 2),
          due_date: isoDate(BASE_DAY, index * 2 + 30),
          amount_eur: Math.round((800 + random() * 45_000) / 10) * 10,
          status: pickDeterministic(INVOICE_STATUS, `inv-status-${index}`),
        }),
      },
      inventory: {
        description: 'Giacenze di magazzino con soglia di riordino.',
        fields: ['sku', 'description', 'warehouse', 'on_hand', 'reserved', 'reorder_point'],
        size: 20,
        build: (index, random) => {
          const onHand = Math.round(random() * 500);
          return {
            sku: `SKU-${pad(index + 1, 3)}`,
            description: `Componente serie ${String.fromCharCode(65 + (index % 6))}`,
            warehouse: pickDeterministic(WAREHOUSES, `inv-wh-${index}`),
            on_hand: onHand,
            reserved: Math.round(onHand * random() * 0.4),
            reorder_point: 50,
          };
        },
      },
    },
  },

  support: {
    label: 'Ticketing di supporto',
    system: 'zendesk-like',
    resources: {
      tickets: {
        description: 'Ticket di assistenza con severità, stato e tempo di primo riscontro.',
        fields: [
          'id', 'account', 'severity', 'subject', 'status', 'opened_at', 'first_response_minutes',
        ],
        size: 28,
        build: (index, random) => ({
          id: `TCK-${pad(9000 + index, 5)}`,
          account: pickDeterministic(COMPANIES, `tck-acc-${index}`),
          severity: pickDeterministic(SEVERITIES, `tck-sev-${index}`),
          subject: pickDeterministic(TICKET_SUBJECTS, `tck-sub-${index}`),
          status: pickDeterministic(TICKET_STATUS, `tck-status-${index}`),
          opened_at: isoDate(BASE_DAY, index),
          first_response_minutes: Math.round(5 + random() * 300),
        }),
      },
      csat: {
        description: 'Rilevazioni di soddisfazione post-risoluzione (scala 1-5).',
        fields: ['id', 'account', 'score', 'survey_date'],
        size: 18,
        build: (index, random) => ({
          id: `CSAT-${pad(index + 1, 4)}`,
          account: pickDeterministic(COMPANIES, `csat-acc-${index}`),
          score: 1 + Math.floor(random() * 5),
          survey_date: isoDate(BASE_DAY, index * 4),
        }),
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Esecuzione
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorCallInput {
  readonly connector: ConnectorId;
  readonly resource: string;
  readonly filters?: Readonly<Record<string, string>>;
  readonly limit?: number;
}

export interface ConnectorCallSuccess {
  readonly ok: true;
  readonly connector: ConnectorId;
  readonly resource: string;
  readonly endpoint: string;
  readonly records: readonly ConnectorRecord[];
  readonly returned: number;
  readonly totalMatching: number;
  readonly appliedFilters: Readonly<Record<string, string>>;
  readonly simulatedLatencyMs: number;
  /** Sempre `true`: l'agente deve poter dire che il dato non viene da un sistema reale. */
  readonly simulated: true;
}

export interface ConnectorCallFailure {
  readonly ok: false;
  readonly error: 'unknown_connector' | 'unknown_resource' | 'unknown_filter_field';
  readonly message: string;
  /** Alternative valide: consentono al modello di correggere la chiamata al giro dopo. */
  readonly available: readonly string[];
}

export type ConnectorCallResult = ConnectorCallSuccess | ConnectorCallFailure;

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export function listConnectorIds(): readonly string[] {
  return CONNECTOR_IDS;
}

export function listResources(connector: ConnectorId): readonly string[] {
  return Object.keys(CONNECTORS[connector].resources);
}

/** Descrizione compatta del catalogo, iniettata nella descrizione del tool. */
export function describeCatalog(): string {
  return CONNECTOR_IDS.map((id) => {
    const connector = CONNECTORS[id];
    const resources = Object.entries(connector.resources)
      .map(([name, resource]) => `${name} (${resource.fields.join(', ')})`)
      .join('; ');
    return `${id} — ${connector.label}: ${resources}`;
  }).join('\n');
}

function buildDataset(connector: ConnectorId, resourceName: string): ConnectorRecord[] {
  const resource = CONNECTORS[connector].resources[resourceName];
  if (resource === undefined) return [];
  const random = createSeededRandom(`${connector}:${resourceName}`);
  return Array.from({ length: resource.size }, (_, index) => resource.build(index, random));
}

/** Confronto case-insensitive per sottostringa: un filtro non è un'interrogazione esatta. */
function matchesFilter(record: ConnectorRecord, key: string, expected: string): boolean {
  const actual = record[key];
  if (actual === undefined) return false;
  return String(actual).toLowerCase().includes(expected.toLowerCase());
}

/**
 * Esegue una chiamata simulata.
 *
 * Sincrona e senza attese reali: la latenza è *riportata* (derivata dal seed) ma
 * non *subita*, così la suite di test non paga secondi di sleep per verificare
 * una logica di filtro.
 */
export function executeConnectorCall(input: ConnectorCallInput): ConnectorCallResult {
  const connector = CONNECTORS[input.connector];
  if (connector === undefined) {
    return {
      ok: false,
      error: 'unknown_connector',
      message: `Connettore "${input.connector}" inesistente.`,
      available: CONNECTOR_IDS,
    };
  }

  const resource = connector.resources[input.resource];
  if (resource === undefined) {
    return {
      ok: false,
      error: 'unknown_resource',
      message:
        `La risorsa "${input.resource}" non esiste sul connettore "${input.connector}". ` +
        'Richiama il tool con una delle risorse disponibili.',
      available: listResources(input.connector),
    };
  }

  const filters = input.filters ?? {};
  const unknownField = Object.keys(filters).find((key) => !resource.fields.includes(key));
  if (unknownField !== undefined) {
    return {
      ok: false,
      error: 'unknown_filter_field',
      message:
        `Il campo "${unknownField}" non esiste su ${input.connector}.${input.resource}. ` +
        'Filtrare su un campo inesistente restituirebbe zero risultati indistinguibili ' +
        'da "nessuna corrispondenza": è un errore, non una risposta vuota.',
      available: resource.fields,
    };
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(input.limit ?? DEFAULT_LIMIT)));
  const dataset = buildDataset(input.connector, input.resource);
  const matching = dataset.filter((record) =>
    Object.entries(filters).every(([key, value]) => matchesFilter(record, key, value)),
  );

  const latencyRandom = createSeededRandom(`${input.connector}:${input.resource}:latency`);
  const simulatedLatencyMs = Math.round(40 + latencyRandom() * 180);

  return {
    ok: true,
    connector: input.connector,
    resource: input.resource,
    endpoint: `GET /${input.connector}/v1/${input.resource}`,
    records: matching.slice(0, limit),
    returned: Math.min(limit, matching.length),
    totalMatching: matching.length,
    appliedFilters: filters,
    simulatedLatencyMs,
    simulated: true,
  };
}
