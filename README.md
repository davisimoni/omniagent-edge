# OmniAgent Edge

Piattaforma di agenti AI che gira interamente su **Vercel Edge**: un ciclo ReAct osservabile passo per passo, RAG ibrido su PostgreSQL + pgvector, ed estrazione di dati strutturati validati contro uno schema.

Non è una demo che si limita a mostrare uno stream di testo. La dashboard rende **la struttura** dell'esecuzione — ragionamento, chiamata di strumento, osservazione, risposta — leggendola dai `parts` del messaggio, con latenza, token e costo stimato della run.

```
Next.js 15 (App Router) · TypeScript strict · Tailwind CSS v4
Vercel AI SDK 7 · Claude Opus 5 · Zod 4 · Neon serverless (pgvector) · Vitest
```

---

## Che cosa fa

| Modulo | File | In sintesi |
|---|---|---|
| **Agente ReAct** | [`app/api/chat/route.ts`](app/api/chat/route.ts) | Loop multi-step in streaming con tre strumenti tipizzati e tetto di step |
| **Edge RAG** | [`lib/vector.ts`](lib/vector.ts) | Ricerca ibrida vettoriale + full-text, fusa con Reciprocal Rank Fusion |
| **Estrattore** | [`app/extractor/page.tsx`](app/extractor/page.tsx) | Drag-and-drop → JSON validato, con citazione a supporto di ogni entità |
| **Dashboard** | [`app/page.tsx`](app/page.tsx) | Timeline ReAct + telemetria di run, tema chiaro/scuro, mobile-first |
| **Test** | [`tests/`](tests/) | 105 unit test su strumenti, fusione, connettori, metriche e schemi |

### I tre strumenti dell'agente

| Strumento | Cosa fa |
|---|---|
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
  api/chat/route.ts       Agente ReAct in streaming (Edge)
  api/extract/route.ts    Estrazione strutturata sincrona (Edge)
  api/health/route.ts     Diagnostica di configurazione
  page.tsx                Dashboard
  extractor/page.tsx      Banco di lavoro dell'estrattore
components/
  agent-console.tsx       useChat, composer, esempi
  trace-timeline.tsx      Thought / Tool Call / Observation / Final Output
  metrics-panel.tsx       Latenza, token, costo, step
  extractor-workbench.tsx Drag-and-drop, tabella entità, esportazione JSON
lib/
  agent/tools.ts          I tre strumenti, con dipendenze iniettabili
  agent/connectors.ts     Catalogo chiuso di connettori simulati
  agent/prompt.ts         Prompt di sistema
  ai/model.ts             Modello, listino, effort, credenziali
  ai/extract.ts           generateObject condiviso fra rotta e strumento
  vector.ts               Edge RAG: embedding, RRF, ricerca ibrida
  schemas.ts              Contratti Zod condivisi
  metrics.ts              Token, costo, latenza (puro)
tests/                    105 unit test
db/schema.sql             pgvector + full-text + indici
scripts/ingest.ts         Popolamento del vector store
```

---

## Note

I record restituiti da `fetchExternalAPI` sono **simulati** e ogni risposta lo dichiara con `simulated: true`: sostituire quel modulo con chiamate HTTP reali significa riscrivere una sola funzione, perché la forma di input e output non cambia.

Le stime di costo in dashboard sono calcolate dal listino pubblico e dichiarate come stime: il dato fatturato è quello di Anthropic, e il prompt caching lo sposta verso il basso.
