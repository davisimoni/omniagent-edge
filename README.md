# OmniAgent Edge

Piattaforma di agenti AI su **Vercel Edge**, verticalizzata su un problema B2B concreto: l'**audit automatico di conformità dei fornitori** — rischi contrattuali, violazioni di SLA, clausole penali e lacune GDPR / ISO 27001, ciascuna con citazione del passaggio che la genera.

Sotto c'è un'infrastruttura generale: ciclo ReAct osservabile passo per passo, RAG ibrido su PostgreSQL + pgvector, estrazione di dati strutturati validati contro schema. La dashboard rende **la struttura** dell'esecuzione — ragionamento, chiamata di strumento, osservazione, risposta — leggendola dai `parts` del messaggio, con latenza, token e costo stimato della run.

**Ciò che distingue questo motore da un prompt ben scritto** è che il modello non produce mai un numero. Trova le prove e le cita; punteggio di rischio, clausole mancanti, gravità degli scostamenti e raccomandazioni escono da funzioni pure e testate. Un audit deve reggere davanti a un fornitore che lo contesta, e un "72/100" generato da un modello non regge: non si ricostruisce, non si spiega e cambia fra due esecuzioni sullo stesso PDF.

```
Next.js 15 (App Router) · TypeScript strict · Tailwind CSS v4
Vercel AI SDK 7 · Claude Opus 5 · Zod 4 · Neon serverless (pgvector) · Vitest
```

---

## Che cosa fa

| Modulo | File | In sintesi |
|---|---|---|
| **Audit di conformità** | [`lib/audit/`](lib/audit/) · [`app/audit/page.tsx`](app/audit/page.tsx) | Contratto → rilievi citati, punteggio deterministico, report esecutivo |
| **Agente ReAct** | [`app/api/chat/route.ts`](app/api/chat/route.ts) | Loop multi-step in streaming con sei strumenti tipizzati e tetto di step |
| **Edge RAG** | [`lib/vector.ts`](lib/vector.ts) | Ricerca ibrida vettoriale + full-text, fusa con Reciprocal Rank Fusion |
| **Estrattore** | [`app/extractor/page.tsx`](app/extractor/page.tsx) | Drag-and-drop → JSON validato, con citazione a supporto di ogni entità |
| **Dashboard** | [`app/page.tsx`](app/page.tsx) | Timeline ReAct + telemetria di run, tema chiaro/scuro, mobile-first |
| **Sicurezza** | [`lib/rate-limit.ts`](lib/rate-limit.ts) · [`middleware.ts`](middleware.ts) | Rate limiting a finestra scorrevole e difesa anti prompt injection |
| **Ingestion** | [`lib/ingestion/`](lib/ingestion/) | Rilevamento dei PDF scansionati e ripiego su lettura visiva |
| **Assistente** | [`components/ui/support-widget.tsx`](components/ui/support-widget.tsx) | OmniSupport Edge: widget flottante, ancorato alle costanti reali |
| **Developer Mode** | [`lib/showcase/specs.ts`](lib/showcase/specs.ts) | Badge che aprono la decisione architetturale e il codice che la realizza |
| **Workspace** | [`app/history/`](app/history/) · [`lib/audits/`](lib/audits/) | Account, cronologia degli audit, confronto fra versioni, revisione umana |
| **Monetizzazione** | [`lib/billing/`](lib/billing/) · [`app/pricing/`](app/pricing/) | Piani, quote per periodo, Stripe Checkout e webhook firmato |
| **Diagnostica** | [`app/api/health/deep/`](app/api/health/deep/) | Latenze reali verso PostgreSQL, Redis e API del modello |
| **Test** | [`tests/`](tests/) | 508 unit e integration test, contrasti WCAG inclusi |

### I sei strumenti dell'agente

| Strumento | Cosa fa |
|---|---|
| `checkContractRisk` | Audit di contratto / SLA / DPA: rilievi GDPR e ISO 27001, penali, recesso, foro. Restituisce un `auditId` |
| `verifySLABreach` | Prestazioni misurate contro impegni contrattuali, forniti o cercati nel vector store |
| `generateAuditReport` | Report esecutivo con giudizio operativo, da un `auditId` già ottenuto |
| `searchVectorDB` | Ricerca ibrida su pgvector: ramo semantico (HNSW, distanza coseno) + ramo lessicale (GIN, `ts_rank_cd`), fusi con RRF |
| `extractStructuredData` | Testo libero → JSON conforme a schema Zod, con citazione letterale per ogni entità |
| `fetchExternalAPI` | CRM, ERP e ticketing in sola lettura, da un **catalogo chiuso** di connettori e risorse |

