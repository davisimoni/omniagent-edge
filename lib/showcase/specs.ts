/**
 * Catalogo delle scelte architetturali mostrate in Developer Mode.
 *
 * **Sui numeri nei badge.** Nessuna etichetta qui riporta una latenza inventata.
 * Un badge che dice "Edge Runtime · 12ms" su una pagina che non ha misurato
 * nulla è un numero decorativo, e chiunque sappia leggere il codice se ne
 * accorge in trenta secondi — su un'applicazione il cui argomento è "il modello
 * non produce numeri, li calcola il codice", è il dettaglio che smonta tutto il
 * resto. Le metriche qui sotto sono **vere per costruzione**: quante clausole ha
 * il catalogo, quante parole compone una finestra di confronto, quanti
 * round-trip costa un controllo di quota. Le latenze reali si vedono dove
 * vengono misurate davvero — nel pannello metriche della dashboard e nella
 * tabella dei costi di ogni audit.
 *
 * Gli spezzoni sono brevi di proposito: servono a far riconoscere il punto nel
 * file, non a sostituire la lettura del file. `file` è un percorso reale.
 */

export const SPEC_CATEGORIES = ['runtime', 'ai', 'security', 'data', 'ux'] as const;
export type SpecCategory = (typeof SPEC_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<SpecCategory, string>> = {
  runtime: 'Runtime',
  ai: 'AI',
  security: 'Sicurezza',
  data: 'Dati',
  ux: 'Interfaccia',
};

export interface ArchitectureSpec {
  readonly id: string;
  /** Testo del badge. Corto: sta accanto a un componente, non lo sostituisce. */
  readonly label: string;
  readonly category: SpecCategory;
  /** Dato vero per costruzione, non una latenza misurata altrove. */
  readonly metric: string;
  readonly headline: string;
  readonly what: string;
  /** Il perché: è la parte che distingue una scelta da un default. */
  readonly why: string;
  readonly file: string;
  readonly snippet: string;
}

export const ARCHITECTURE_SPECS: readonly ArchitectureSpec[] = [
  {
    id: 'edge-runtime',
    label: 'Edge Runtime · fra1',
    category: 'runtime',
    metric: '4 rotte su Edge',
    headline: 'Ogni rotta API gira su Edge, ancorata a Francoforte',
    what: 'Le rotte dichiarano `runtime = "edge"` e `preferredRegion = ["fra1"]`. Ogni dipendenza di questo percorso è stata scelta perché parla `fetch` e non socket TCP.',
    why: "L'agente è I/O-bound: attende il modello, il database e i connettori. Un isolate Edge parte in millisecondi contro le centinaia di un cold start serverless. Il pin di regione non è un'ottimizzazione: senza, le funzioni girerebbero nella regione di default (Virginia) e i dati dei contratti verrebbero elaborati fuori dall'UE pur avendo il database a Francoforte. È anche la scelta più veloce, perché elimina due traversate atlantiche per round-trip.",
    file: 'app/api/audit/route.ts',
    snippet: `export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';`,
  },
  {
    id: 'ndjson-streaming',
    label: 'Streaming NDJSON',
    category: 'runtime',
    metric: '1 oggetto JSON per riga',
    headline: 'La barra di avanzamento è alimentata dal server, non da un timer',
    what: "L'audit risponde in NDJSON: le fasi arrivano quando accadono e i conteggi delle clausole sono letti dall'oggetto parziale mentre il modello lo produce.",
    why: "Un audit su quaranta pagine impiega decine di secondi: senza avanzamento l'utente non distingue un'analisi in corso da una richiesta bloccata. Una barra animata a tempo è convincente finché l'operazione dura quanto previsto, e mente esattamente quando serve l'informazione vera — cioè quando è più lenta del solito. Si emette solo quando un conteggio cambia davvero: un evento per ogni delta darebbe centinaia di messaggi identici e una barra che sfarfalla.",
    file: 'app/api/audit/route.ts',
    snippet: `for await (const partial of result.partialObjectStream) {
  const clausesAssessed = partial.clauseAssessments?.length ?? 0;
  const signature = \`\${clausesAssessed}:\${redFlags}:\${slaCommitments}\`;
  if (signature === lastSignature) continue;
  lastSignature = signature;
  send({ type: 'progress', clausesAssessed, ... });
}`,
  },
  {
    id: 'citation-verification',
    label: 'Citation Verification Engine',
    category: 'ai',
    metric: 'finestre di 5 parole',
    headline: 'Ogni citazione viene ricercata nel documento sorgente',
    what: 'Il testo citato dal modello è confrontato con il documento su finestre contigue di cinque parole. Esito: confermata, parziale, non trovata, oppure non verificabile.',
    why: "È il controllo più importante del motore. Il modo peggiore di sbagliare non è mancare un rilievo — quello lo trova la revisione umana — ma produrne uno con una citazione inventata, che finisce su un tavolo di rinegoziazione dove il fornitore apre il contratto e la frase non c'è. Le finestre contigue e non un insieme di parole: una frase inesistente assemblata con termini presenti altrove nel documento supererebbe un confronto a sacchetto con punteggio pieno, perché ogni singola parola è nel testo.",
    file: 'lib/audit/citations.ts',
    snippet: `const quoteShingles = shingles(quoteWords, SHINGLE_SIZE);
const found = quoteShingles.filter((s) => sourceText.includes(s)).length;
const ratio = found / quoteShingles.length;

const verification = ratio >= VERIFIED_THRESHOLD ? 'verified'
  : ratio >= PARTIAL_THRESHOLD ? 'partial' : 'unverified';`,
  },
  {
    id: 'deterministic-scoring',
    label: 'Deterministic Risk Scoring',
    category: 'ai',
    metric: 'curva saturante, K = 25',
    headline: 'Il modello non produce mai un numero',
    what: 'Il modello trova i rilievi e cita il testo. Punteggio, fascia, clausole mancanti e raccomandazioni escono da funzioni pure e testate.',
    why: 'Un audit deve reggere davanti a un fornitore che lo contesta. Un "72/100" prodotto da un modello non regge: non si ricostruisce, non si spiega a un responsabile acquisti e cambia fra due esecuzioni sullo stesso PDF. Lo stesso numero calcolato da una funzione pura a partire da rilievi citati si ricostruisce riga per riga. La scala è super-lineare — un rilievo critico pesa venti volte uno basso, non quattro — perché la somma di venti sciocchezze non equivale a una violazione dell\'art. 28 GDPR.',
    file: 'lib/audit/scoring.ts',
    snippet: `export function pointsToScore(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round(100 * (1 - Math.exp(-points / SATURATION_CONSTANT)));
}

// Un solo rilievo critico porta la fascia a "critico",
// qualunque sia il punteggio: un revisore non promuove
// un fornitore con una non conformità maggiore.
const band = hasCritical ? 'critical' : bandFromScore;`,
  },
  {
    id: 'clause-differencing',
    label: 'Clause Differencing',
    category: 'ai',
    metric: '20 clausole nel catalogo',
    headline: 'Le clausole mancanti si ricavano per differenza, non si chiedono',
    what: 'Il modello valuta una per una le clausole di un catalogo e dichiara present / partial / absent con citazione. Le mancanti le calcola il codice.',
    why: "I modelli riconoscono bene ciò che c'è e sono inaffidabili nell'enumerare ciò che manca: un'assenza non ha evidenza da citare, quindi nulla ancora la risposta al documento, e il modello elenca le clausole che si *aspetta* manchino in un contratto simile. Ribaltare il compito lo rende riproducibile: due run controllano esattamente le stesse cose. Una clausola non valutata non viene dichiarata assente — finisce nella copertura incompleta, perché un rilievo senza evidenza non è un rilievo.",
    file: 'lib/audit/clauses.ts',
    snippet: `for (const clause of CLAUSE_CATALOG) {
  const assessment = byId.get(clause.id);
  if (assessment === undefined) {
    notAssessed.push(clause.id); // non "assente": non valutata
    continue;
  }
  if (assessment.status === 'present') continue;
  missing.push({ ...clause, status: assessment.status });
}`,
  },
  {
    id: 'error-budget-sla',
    label: 'Error-Budget SLA Math',
    category: 'ai',
    metric: 'gravità su 100 − soglia',
    headline: 'Uno scostamento di disponibilità si misura sul budget di errore',
    what: "Su una percentuale con direzione «almeno», la gravità è calcolata sul budget di indisponibilità residuo (100 − soglia) e non sulla soglia.",
    why: "Un impegno del 99,9% disatteso con un 99,5% dà uno scostamento dello 0,4% *sulla soglia*: trascurabile, a leggerlo così. In realtà il contratto concedeva uno 0,1% di indisponibilità e ne sono stati consumati quattro volte tanto — circa tre ore di fermo al mese invece di quarantatré minuti. Il confronto è aritmetico e mai interpretativo: dichiarare una violazione ha una conseguenza economica, e non deve dipendere da come un modello legge la frase «sostanzialmente in linea».",
    file: 'lib/audit/sla.ts',
    snippet: `if (isPercentage && direction === 'min' && budget > 0) {
  // 99,5% contro 99,9% non è uno scarto dello 0,4%:
  // sono 4× l'indisponibilità concessa.
  return { ratio: shortfall / budget, basis: 'error_budget' };
}
return { ratio: shortfall / Math.abs(threshold), basis: 'threshold' };`,
  },
  {
    id: 'rate-limit',
    label: 'Upstash Rate Limited',
    category: 'security',
    metric: '1 round-trip per controllo',
    headline: 'Finestra scorrevole su Redis, con ripiego dichiarato',
    what: 'INCR + PEXPIRE NX + GET in una sola pipeline REST. Quote per costo: audit 10/min, chat 30/min. Applicato nel middleware, prima che il corpo venga letto.',
    why: "Finestra scorrevole e non fissa: una finestra fissa lascia passare il doppio del limite a cavallo del confine, e chi vuole saturare la spesa in token lo scopre al primo tentativo. `x-forwarded-for` non viene letto per primo, perché è scrivibile dal client. Con Redis irraggiungibile non si apre e non si chiude: si ripiega in memoria — aprire lascerebbe la spesa senza argine proprio quando l'infrastruttura è in difficoltà, chiudere trasformerebbe un guasto accessorio in un'interruzione. Il ripiego è per istanza e lo dichiara: un limitatore che *sembra* funzionare è peggio di uno assente.",
    file: 'lib/rate-limit.ts',
    snippet: `body: JSON.stringify([
  ['INCR', currentKey],
  // NX è la parte che conta: senza, ogni richiesta
  // rinnoverebbe la scadenza e la finestra non si chiuderebbe mai.
  ['PEXPIRE', currentKey, String(ttlMs), 'NX'],
  ['GET', previousKey],
]),`,
  },
  {
    id: 'prompt-injection',
    label: 'Prompt-Injection Hardened',
    category: 'security',
    metric: '6 classi rilevate',
    headline: "L'avversario è il fornitore di cui stai leggendo il contratto",
    what: 'Rimozione dei caratteri invisibili, rilevamento delle frasi di manipolazione, incapsulamento del documento fra delimitatori con nonce.',
    why: "Modello di minaccia insolito: di solito chi carica un file è la vittima. Qui il documento è scritto dalla parte che l'analisi giudica, e che ha un interesse economico diretto a farla uscire pulita. La regola è neutralizzare e dichiarare, non cancellare: rimuovere testo visibile significherebbe analizzare un documento diverso da quello sul tavolo e manderebbe in pezzi la verifica delle citazioni. La rimozione degli invisibili precede la ricerca delle frasi, perché un «i⟨ZWSP⟩gnora le istruzioni» sfugge a ogni regex sul testo grezzo ed è esattamente ciò che il modello legge senza problemi.",
    file: 'lib/security/prompt-injection.ts',
    snippet: `// Prima si tolgono gli invisibili, poi si cercano le frasi.
const sanitized = input.replace(INVISIBLE_PATTERN, '');

for (const rule of VISIBLE_RULES) {
  rule.pattern.lastIndex = 0; // le RegExp globali trattengono stato
  const matches = sanitized.match(rule.pattern);
  if (matches !== null) findings.push({ ...rule, occurrences: matches.length });
}`,
  },
  {
    id: 'ocr-fallback',
    label: 'OCR Fallback Pipeline',
    category: 'data',
    metric: 'soglia 180 caratteri/pagina',
    headline: 'Un PDF scansionato è, per un estrattore, un PDF vuoto',
    what: 'La pipeline misura caratteri per pagina, quota di alfanumerici e caratteri di sostituzione. Sotto soglia ripiega sulla lettura visiva e ne ricava una trascrizione.',
    why: "Senza rilevamento l'audit gira su una stringa vuota e dichiara con la massima serietà che il contratto manca di venti clausole su venti: un risultato catastrofico, sicuro di sé e completamente falso. Si trascrive invece di dare il PDF al modello di audit — che lo leggerebbe benissimo — perché senza testo sorgente la verifica delle citazioni non ha nulla da confrontare e si spegne in silenzio proprio sui documenti peggiori. Il limite è dichiarato: su una scansione una citazione verificata prova la coerenza con la trascrizione, non con l'originale firmato.",
    file: 'lib/ingestion/pipeline.ts',
    snippet: `const assessment = assessExtractedText(providedText, { pageCount });

if (!assessment.needsOcr && providedText !== null) {
  return { mode: 'text', ... };          // nessun token speso
}
const ocr = await deps.transcribe(attachment);  // ripiego trasparente`,
  },
  {
    id: 'hybrid-rag',
    label: 'Hybrid RAG · RRF',
    category: 'data',
    metric: '2 rami fusi',
    headline: 'Vettoriale e full-text, fusi con Reciprocal Rank Fusion',
    what: 'Ramo semantico su pgvector (HNSW, distanza coseno) e ramo lessicale su PostgreSQL (GIN, `ts_rank_cd`), combinati per rango e non per punteggio.',
    why: 'I due rami producono punteggi su scale incomparabili: una distanza coseno e un `ts_rank_cd` non si sommano. RRF fonde per posizione in classifica, che è la sola grandezza che i due condividono, e non richiede di tarare pesi che cambierebbero a ogni variazione del corpus. Senza database la ricerca ripiega su un corpus dimostrativo in memoria, marcato `degraded: true`: nessun dato di prova passa mai per reale.',
    file: 'lib/vector.ts',
    snippet: `// I punteggi dei due rami non sono confrontabili:
// si fondono le posizioni, non i valori.
const score = 1 / (RRF_K + semanticRank) + 1 / (RRF_K + lexicalRank);`,
  },
  {
    id: 'typed-tools',
    label: 'Zod-Typed Agent Tools',
    category: 'ai',
    metric: '6 tool, 1 fonte di verità',
    headline: 'Lo schema Zod è insieme validazione e contratto verso il modello',
    what: "Ogni tool dichiara il proprio `inputSchema` in Zod. Lo stesso schema genera il JSON Schema che il modello legge e valida ciò che arriva prima dell'esecuzione.",
    why: "Con due definizioni separate — una per il modello, una per la validazione — la seconda diverge dalla prima e il tool inizia a ricevere argomenti che il suo prompt non prevede. Le dipendenze dei tool sono iniettabili, così i test coprono lo stesso `execute` che gira in produzione senza rete né modello. Un controllo di parità a compile time impedisce di aggiungere un tool senza registrarne etichetta e icona.",
    file: 'lib/tools/compliance-tools.ts',
    snippet: `export const checkContractRiskInput = z.object({
  text: z.string().min(200).max(300_000),
  focus: z.enum(RISK_FOCUS_AREAS).default('all'),
  annualValue: z.number().positive().optional(),
});`,
  },
  {
    id: 'cost-telemetry',
    label: 'Per-Stage Cost Telemetry',
    category: 'runtime',
    metric: 'costo per fase',
    headline: 'Token e costo separati fra lettura e analisi',
    what: 'Ogni audit riporta token, costo stimato e durata per fase dentro `audit.metadata.telemetry` — quindi anche nel JSON esportato e nel PDF.',
    why: "Su una scansione le due fasi hanno profili opposti: la trascrizione produce migliaia di token di output, l'analisi ne consuma in input. Un totale unico nasconde quale delle due stia spendendo, ed è l'unica informazione a partire dalla quale si può decidere qualcosa — per esempio chiedere ai fornitori contratti in PDF testuale. Se una fase usa un modello a listino ignoto, `costComplete: false` dichiara il totale per difetto invece di restituire `null` e perdere anche la parte nota.",
    file: 'lib/audit/telemetry.ts',
    snippet: `// Le fasi senza consumo vengono scartate: una riga
// "OCR — 0 token, $0" descrive qualcosa che non è successo.
const active = inputs.filter((i) => stageConsumedTokens(i.usage));
const costComplete = known.length === stages.length;`,
  },
  {
    id: 'native-dialog',
    label: 'Native <dialog> a11y',
    category: 'ux',
    metric: '4 comportamenti gratis',
    headline: 'Focus trap, Escape, inert e ritorno del focus li dà il browser',
    what: "I modali usano l'elemento `<dialog>` nativo con `showModal()`. Restano da aggiungere solo la chiusura sul click esterno e il legame con lo stato React.",
    why: "Un modale accessibile deve intrappolare il focus, restituirlo all'elemento che l'ha aperto, chiudersi con Escape e rendere inerte il resto della pagina per gli screen reader. Riscriverle è un esercizio noto per riuscire male: il trap perde i controlli dentro un iframe, l'inertizzazione dimentica `aria-hidden`, il ritorno del focus salta se l'elemento originale è stato smontato. Il nativo le fa tutte e quattro, senza dipendenze e senza codice da mantenere.",
    file: 'components/ui/dialog.tsx',
    snippet: `// showModal() su un dialogo già aperto lancia:
// la guardia è richiesta dalla specifica, non difensiva.
if (open && !dialog.open) dialog.showModal();
if (!open && dialog.open) dialog.close();`,
  },
  {
    id: 'grounded-support',
    label: 'Grounded Support Agent',
    category: 'ai',
    metric: 'fatti generati dal codice',
    headline: "L'assistente non può sbagliare le nostre costanti",
    what: 'Il prompt di sistema di OmniSupport è composto a runtime importando le costanti reali: soglie, formule, catalogo delle clausole e quote del limitatore.',
    why: "Un prompt di supporto scritto a mano è una seconda copia della documentazione, e come ogni seconda copia diverge: qualcuno cambia una soglia e per mesi l'assistente racconta quella vecchia con la stessa sicurezza. In un prodotto il cui argomento è «il modello non produce numeri», un widget che sbaglia i nostri numeri smentisce la promessa mentre la spiega. L'assistente non ha strumenti: risponde su ciò che il sistema fa, non lo esegue.",
    file: 'lib/support/knowledge.ts',
    snippet: `- Punti per gravità: basso \${SEVERITY_POINTS.low},
  medio \${SEVERITY_POINTS.medium}, alto \${SEVERITY_POINTS.high},
  critico \${SEVERITY_POINTS.critical}.
- Formula: 100 × (1 − e^(−punti / \${SATURATION_CONSTANT})).
### Catalogo delle clausole (\${CLAUSE_CATALOG.length} voci)`,
  },
];

const SPEC_BY_ID: ReadonlyMap<string, ArchitectureSpec> = new Map(
  ARCHITECTURE_SPECS.map((spec) => [spec.id, spec]),
);

export function getSpec(id: string): ArchitectureSpec | undefined {
  return SPEC_BY_ID.get(id);
}

export function specsByCategory(category: SpecCategory): ArchitectureSpec[] {
  return ARCHITECTURE_SPECS.filter((spec) => spec.category === category);
}

/** Riepilogo dello stack, per il modale di architettura. */
export const TECH_STACK: readonly { area: string; items: readonly string[] }[] = [
  { area: 'Framework', items: ['Next.js 15 (App Router)', 'React 19', 'TypeScript strict'] },
  { area: 'Runtime', items: ['Vercel Edge', 'regione fra1 (Francoforte)', 'Middleware su /api'] },
  { area: 'AI', items: ['Vercel AI SDK 7', 'Claude Opus 5', 'Zod 4 structured outputs'] },
  { area: 'Dati', items: ['PostgreSQL + pgvector', 'Neon serverless', 'RRF hybrid search'] },
  { area: 'Sicurezza', items: ['Upstash Redis', 'AES-free digest con sale', 'Sanitizzazione input'] },
  { area: 'Interfaccia', items: ['Tailwind CSS v4', 'Lucide Icons', 'dialog nativo'] },
  { area: 'Qualità', items: ['Vitest', 'tsc --noEmit', 'moduli puri e testabili'] },
];
