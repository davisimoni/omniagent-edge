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
| **Test** | [`tests/`](tests/) | 249 unit test su audit, strumenti, fusione, connettori, metriche e schemi |

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
app/
  api/audit/route.ts      Audit in streaming NDJSON, con avanzamento reale (Edge)
  api/chat/route.ts       Agente ReAct in streaming (Edge)
  api/extract/route.ts    Estrazione strutturata sincrona (Edge)
  api/health/route.ts     Diagnostica di configurazione
  page.tsx                Dashboard
  audit/page.tsx          Banco di lavoro dell'audit
  extractor/page.tsx      Banco di lavoro dell'estrattore
components/
  audit-workbench.tsx     Caricamento, metriche osservate, esportazione
  audit/audit-progress.tsx  Barra di avanzamento alimentata dal server
  audit/risk-heatmap.tsx    Mappa di calore per area + indicatore complessivo
  audit/audit-result.tsx    Rilievi citati, clausole, SLA, radice di stampa
  agent-console.tsx       useChat, composer, esempi
  trace-timeline.tsx      Thought / Tool Call / Observation / Final Output
  metrics-panel.tsx       Latenza, token, costo, step
  extractor-workbench.tsx Drag-and-drop, tabella entità, esportazione JSON
lib/
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
tests/                    249 unit test
db/schema.sql             pgvector + full-text + indici
scripts/ingest.ts         Popolamento del vector store
```

---

## Note

I record restituiti da `fetchExternalAPI` sono **simulati** e ogni risposta lo dichiara con `simulated: true`: sostituire quel modulo con chiamate HTTP reali significa riscrivere una sola funzione, perché la forma di input e output non cambia.

Le stime di costo in dashboard sono calcolate dal listino pubblico e dichiarate come stime: il dato fatturato è quello di Anthropic, e il prompt caching lo sposta verso il basso.