---

## Avvio rapido

```bash
npm install
cp .env.example .env.local     # inserisci ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

**Serve solo `ANTHROPIC_API_KEY`.** Senza database l'applicazione resta pienamente funzionante: la ricerca ripiega su un corpus dimostrativo in memoria, i risultati sono marcati `degraded: true` nella traccia, e l'agente è istruito a dichiararlo nella risposta. Nessun dato dimostrativo passa mai per reale.

```bash
npm test          # suite Vitest
npm run typecheck # tsc --noEmit
npm run build     # build di produzione
```

---

## Il motore di audit

Apri `/audit`, premi **Carica contratto di esempio** ed esegui. Il contratto campione contiene problemi reali e riconoscibili — rinnovo tacito con disdetta a sei mesi, massimale pari a tre mensilità, foro estero, notifica delle violazioni senza termine, SLA con soglia ma senza penale — così i rilievi si possono controllare uno per uno sul testo.

### Come funziona

```
contratto → [modello]  valuta le 20 clausole del catalogo, cita il testo, estrae gli SLA
          → [codice]   verifica ogni citazione contro il sorgente
          → [codice]   ricava le clausole mancanti per differenza dal catalogo
          → [codice]   confronta gli SLA con le prestazioni misurate
          → [codice]   calcola punteggio, fascia e raccomandazioni
          → report esecutivo + JSON esportabile
