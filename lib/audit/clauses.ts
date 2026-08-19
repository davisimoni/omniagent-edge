import type { RiskCategory, RiskSeverity } from '@/lib/audit/schema';

/**
 * Catalogo delle clausole attese in un contratto di fornitura B2B.
 *
 * Perché esiste un catalogo invece di chiedere al modello "elenca le clausole
 * mancanti": i modelli linguistici sono bravi a riconoscere ciò che c'è e
 * inaffidabili nell'enumerare ciò che manca. Un'assenza non ha un'evidenza da
 * citare, quindi non c'è nulla che ancori la risposta al documento, e il modello
 * finisce per elencare le clausole che *si aspetta* manchino in un contratto di
 * quel tipo — plausibili e non verificabili.
 *
 * Qui il compito è ribaltato: il modello valuta **una per una** le clausole di
 * questo catalogo e dichiara se ciascuna è presente, citando il testo quando lo
 * è. L'elenco delle mancanti lo calcoliamo noi, per differenza. È un compito di
 * riconoscimento, non di ricordo, e produce un risultato riproducibile: due run
 * sullo stesso documento controllano esattamente le stesse cose.
 */

export interface ClauseDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: RiskCategory;
  /** Gravità attribuita all'assenza della clausola. */
  readonly severityIfMissing: RiskSeverity;
  /** Riferimento normativo o di standard, quando esiste. */
  readonly reference: string | null;
  /** Perché conta: finisce nel report, quindi è scritto per chi decide, non per chi sviluppa. */
  readonly whyItMatters: string;
  /** Cosa cercare nel testo: guida il modello nella valutazione. */
  readonly lookFor: string;
}

