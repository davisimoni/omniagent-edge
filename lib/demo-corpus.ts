/**
 * Corpus dimostrativo in-memory.
 *
 * Perché esiste: senza `DATABASE_URL` la dashboard sarebbe una demo che non
 * dimostra niente — l'agente chiamerebbe il tool di ricerca e riceverebbe
 * sempre zero risultati. Con il corpus il ciclo ReAct è osservabile davvero.
 *
 * Ogni risultato che ne proviene è marcato `backend: 'demo-corpus'` e
 * `degraded: true` fino alla UI: un dato finto etichettato è una demo, un dato
 * finto non etichettato è una bugia.
 */

export interface CorpusDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export const DEMO_CORPUS: readonly CorpusDocument[] = [
  {
    id: 'doc-sla-001',
    title: 'SLA Enterprise — tempi di risposta e disponibilità',
    content:
      'Il contratto Enterprise garantisce un primo riscontro entro 1 ora per gli incidenti di severità 1 (servizio non disponibile), entro 4 ore per la severità 2 (degrado funzionale) ed entro un giorno lavorativo per la severità 3. La disponibilità mensile garantita è del 99.95%, misurata sulle richieste andate a buon fine. Il mancato rispetto della soglia dà diritto a un credito di servizio pari al 10% del canone mensile per ogni 0.1% di disponibilità mancante, fino a un massimo del 30%.',
    source: 'contracts/sla-enterprise.md',
    metadata: { category: 'legal', version: '2026-01' },
  },
  {
    id: 'doc-onb-002',
    title: 'Onboarding cliente Enterprise — checklist operativa',
    content:
      "L'attivazione di un nuovo cliente Enterprise prevede cinque passaggi: kickoff call entro 3 giorni lavorativi dalla firma, provisioning del tenant dedicato in regione eu-central-1, import dei dati storici tramite connettore o CSV, configurazione SSO con SAML 2.0 o OIDC, e una sessione di formazione da 90 minuti per i key user. Il go-live medio è di 12 giorni lavorativi.",
    source: 'playbooks/onboarding.md',
    metadata: { category: 'ops', version: '2026-03' },
  },
  {
    id: 'doc-sec-003',
    title: 'Data residency e trattamento dei dati personali',
    content:
      'Tutti i dati dei clienti sono archiviati ed elaborati esclusivamente in Unione Europea. Il database primario risiede in eu-central-1 (Francoforte) e le funzioni serverless sono ancorate alla regione fra1: senza questo vincolo il calcolo migrerebbe alla regione di default statunitense pur con il database in UE. I sub-responsabili extra-UE sono ammessi solo con Standard Contractual Clauses in essere. Il DPA ex art. 28 GDPR è accettato in fase di registrazione registrando istante e versione del testo.',
    source: 'compliance/data-residency.md',
    metadata: { category: 'compliance', version: '2026-05' },
  },
  {
    id: 'doc-pri-004',
    title: 'Listino e struttura dei piani',
    content:
      'Il piano Starter costa 99 euro al mese e include 1 postazione e 150 conversazioni. Il piano Professional costa 279 euro al mese con 5 postazioni e 500 conversazioni. Il piano Enterprise costa 499 euro al mese con 20 postazioni, 1.500 conversazioni e i moduli avanzati. Il superamento delle soglie non blocca il servizio ma genera un avviso di upgrade; il conteggio è verificato prima di eseguire l\'azione, non dopo.',
    source: 'pricing/plans.md',
    metadata: { category: 'commercial', version: '2026-04' },
  },
  {
    id: 'doc-api-005',
    title: 'Rate limiting delle API pubbliche',
    content:
      'Le API pubbliche applicano un limite di 600 richieste al minuto per organizzazione e 60 richieste al minuto per chiave API. Superata la soglia la risposta è 429 con header Retry-After in secondi. I client devono implementare backoff esponenziale con jitter. Gli endpoint di streaming contano come una singola richiesta per connessione, indipendentemente dalla durata.',
    source: 'api/rate-limits.md',
    metadata: { category: 'engineering', version: '2026-02' },
  },
  {
    id: 'doc-inc-006',
    title: 'Procedura di gestione degli incidenti',
    content:
      "Un incidente è dichiarato quando il monitoraggio rileva un degrado superiore al 5% delle richieste per più di 3 minuti consecutivi. L'incident commander apre un canale dedicato, aggiorna la status page entro 15 minuti e coordina la mitigazione. Il post-mortem è pubblicato entro 5 giorni lavorativi ed è blameless: descrive cause, tempistiche e azioni correttive con owner e scadenza.",
    source: 'runbooks/incident-management.md',
    metadata: { category: 'ops', version: '2026-01' },
  },
  {
    id: 'doc-ret-007',
    title: 'Conservazione e cancellazione dei dati',
    content:
      "I log applicativi sono conservati 90 giorni, i log di audit 24 mesi. I documenti caricati dai clienti seguono il termine contrattuale di conservazione, calcolato e persistito al momento dell'acquisizione anziché derivato a ogni lettura: se la durata cambia, i documenti già archiviati restano legati al termine vigente quando sono stati acquisiti. La cancellazione su richiesta dell'interessato è evasa entro 30 giorni e propagata ai backup entro 35.",
    source: 'compliance/retention.md',
    metadata: { category: 'compliance', version: '2026-05' },
  },
  {
    id: 'doc-emb-008',
    title: 'Architettura RAG — chunking ed embedding',
    content:
      'I documenti sono segmentati in chunk da circa 800 token con 15% di sovrapposizione, per non spezzare un ragionamento a metà frase. Ogni chunk è indicizzato con un embedding a 1024 dimensioni e con un vettore full-text generato da colonna calcolata. La ricerca è ibrida: il ramo semantico usa la distanza coseno su indice HNSW, il ramo lessicale usa ts_rank su indice GIN, e i due elenchi sono fusi con Reciprocal Rank Fusion.',
    source: 'engineering/rag-architecture.md',
    metadata: { category: 'engineering', version: '2026-06' },
  },
  {
    id: 'doc-sup-009',
    title: 'Escalation del supporto e orari di copertura',
    content:
      "Il supporto standard è attivo dal lunedì al venerdì, 9:00-18:00 CET. Il piano Enterprise include copertura 24/7 per la severità 1 tramite reperibilità telefonica. L'escalation di secondo livello coinvolge l'ingegneria di prodotto entro 2 ore dalla presa in carico; il terzo livello richiede l'approvazione del direttore tecnico.",
    source: 'support/escalation.md',
    metadata: { category: 'support', version: '2026-03' },
  },
  {
    id: 'doc-mig-010',
    title: 'Migrazione da sistemi legacy',
    content:
      'La migrazione da un gestionale legacy avviene in tre fasi: estrazione con validazione dello schema sorgente, trasformazione con mappatura dei campi rivedibile dal cliente, e caricamento incrementale con riconciliazione. La mappatura è visibile e modificabile prima del caricamento definitivo, e un test di connessione invia un record fittizio riconoscibile come tale con la mappatura reale.',
    source: 'playbooks/legacy-migration.md',
    metadata: { category: 'ops', version: '2026-04' },
  },
];