```

Solo il primo passo è affidato al modello, ed è un compito di riconoscimento con evidenza citata. Tutto il resto è aritmetica in [`lib/audit/scoring.ts`](lib/audit/scoring.ts), [`lib/audit/sla.ts`](lib/audit/sla.ts) e [`lib/audit/citations.ts`](lib/audit/citations.ts) — funzioni pure, coperte da test, deterministiche a parità di ingresso.

### Le cinque decisioni che contano

**1. Le clausole mancanti si ricavano per differenza, non si chiedono.** I modelli riconoscono bene ciò che c'è e sono inaffidabili nell'enumerare ciò che manca: un'assenza non ha evidenza da citare, quindi nulla ancora la risposta al documento. Il [catalogo](lib/audit/clauses.ts) impone di valutare **una per una** venti clausole, con citazione quando sono presenti; le mancanti le calcoliamo noi. Una clausola che il modello non ha valutato **non** viene dichiarata assente: finisce nella copertura incompleta, perché un rilievo senza evidenza non è un rilievo.

**2. Ogni citazione viene ricercata nel documento.** È il controllo più importante del motore. Il modo peggiore di sbagliare non è mancare un rilievo — quello lo trova la revisione umana — ma produrne uno con una citazione inventata, che viene portata a un tavolo di rinegoziazione dove il fornitore apre il contratto e la frase non c'è. Il confronto avviene su **finestre contigue di cinque parole**, non su un insieme di parole: una frase inesistente assemblata con termini presenti altrove supererebbe un confronto a sacchetto con punteggio pieno. L'esito entra nel report e compare accanto a ogni rilievo.

**3. Un rilievo critico porta la fascia a "critico", qualunque sia il punteggio.** Un revisore non promuove un fornitore perché ha una sola non conformità maggiore su venti controlli. Un contratto privo di clausola di notifica delle violazioni è un problema critico anche se tutto il resto è impeccabile, e una media che lo diluisce sta descrivendo il contratto sbagliato. Il campo `bandRaisedByCriticalFinding` rende l'intervento visibile invece di nasconderlo nel numero.

**4. La gravità di uno scostamento di disponibilità si misura sul budget di errore.** Un impegno del 99,9% disatteso con un 99,5% dà uno scostamento dello 0,4% *sulla soglia* — trascurabile, a leggerlo così. In realtà il contratto concedeva uno 0,1% di indisponibilità e ne sono stati consumati quattro volte tanto: circa tre ore di fermo al mese invece di quarantatré minuti. Su una percentuale con direzione "almeno" la gravità si calcola su `100 − soglia`; su tempi di risposta e conteggi resta il rapporto con la soglia.

**5. "Nessuna violazione" e "nessun dato" non sono la stessa cosa.** Il report riporta sempre gli impegni per cui non sono state fornite misure e le metriche che non corrispondono ad alcun impegno. Un audit che dichiara zero violazioni quando non ha ricevuto dati su nove metriche su dieci comunica una falsità con parole vere.

### Esportazione

JSON (l'oggetto `ContractAudit` integrale, validato contro il proprio schema Zod), Markdown, e PDF tramite la stampa del browser. Il PDF passa dal motore di stampa e non da una libreria: su Edge runtime non gira un generatore PDF lato server, e una resa su canvas produrrebbe un'immagine — un documento in cui il testo non si seleziona, non si cerca e non si copia. Un report di audit viene letto cercandoci dentro.

### Che cosa questo motore NON è

Non è uno strumento di conformità e non certifica nulla. La valutazione di adeguatezza, la decisione di firmare e la responsabilità verso le autorità di controllo restano in capo al titolare. L'avvertenza accompagna ogni audit — in interfaccia, nel JSON esportato e nel PDF — perché un rilievo generato da un modello e presentato come verdetto sposta sull'utente una responsabilità che non ha modo di valutare. Uno strumento che accelera una revisione legale è utile; uno che sembra sostituirla è un danno.

---

## Workspace, quote e team

Senza `DATABASE_URL` e `SESSION_SECRET` l'applicazione resta **pienamente utilizzabile in modo anonimo**: l'audit funziona per intero, il report si esporta, semplicemente non viene archiviato — e ogni schermata lo dichiara invece di mostrare moduli inerti. Con entrambe configurate si aprono account, cronologia, quote e avvisi al team.

### Account — [`lib/auth/`](lib/auth/)

**PBKDF2-HMAC-SHA256 a 600.000 iterazioni, non bcrypt né Argon2id.** Argon2id resta la raccomandazione OWASP e bcrypt l'alternativa consolidata, ma nessuno dei due gira su Edge senza trascinarsi un modulo WASM — e tutta l'applicazione sta su Edge per latenza e residenza dei dati. PBKDF2 è nella Web Crypto API: nativo, senza dipendenze. Il formato dell'hash è versionato (`pbkdf2$iterazioni$sale$hash`) proprio perché quel numero salirà, e `needsRehash()` aggiorna le password esistenti al login successivo senza chiedere nulla.

**Sessioni come cookie firmato, senza tabella.** Una tabella di sessioni impone una query al database su *ogni* richiesta autenticata: su Edge diventa la voce dominante della latenza. Il prezzo è che un token non si revoca singolarmente; si compensa con una durata di sette giorni e `session_version`, un contatore sull'utente che il cambio password incrementa — da quel momento ogni token emesso prima smette di valere.

### Quote e pagamenti — [`lib/billing/`](lib/billing/)

Free 3 audit/mese, Pro $99 con 100, Enterprise senza tetto. Il listino sta in [un solo file](lib/billing/plans.ts): pagina prezzi, controllo di quota e messaggio di blocco leggono da lì, così la pagina non può promettere cinque audit mentre il paywall ne concede tre.

- **`evaluateQuota` è pura** — piano, consumo e istante in ingresso, verdetto in uscita — perché un blocco va spiegato a chi lo contesta.
- **Il controllo è fail-closed**: se il database non risponde, la richiesta non passa. Il verso opposto trasformerebbe un guasto in audit illimitati per chiunque se ne accorga.
- **Il credito si scala dopo, non prima.** Addebitare un audit fallito a metà è l'errore che l'utente nota e non perdona; un audit riuscito e non contato costa a noi, ed è il verso giusto in cui sbagliare.
- **Il paywall dice tre cose**: quanto hai usato, quando si azzera, che cosa cambierebbe. Chi legge solo "quota esaurita" chiude la pagina.
- Stripe è parlato **via REST**, come Upstash: due chiamate e una HMAC non giustificano centinaia di kilobyte in un bundle Edge. Il webhook è **fail-closed sul segreto** — senza `STRIPE_WEBHOOK_SECRET` risponde 503 a chiunque, perché un endpoint che applica cambi di piano senza verificare la firma regala abbonamenti a chi ne scopre l'URL. La firma si calcola sul **corpo grezzo**: `request.text()` e mai `request.json()`.

### Cronologia e revisione — [`app/history/`](app/history/)

Il valore del primo audit è il report; il valore del ventesimo è poterli confrontare. Le versioni successive dello stesso contratto si raggruppano per `contract_key` — il nome del documento normalizzato togliendo numeri di versione, date e suffissi come "def" o "firmato".

**Un punteggio che scende è un miglioramento**, perché misura il rischio: invertirlo produrrebbe una freccia verde su un contratto peggiorato, ed è il modo più efficace di far firmare la revisione sbagliata. C'è un test dedicato solo a questo verso.

Le colonne riassuntive sono duplicate fuori dal JSONB, deliberatamente: l'elenco filtra per fascia e ordina per punteggio, e leggere quei valori da JSONB a ogni scansione impedirebbe l'uso di un indice.

### Avvisi al team — [`lib/notifications/`](lib/notifications/)

Slack, Teams ed email al superamento di una soglia, **predefinita a "solo critici"**: un canale che riceve ogni rilievo viene silenziato entro una settimana, e da quel momento non avvisa più nemmeno dei critici.

**Nessuna notifica fa fallire un audit** — il documento è già analizzato e il credito già consumato — ma un canale rotto viene *dichiarato*, perché un avviso che non parte in silenzio è peggio di un canale assente. Gli URL forniti dall'utente passano da [una guardia SSRF](lib/net/safe-url.ts) **al salvataggio e alla consegna**: `https://169.254.169.254/` non configura Slack, chiede alla nostra infrastruttura di leggere le proprie credenziali cloud. Il confronto sugli host noti è per sottodominio esatto, così `hooks.slack.com.evil.test` non passa.