export const CLAUSE_CATALOG: readonly ClauseDefinition[] = [
  // ── Protezione dei dati personali (GDPR) ──────────────────────────────────
  {
    id: 'gdpr_dpa',
    name: 'Accordo sul trattamento dei dati (DPA)',
    category: 'legal_gdpr',
    severityIfMissing: 'critical',
    reference: 'GDPR art. 28',
    whyItMatters:
      "Senza un accordo scritto che disciplini il trattamento, il titolare risponde della violazione a prescindere dall'operato del fornitore. È il presupposto di ogni altra garanzia sui dati.",
    lookFor:
      'Nomina a responsabile del trattamento, oggetto e durata del trattamento, natura e finalità, tipologie di dati e categorie di interessati.',
  },
  {
    id: 'gdpr_subprocessors',
    name: 'Disciplina dei sub-responsabili',
    category: 'legal_gdpr',
    severityIfMissing: 'high',
    reference: 'GDPR art. 28(2) e 28(4)',
    whyItMatters:
      'Senza obbligo di autorizzazione preventiva e di pari vincoli contrattuali a valle, i dati possono finire presso terzi che il titolare non ha mai valutato né può opporre.',
    lookFor:
      'Autorizzazione generale o specifica ai sub-responsabili, preavviso di sostituzione, diritto di opposizione, estensione dei medesimi obblighi.',
  },
  {
    id: 'gdpr_data_residency',
    name: 'Localizzazione dei dati e trasferimenti extra-UE',
    category: 'legal_gdpr',
    severityIfMissing: 'high',
    reference: 'GDPR capo V (artt. 44-49)',
    whyItMatters:
      'Un trasferimento fuori UE senza base giuridica idonea espone a un ordine di sospensione del flusso, che in pratica significa fermare il servizio.',
    lookFor:
      'Indicazione delle regioni di archiviazione ed elaborazione, Standard Contractual Clauses, decisioni di adeguatezza, misure supplementari.',
  },
  {
    id: 'gdpr_breach_notification',
    name: 'Notifica di violazione dei dati',
    category: 'legal_gdpr',
    severityIfMissing: 'critical',
    reference: 'GDPR artt. 33-34',
    whyItMatters:
      'Il titolare ha 72 ore per notificare all\'autorità. Se il contratto non impone al fornitore un termine più stretto, il titolare scopre la violazione quando il suo termine è già scaduto.',
    lookFor:
      'Obbligo di comunicazione senza ingiustificato ritardo, termine espresso in ore, contenuto minimo della comunicazione, obbligo di cooperazione.',
  },
  {
    id: 'gdpr_audit_rights',
    name: 'Diritto di audit e ispezione',
    category: 'legal_gdpr',
    severityIfMissing: 'medium',
    reference: 'GDPR art. 28(3)(h)',
    whyItMatters:
      'Senza diritto di verifica, la conformità del fornitore resta un\'autodichiarazione che il titolare non può contestare né dimostrare.',
    lookFor:
      'Diritto di audit diretto o tramite terzo incaricato, obbligo di mettere a disposizione le informazioni, accettazione di certificazioni equivalenti.',
  },
  {
    id: 'gdpr_deletion_return',
    name: 'Restituzione e cancellazione dei dati a fine rapporto',
    category: 'legal_gdpr',
    severityIfMissing: 'high',
    reference: 'GDPR art. 28(3)(g)',
    whyItMatters:
      'Senza obbligo e termine espressi, alla cessazione i dati restano presso il fornitore a tempo indeterminato e la reversibilità del servizio diventa una trattativa.',
    lookFor:
      'Scelta fra restituzione e cancellazione, formato di export, termine per l\'esecuzione, attestazione di avvenuta cancellazione.',
  },

  // ── Sicurezza delle informazioni (ISO/IEC 27001) ──────────────────────────
  {
    id: 'iso27001_certification',
    name: 'Certificazione ISO/IEC 27001 o equivalente',
    category: 'legal_iso27001',
    severityIfMissing: 'medium',
    reference: 'ISO/IEC 27001',
    whyItMatters:
      'Una certificazione contrattualizzata è l\'unico modo per rendere esigibile il mantenimento di un sistema di gestione della sicurezza, e non solo la sua esistenza al momento della firma.',
    lookFor:
      'Riferimento esplicito allo standard, obbligo di mantenimento per tutta la durata, consegna del certificato e dello statement of applicability.',
  },
  {
    id: 'iso27001_access_control',
    name: 'Controllo degli accessi e segregazione dei ruoli',
    category: 'security',
    severityIfMissing: 'medium',
    reference: 'ISO/IEC 27001 Annex A.5.15, A.8.2',
    whyItMatters:
      'Senza vincoli sul minimo privilegio e sulla revoca, un account di un dipendente uscito dal fornitore resta valido sui dati del cliente.',
    lookFor:
      'Principio del minimo privilegio, autenticazione a più fattori, revoca degli accessi alla cessazione, registrazione degli accessi privilegiati.',
  },
  {
    id: 'security_incident_response',
    name: 'Gestione degli incidenti di sicurezza',
    category: 'security',
    severityIfMissing: 'high',
    reference: 'ISO/IEC 27001 Annex A.5.24-A.5.28',
    whyItMatters:
      'Un incidente senza procedura contrattualizzata diventa una negoziazione mentre il servizio è fermo, cioè nel momento peggiore per negoziare.',
    lookFor:
      'Classificazione per severità, tempi di presa in carico, canale di escalation, post-mortem e azioni correttive.',
  },
  {
    id: 'business_continuity',
    name: 'Continuità operativa e disaster recovery',
    category: 'operational',
    severityIfMissing: 'medium',
    reference: 'ISO/IEC 27001 Annex A.5.29-A.5.30',
    whyItMatters:
      'Senza RTO e RPO dichiarati, la promessa di disponibilità non ha copertura nel caso che conta: il guasto grave.',
    lookFor: 'RTO, RPO, frequenza dei backup, test periodici di ripristino, sede alternativa.',
  },

  // ── Profili economici e di responsabilità ─────────────────────────────────
  {
    id: 'liability_cap',
    name: 'Limitazione di responsabilità',
    category: 'financial',
    severityIfMissing: 'high',
    reference: null,
    whyItMatters:
      "Un massimale assente o illimitato a carico del cliente sposta sul cliente un rischio non quantificabile; un massimale troppo basso a carico del fornitore rende il risarcimento simbolico rispetto al danno.",
    lookFor:
      'Massimale espresso in importo o in multiplo del canone, esclusioni (dolo, colpa grave, violazione dei dati), reciprocità del limite.',
  },
  {
    id: 'penalty_sla_credits',
    name: 'Penali e crediti di servizio per mancato SLA',
    category: 'financial',
    severityIfMissing: 'high',
    reference: null,
    whyItMatters:
      'Uno SLA senza conseguenza economica è una dichiarazione di intenti: non c\'è nulla da esigere quando viene disatteso.',
    lookFor:
      'Percentuale di credito per soglia mancata, tetto massimo, procedura e termine di richiesta, automatismo o istanza di parte.',
  },
  {
    id: 'price_revision',
    name: 'Revisione dei corrispettivi',
    category: 'financial',
    severityIfMissing: 'medium',
    reference: null,
    whyItMatters:
      "Senza un tetto e un preavviso, l'adeguamento del canone al rinnovo è unilaterale e il cliente lo scopre a fattura emessa.",
    lookFor:
      'Indice di riferimento, tetto percentuale annuo, preavviso minimo, diritto di recesso in caso di aumento oltre soglia.',
  },
  {
    id: 'indemnity',
    name: 'Manleva',
    category: 'legal_general',
    severityIfMissing: 'medium',
    reference: null,
    whyItMatters:
      'Senza manleva su proprietà intellettuale e violazione dei dati, le pretese di terzi ricadono su chi le riceve, non su chi le ha causate.',
    lookFor:
      'Ambito della manleva, obbligo di difesa in giudizio, procedura di comunicazione, controllo della difesa.',
  },
  {
    id: 'insurance',
    name: 'Coperture assicurative',
    category: 'financial',
    severityIfMissing: 'low',
    reference: null,
    whyItMatters:
      'Una manleva vale quanto la capienza patrimoniale di chi la concede: senza polizza resta una promessa.',
    lookFor: 'Tipologia di polizza, massimali, obbligo di mantenimento, consegna del certificato.',
  },

  // ── Durata, uscita e giurisdizione ────────────────────────────────────────
  {
    id: 'termination_convenience',
    name: 'Recesso senza giusta causa',
    category: 'commercial',
    severityIfMissing: 'high',
    reference: null,
    whyItMatters:
      'Senza una via di uscita ordinaria, il cliente resta vincolato anche quando il fornitore non sta violando nulla ma il servizio non serve più.',
    lookFor: 'Preavviso in giorni, eventuale corrispettivo di recesso, simmetria fra le parti.',
  },
  {
    id: 'termination_cause',
    name: 'Risoluzione per inadempimento',
    category: 'legal_general',
    severityIfMissing: 'high',
    reference: null,
    whyItMatters:
      'Senza clausola risolutiva espressa, sciogliere il contratto per un inadempimento grave richiede una causa e i suoi tempi.',
    lookFor:
      'Inadempimenti che la attivano, diffida e termine per rimediare, effetti sui corrispettivi già versati.',
  },
  {
    id: 'auto_renewal',
    name: 'Rinnovo tacito e termine di disdetta',
    category: 'commercial',
    severityIfMissing: 'medium',
    reference: null,
    whyItMatters:
      'Un rinnovo tacito con disdetta a preavviso lungo trasforma una dimenticanza di calendario in un altro anno di canone.',
    lookFor:
      'Durata iniziale, rinnovo automatico, termine e forma della disdetta, eventuale finestra di uscita.',
  },
  {
    id: 'jurisdiction_law',
    name: 'Legge applicabile e foro competente',
    category: 'legal_general',
    severityIfMissing: 'high',
    reference: null,
    whyItMatters:
      'Un foro estero o un arbitrato costoso rende antieconomico far valere qualunque altro diritto previsto dal contratto, anche quando si ha ragione.',
    lookFor:
      'Legge applicabile, foro esclusivo, eventuale clausola arbitrale, sede e regolamento dell\'arbitrato.',
  },
  {
    id: 'reversibility',
    name: 'Reversibilità e assistenza all\'uscita',
    category: 'operational',
    severityIfMissing: 'medium',
    reference: null,
    whyItMatters:
      'Senza obblighi di migrazione assistita, il costo di cambiare fornitore diventa il vero vincolo contrattuale, più della durata.',
    lookFor:
      'Formati di export, durata del periodo di assistenza, tariffe applicabili, obbligo di collaborazione con il fornitore subentrante.',
  },
];

export const CLAUSE_IDS = CLAUSE_CATALOG.map((clause) => clause.id);

const CLAUSE_BY_ID: ReadonlyMap<string, ClauseDefinition> = new Map(
  CLAUSE_CATALOG.map((clause) => [clause.id, clause]),
);

export function getClause(id: string): ClauseDefinition | undefined {
  return CLAUSE_BY_ID.get(id);
}

/** Elenco compatto iniettato nel prompt: id, nome e cosa cercare. */
export function describeClauseCatalog(): string {
  return CLAUSE_CATALOG.map(
    (clause) => `- ${clause.id} — ${clause.name}. Cerca: ${clause.lookFor}`,
  ).join('\n');
}
