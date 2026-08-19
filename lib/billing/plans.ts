/**
 * Listino e limiti dei piani.
 *
 * Fonte di verità unica: la pagina prezzi, il controllo di quota nella rotta di
 * audit e il messaggio mostrato al superamento leggono tutti da qui. Tenere il
 * numero "3 audit al mese" in tre punti diversi significa che prima o poi la
 * pagina prezzi ne promette cinque e il paywall ne concede tre — e chi ha appena
 * pagato scopre la discrepanza nel momento peggiore.
 */

export const PLAN_IDS = ['free', 'pro', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  /** Prezzo mensile in USD; `null` quando è a trattativa. */
  readonly priceUsd: number | null;
  readonly priceLabel: string;
  readonly period: string;
  /** Audit inclusi per periodo; `null` = senza tetto. */
  readonly auditsPerMonth: number | null;
  readonly seats: number | null;
  /** Frase che spiega a chi serve, non che cosa contiene. */
  readonly audience: string;
  readonly features: readonly string[];
  /** Ciò che il piano NON copre: dirlo qui evita che lo si scopra dopo. */
  readonly limitations: readonly string[];
  readonly cta: string;
  readonly highlighted: boolean;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    priceLabel: '$0',
    period: 'per sempre',
    auditsPerMonth: 3,
    seats: 1,
    audience: 'Per capire, sul tuo contratto vero, se questa analisi ti serve.',
    features: [
      '3 audit al mese',
      'Tutte le 20 clausole del catalogo',
      'Verifica delle citazioni sul documento',
      'Esportazione JSON, Markdown e PDF',
      'Cronologia degli audit',
    ],
    limitations: ['Una sola postazione', 'Nessuna notifica al team', 'Nessun confronto fra versioni'],
    cta: 'Inizia gratis',
    highlighted: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 99,
    priceLabel: '$99',
    period: 'al mese',
    auditsPerMonth: 100,
    seats: 5,
    audience: 'Per chi rinegozia contratti fornitori come parte del proprio lavoro.',
    features: [
      '100 audit al mese',
      '5 postazioni incluse',
      'Confronto fra versioni dello stesso contratto',
      'Assegnazione a un revisore del team',
      'Notifiche su Slack e Teams sui rilievi critici',
      'Lettura visiva dei PDF scansionati',
      'Cronologia completa e ricercabile',
    ],
    limitations: ['Nessun SLA contrattuale', 'Supporto via email'],
    cta: 'Passa a Pro',
    highlighted: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceUsd: null,
    priceLabel: 'Su misura',
    period: 'contratto annuale',
    auditsPerMonth: null,
    seats: null,
    audience: 'Per uffici legali e procurement con volumi, audit interni e vincoli di residenza.',
    features: [
      'Audit senza tetto',
      'Postazioni illimitate',
      'Catalogo di clausole personalizzato',
      'Residenza dei dati e DPA su misura',
      'SSO e provisioning',
      'SLA contrattuale e referente dedicato',
    ],
    limitations: [],
    cta: 'Parla con noi',
    highlighted: false,
  },
};

export const DEFAULT_PLAN: PlanId = 'free';

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Piano di un'organizzazione; valori ignoti ripiegano su `free`, mai su un piano pagato. */
export function getPlan(id: string | null | undefined): Plan {
  if (id !== null && id !== undefined && isPlanId(id)) return PLANS[id];
  return PLANS[DEFAULT_PLAN];
}

/** Piano da suggerire a chi ha esaurito la quota. */
export function nextPlanAfter(id: PlanId): Plan | null {
  if (id === 'free') return PLANS.pro;
  if (id === 'pro') return PLANS.enterprise;
  return null;
}

export const PLAN_ORDER: Readonly<Record<PlanId, number>> = { free: 0, pro: 1, enterprise: 2 };

/** True se `candidate` dà accesso ad almeno quanto `required`. */
export function planAtLeast(candidate: PlanId, required: PlanId): boolean {
  return PLAN_ORDER[candidate] >= PLAN_ORDER[required];
}

/** Funzionalità che dipendono dal piano e non da un contatore. */
export const PLAN_FEATURES = {
  versionComparison: 'pro',
  teamNotifications: 'pro',
  reviewAssignment: 'pro',
} as const satisfies Record<string, PlanId>;

export type PlanFeature = keyof typeof PLAN_FEATURES;

export function hasFeature(plan: PlanId, feature: PlanFeature): boolean {
  return planAtLeast(plan, PLAN_FEATURES[feature]);
}