### Diagnostica — [`app/api/health/deep/`](app/api/health/deep/)

`/api/health` risponde a "è configurato?". Questa rotta risponde a "risponde?": una connection string valida verso un database sospeso, una chiave revocata e un Redis irraggiungibile passano tutti il primo controllo e falliscono al primo utente. **Ogni numero è un round-trip reale**, cronometrato attorno alla chiamata — la stessa regola dei badge di Developer Mode. Una dipendenza *non configurata* non è un guasto: confonderle farebbe suonare l'allarme su ogni installazione minima.

---

## Interfaccia

### OmniSupport Edge — [`components/ui/support-widget.tsx`](components/ui/support-widget.tsx)

Riquadro di supporto flottante, presente su ogni pagina, in streaming via AI SDK. Risponde su come si usa la piattaforma, che cosa controlla un audit e perché l'architettura è fatta così.

**Il prompt non contiene numeri scritti a mano.** [`lib/support/knowledge.ts`](lib/support/knowledge.ts) importa `SATURATION_CONSTANT`, `VERIFIED_THRESHOLD`, il catalogo delle clausole e le quote del limitatore dai moduli che li definiscono, e li interpola. Un prompt di supporto compilato a mano è una seconda copia della documentazione, e come ogni seconda copia diverge: qualcuno cambia una soglia e per mesi l'assistente racconta quella vecchia con la stessa sicurezza. In un prodotto il cui argomento è *"il modello non produce numeri"*, un widget che sbaglia i nostri numeri smentisce la promessa mentre la spiega. Un test lo verifica costante per costante.

**Nessuno strumento, e non è una semplificazione.** L'agente della dashboard ne ha sei; questo nessuno. Un widget di aiuto capace di interrogare il vector store o eseguire un audit sarebbe una seconda porta verso le stesse capacità, con un prompt più corto a difenderla — e chi scrive lì è chiunque abbia aperto la pagina. Qui si risponde su ciò che il sistema fa, non lo si fa.

**Non è un modale.** Chi apre un riquadro di aiuto quasi sempre ha una domanda *su ciò che ha davanti*: un modale gli toglierebbe di vista esattamente la cosa di cui sta chiedendo. Il pannello è `aria-modal="false"`, la pagina resta navigabile, Escape chiude e il focus torna al pulsante.

### Developer Mode — [`lib/showcase/specs.ts`](lib/showcase/specs.ts)

Un interruttore nell'header accende badge accanto ai componenti: ognuno apre la decisione che quel componente realizza, con il perché, lo spezzone di codice e il file. Serve alla parte del pubblico che non è un utente ma qualcuno che valuta com'è costruito il software — e che senza un punto d'ingresso finisce a giudicare un prodotto di ingegneria dall'aspetto delle schede.

**Nessun badge riporta una latenza inventata.** Un "Edge Runtime · 12ms" su una pagina che non ha misurato nulla è un numero decorativo, e su un'applicazione il cui argomento è *"i numeri li calcola il codice"* è il dettaglio che smonta il resto. Le metriche sono vere per costruzione — quante clausole ha il catalogo, quante parole compone una finestra di confronto, quanti round-trip costa un controllo di quota — e un test lo impone rifiutando qualunque metrica in millisecondi. I tempi reali si vedono dove vengono misurati: nel pannello metriche e nella tabella dei costi di ogni audit. Un altro test verifica che ogni percorso di file citato **esista davvero**: un badge che rimanda a un file inesistente fa più danno del badge assente.

### Accessibilità

- I modali usano l'elemento **`<dialog>` nativo** con `showModal()`: focus trap, Escape, inertizzazione e ritorno del focus vengono dal browser. Riscriverli è un esercizio noto per riuscire male.
- Le voci apribili usano **`<details>`**: navigabili da tastiera, con contenuto trovabile dalla ricerca del browser anche da chiuse.
- **I contrasti sono calcolati, non scelti a occhio.** [`tests/contrast.test.ts`](tests/contrast.test.ts) legge i token OKLCH direttamente da `globals.css`, li converte in luminanza relativa e impone 4,5:1 su ogni superficie in entrambi i temi. La verifica ha trovato due difetti reali: in tema chiaro `success` era a 4,21:1 e `warning` a 3,08:1 — sotto soglia proprio sulle etichette "Basso" e "Medio", cioè sull'informazione per cui l'interfaccia esiste. Le lightness ora sono le minime che raggiungono la soglia.
- Il colore non è mai l'unico veicolo: la heatmap riporta punteggio in cifre e fascia in parole, perché una mappa che comunica solo col colore scompare nella stampa in bianco e nero — cioè nel formato in cui un report di audit circola più spesso.

---

## Difese e acquisizione

### Rate limiting — [`lib/rate-limit.ts`](lib/rate-limit.ts), [`middleware.ts`](middleware.ts)

Finestra scorrevole su Upstash Redis, con ripiego in memoria. Le quote sono per **costo**, non per uniformità: `/api/audit` ne ha 10 al minuto contro le 30 di `/api/chat`, perché un audit su quaranta pagine costa ordini di grandezza più di una ricerca.

Il protocollo REST di Upstash è parlato direttamente — `INCR` + `PEXPIRE NX` + `GET` in una sola pipeline, un round-trip. Costa trenta righe, toglie due dipendenze dal middleware (che gira su *ogni* richiesta) e rende lo store sostituibile nei test senza montare un finto modulo.

Quattro decisioni che vale la pena guardare:

- **`x-forwarded-for` non viene letto per primo.** È un header che il client può scrivere: chi vuole quota infinita lo cambia a ogni richiesta. Si usa `x-vercel-forwarded-for`, che scrive la piattaforma; di XFF si prende semmai l'**ultimo** salto, non il primo. C'è un test dedicato a questo aggiramento.
- **Gli IP diventano digest prima di toccare Redis.** Un indirizzo IP è un dato personale (art. 4 GDPR): tenerlo in chiaro come chiave costruisce un registro di chi ha usato il servizio e quando, su un archivio di terza parte, per una finalità non dichiarata. Il sale evita che i quattro miliardi di IPv4 si provino in pochi minuti.
- **Con Redis irraggiungibile non si apre e non si chiude: si ripiega in memoria.** Aprire lascerebbe la spesa in token senza argine proprio quando l'infrastruttura è in difficoltà; chiudere trasformerebbe un guasto Redis in un'interruzione del prodotto.
- **Il ripiego in memoria è per istanza, e lo dichiara.** Con quattro istanze attive il limite effettivo è quattro volte quello configurato. `x-ratelimit-degraded: true` lo dice invece di lasciar credere il contrario: un limitatore che *sembra* funzionare è peggio di uno assente.

### Prompt injection — [`lib/security/prompt-injection.ts`](lib/security/prompt-injection.ts)

Qui il modello di minaccia è insolito, ed è il motivo per cui il modulo esiste. Di solito chi carica un file è la vittima potenziale. In un audit no: **il documento è scritto dal fornitore, cioè dalla parte che l'analisi giudica**, e che ha un interesse economico diretto a farla uscire pulita. Testo bianco su bianco a fondo pagina, caratteri a larghezza zero, una riga che nessun umano leggerà mai — e l'audit riporta zero rilievi su un contratto che ne ha dodici.

**La regola: si neutralizza e si dichiara, non si cancella.** Rimuovere testo visibile significherebbe analizzare un documento diverso da quello sul tavolo, e manderebbe in pezzi il controllo su cui si regge tutto il resto — la verifica delle citazioni. Vengono tolti solo i caratteri **invisibili**, che in un contratto non hanno uso legittimo; il resto viene segnalato all'utente e, quando l'occultamento è provato, compare in testa al report come avviso di integrità.

L'ordine conta: prima si rimuovono i caratteri invisibili, poi si cercano le frasi. Un `i<ZWSP>gnora le istruzioni precedenti` sfugge a qualunque regex sul testo grezzo, ed è esattamente ciò che il modello legge senza problemi. Le regole sono deliberatamente specifiche: un test verifica che il contratto di esempio — pieno di clausole problematiche ma non manipolato — **non** faccia scattare nulla, perché un allarme che scatta sempre viene disattivato dopo tre giorni.

L'avviso di manomissione sta **fuori** da `redFlags`, e non per distrazione: quell'array ha un invariante — ogni voce porta una citazione ritrovata nel documento — e un rilievo sui caratteri invisibili non può averla, dato che quei caratteri sono stati rimossi. Infilarlo lì falserebbe il conteggio di affidabilità delle citazioni.

### Ingestion e fallback OCR — [`lib/ingestion/`](lib/ingestion/)

Un PDF scansionato è, per un estrattore di testo, un PDF vuoto. Non fallisce: restituisce zero caratteri. Se nessuno se ne accorge, l'audit gira su una stringa vuota e riporta con la massima serietà che il contratto **manca di venti clausole su venti** — un risultato catastrofico, sicuro di sé e completamente falso. È il peggior modo di sbagliare per questo prodotto, e [`assess.ts`](lib/ingestion/assess.ts) esiste per intercettarlo: caratteri per pagina, quota di alfanumerici, caratteri di sostituzione.

Quando il testo manca o è degradato, la pipeline ripiega sulla lettura visiva del modello e ne ricava una trascrizione. **Perché trascrivere invece di dare il PDF direttamente al modello di audit** — che lo leggerebbe benissimo: senza un testo sorgente la verifica delle citazioni non ha nulla da confrontare, restituisce `no-source` su ogni rilievo, e il controllo che regge l'affidabilità dell'audit si spegne in silenzio proprio sui documenti peggiori. La trascrizione ricrea quel sorgente.

Il limite viene detto, non nascosto: su una scansione una citazione verificata dimostra che il rilievo è coerente con la **trascrizione**, non con l'originale. `provenanceNote()` lo scrive nel report, perché è la sfumatura che sparisce quando il documento viene letto sei mesi dopo da qualcun altro.

Il ripiego è trasparente ma non silenzioso, e degrada invece di interrompere: se la trascrizione fallisce, l'allegato passa comunque al modello di audit con meno garanzie e un avviso esplicito.

### Costi per fase — [`lib/audit/telemetry.ts`](lib/audit/telemetry.ts)

Ogni audit riporta token, costo stimato e durata **per fase** — lettura e analisi — dentro `audit.metadata.telemetry`, quindi anche nel JSON esportato e nel PDF. Non è un totale unico per una ragione precisa: su una scansione le due fasi hanno profili opposti (la trascrizione produce migliaia di token di output, l'analisi ne consuma in input) e il totale nasconde quale delle due stia spendendo. Sapere che a costare è l'OCR è l'unica informazione a partire dalla quale si può decidere qualcosa — per esempio chiedere ai fornitori contratti in PDF testuale.

Se una fase usa un modello a listino ignoto, `costComplete: false` dichiara il totale per difetto invece di restituire `null` e perdere anche la parte nota.

---

## Vector store (facoltativo)

```bash
# 1. Crea un database Neon o Supabase in regione UE (eu-central-1)
psql "$DATABASE_URL" -f db/schema.sql

# 2. Imposta DATABASE_URL, EMBEDDINGS_API_URL e EMBEDDINGS_API_KEY in .env.local
npm run db:ingest                    # indicizza il corpus dimostrativo
npm run db:ingest -- documenti.json  # oppure i tuoi documenti
```

Anthropic non espone un endpoint di embedding: [`lib/vector.ts`](lib/vector.ts) usa un **seam agnostico rispetto al fornitore** che accetta qualunque endpoint compatibile OpenAI (Voyage AI, Mistral, gateway self-hosted). Senza configurazione, fuori produzione, ripiega su un embedder deterministico locale; **in produzione lancia** invece di ripiegare.

---

## Deploy su Vercel

```bash
vercel --prod
```

[`vercel.json`](vercel.json) fissa la regione a `fra1` e ogni rotta dichiara `preferredRegion = ['fra1']`. Senza questo pin le funzioni girerebbero nella regione di default (`iad1`, Virginia): il database resterebbe in UE ma **ogni query verrebbe elaborata negli Stati Uniti**. È anche la configurazione più veloce, perché elimina due traversate atlantiche per round trip.

Variabili d'ambiente: vedi [`.env.example`](.env.example). L'unica obbligatoria è `ANTHROPIC_API_KEY`.

---

## Scelte di progetto

Le decisioni che meritano una spiegazione — il resto è documentato in linea nel codice.

### Perché Edge, e cosa ha vincolato

L'agente è I/O-bound: attende il modello, il database, i connettori. Un isolate Edge parte in millisecondi contro le centinaia di un cold start serverless, e su una run che ne dura qualche migliaio è la differenza fra reattivo e no.

Il vincolo che ne discende è che **ogni dipendenza del percorso deve parlare `fetch`, non socket TCP**. Da qui il driver HTTP di Neon al posto di `pg`, e le due query della ricerca ibrida spedite in **un'unica transazione** — un solo round trip, perché su Edge la latenza di rete pesa più dell'esecuzione delle query messe insieme.

### Perché Reciprocal Rank Fusion, e non una media dei punteggi

Distanza coseno e `ts_rank_cd` vivono su scale incomparabili: nessuna normalizzazione lineare le rende sommabili in modo sensato. RRF somma `peso / (k + posizione)` — cioè usa la **posizione in classifica**, che è confrontabile per costruzione. La funzione è pura e sta in [`lib/vector.ts`](lib/vector.ts); è la parte che i test coprono più a fondo.

### Il ciclo ReAct è strutturale, non testuale

Il prompt di sistema **non** impone un formato "Thought → Action → Observation". Su Opus 5 il ragionamento adattivo è già attivo, e un prompt che detta quel formato produce un agente che *recita* il ciclo nel testo invece di eseguirlo con gli strumenti.

Il ciclo qui lo realizza il loop di `streamText` con `stopWhen: stepCountIs(...)`, e la dashboard lo rende leggendo i blocchi di `reasoning` e le tool call — non parsando l'output. Per questo la rotta imposta `sendReasoning: true` e `thinking.display: 'summarized'`: su Opus 5 il default è `omitted`, e senza quelle due righe la timeline mostrerebbe il *cosa* senza il *perché*.

### Il tool delle API enterprise non accetta URL

`fetchExternalAPI` accetta un `connector` e una `resource` scelti da un catalogo chiuso, mai un indirizzo. Un tool che accetta URL arbitrari è una SSRF con il prompt come vettore: basta un documento indicizzato che "suggerisca" di consultare `169.254.169.254` e l'agente esfiltra le credenziali dell'istanza. Vincolare l'input a un'enumerazione rende quella classe di attacchi **irrappresentabile**, non semplicemente filtrata.

Sullo stesso principio, il `tenantId` della ricerca lo decide il server e non compare in nessuno schema di strumento.

### Gli errori non escono dal loop

Un guasto di uno strumento diventa un risultato `{ ok: false, message, hint }`, non un'eccezione. Un'eccezione interromperebbe una run già a metà stream; un errore descritto — con l'elenco dei valori validi — permette al modello di correggersi allo step successivo, che è esattamente il punto del ciclo ReAct. I test lo verificano esplicitamente.

### Un vuoto dichiarato vale più di un vuoto riempito

Gli schemi di output usano sistematicamente `.nullable()` e mai `.optional()`. Con gli structured output un campo opzionale sparisce dalla lista `required` del JSON Schema, e un modello che non trova un dato tende a omettere la chiave anziché dichiarare di non averlo trovato: `null` è un'informazione, una chiave assente è un'ambiguità.

Per lo stesso motivo ogni entità estratta porta una **citazione letterale** dal documento, e ciò che il documento non dice finisce in `openQuestions` invece di essere colmato con una supposizione.

### Il corpus dimostrativo, e perché è a 4096 dimensioni

Senza database la ricerca usa un embedder locale basato su hashing trick. A 256 dimensioni le collisioni fra bucket producevano similarità spurie: una query priva di senso otteneva un punteggio positivo su metà del corpus, e l'agente avrebbe citato documenti irrilevanti per **qualunque** domanda. A 4096 le collisioni spariscono — le query senza corrispondenza vanno a zero secco — mentre quelle pertinenti restano fra 0,16 e 0,40. È il motivo per cui il filtro può essere un semplice `score > 0` invece di una soglia arbitraria da tarare.

Gli embedding del corpus sono memoizzati per identità dell'array, così il costo si paga una volta sola.

---

## Struttura

```
middleware.ts             Rate limiting di bordo su /api, prima che il corpo venga letto
db/schema-app.sql         Utenti, workspace, audit archiviati, consumi, notifiche
app/
  api/audit/route.ts      Audit in streaming NDJSON, con avanzamento reale (Edge)
  api/auth/               Registrazione, accesso, uscita (Edge)
  api/billing/checkout/   Avvio di Stripe Checkout
  api/webhooks/stripe/    Webhook firmato, fail-closed sul segreto
  api/health/deep/        Sonde reali su database, Redis e modello
  history/                Cronologia del workspace e dettaglio di un audit
  pricing/                Listino
  settings/               Profilo, piano, avvisi al team, diagnostica
  login/  register/       Autenticazione
  api/support/route.ts    Assistente di supporto in streaming, senza strumenti (Edge)
  api/chat/route.ts       Agente ReAct in streaming (Edge)
  api/extract/route.ts    Estrazione strutturata sincrona (Edge)
  api/health/route.ts     Diagnostica di configurazione
  page.tsx                Dashboard
  audit/page.tsx          Banco di lavoro dell'audit
  extractor/page.tsx      Banco di lavoro dell'estrattore
components/
  ui/support-widget.tsx   Riquadro di supporto flottante, non modale
  ui/dialog.tsx           Modale su <dialog> nativo: focus trap e Escape dal browser
  dev-mode/               Provider, badge di architettura e vetrina dello stack
  audit/audit-onboarding.tsx  Guida in tre passi, congedabile e riapribile
  audit/audit-skeleton.tsx    Scheletro del risultato durante l'analisi
  audit-workbench.tsx     Caricamento, metriche osservate, esportazione
  audit/audit-progress.tsx  Barra di avanzamento alimentata dal server
  audit/risk-heatmap.tsx    Mappa di calore per area + indicatore complessivo
  audit/audit-result.tsx    Rilievi citati, clausole, SLA, radice di stampa
  agent-console.tsx       useChat, composer, esempi
  trace-timeline.tsx      Thought / Tool Call / Observation / Final Output
  metrics-panel.tsx       Latenza, token, costo, step
  extractor-workbench.tsx Drag-and-drop, tabella entità, esportazione JSON
lib/
  auth/password.ts        PBKDF2 via Web Crypto, formato versionato
  auth/session.ts         Cookie firmato HMAC, senza tabella di sessioni
  auth/repository.ts      Account e workspace, con isolamento per organizzazione
  audits/repository.ts    Archivio, filtri, versioni, confronto (puro)
  billing/plans.ts        Listino: unica fonte per prezzi e limiti
  billing/quota.ts        Verdetto di quota, puro e fail-closed
  billing/stripe.ts       Checkout e verifica firma webhook, via REST
  notifications/dispatch.ts  Slack, Teams ed email; non lancia mai
  net/safe-url.ts         Guardia SSRF sugli URL forniti dall'utente
  db/client.ts            Client PostgreSQL condiviso
  support/knowledge.ts    Prompt dell'assistente generato dalle costanti reali
  support/quick-prompts.ts  Etichette senza dipendenze, per il bundle client
  showcase/specs.ts       Catalogo delle decisioni mostrate in Developer Mode
  rate-limit.ts           Finestra scorrevole, Upstash via REST, ripiego in memoria
  security/prompt-injection.ts  Sanitizzazione e rilevamento nei documenti non fidati
  ingestion/assess.ts     Rileva i PDF scansionati prima che l'audit giri sul vuoto (puro)
  ingestion/ocr.ts        Trascrizione visiva: ricrea il sorgente per le citazioni
  ingestion/pipeline.ts   Testo / scansione / allegato: un percorso unico, degrada e lo dice
  ingestion/modes.ts      Etichette senza dipendenze: tiene l'SDK fuori dal bundle client
  audit/telemetry.ts      Token, costo e durata per fase (puro)
  audit/schema.ts         Contratti Zod: cosa produce il modello, cosa calcoliamo noi
  audit/clauses.ts        Catalogo delle 20 clausole attese
  audit/scoring.ts        Punteggio, clausole mancanti, raccomandazioni (puro)
  audit/citations.ts      Verifica delle citazioni contro il sorgente (puro)
  audit/sla.ts            Confronto aritmetico degli impegni di servizio (puro)
  audit/engine.ts         Orchestrazione modello + assemblaggio (assembleAudit è puro)
  audit/report.ts         Report esecutivo in Markdown (puro)
  audit/stream.ts         Protocollo NDJSON di avanzamento
  tools/compliance-tools.ts  I tre strumenti di audit, con registro di run
  agent/tools.ts          Strumenti generali, con dipendenze iniettabili
  agent/connectors.ts     Catalogo chiuso di connettori simulati
  agent/prompt.ts         Prompt di sistema
  ai/model.ts             Modello, listino, effort, credenziali
  ai/extract.ts           generateObject condiviso fra rotta e strumento
  vector.ts               Edge RAG: embedding, RRF, ricerca ibrida
  schemas.ts              Contratti Zod condivisi
  metrics.ts              Token, costo, latenza (puro)
tests/                    508 test
db/schema.sql             pgvector + full-text + indici
scripts/ingest.ts         Popolamento del vector store
```

---

## Note

I record restituiti da `fetchExternalAPI` sono **simulati** e ogni risposta lo dichiara con `simulated: true`: sostituire quel modulo con chiamate HTTP reali significa riscrivere una sola funzione, perché la forma di input e output non cambia.

Le stime di costo in dashboard sono calcolate dal listino pubblico e dichiarate come stime: il dato fatturato è quello di Anthropic, e il prompt caching lo sposta verso il basso.
