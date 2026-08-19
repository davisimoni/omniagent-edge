import type { ObservedMetric } from '@/lib/audit/schema';

/**
 * Contratto di esempio per la demo dell'audit.
 *
 * Contiene problemi reali e riconoscibili, non generici: rinnovo tacito con
 * disdetta a sei mesi, massimale di responsabilità pari a tre mensilità, foro
 * estero, sub-responsabili autorizzati in via generale senza diritto di
 * opposizione, notifica delle violazioni "senza indugio" priva di termine, SLA
 * con soglia ma senza penale. Sono i rilievi che un revisore trova davvero nei
 * contratti dei fornitori software, e servono a rendere verificabile ciò che
 * l'audit sostiene: chi legge il testo può controllare rilievo per rilievo.
 *
 * È deliberatamente incompleto sui temi GDPR, così la derivazione delle clausole
 * mancanti ha qualcosa da trovare.
 */
export const SAMPLE_CONTRACT_NAME = 'Contratto di fornitura — Nordwind Cloud Services';

export const SAMPLE_CONTRACT = `CONTRATTO DI FORNITURA DI SERVIZI CLOUD

Tra Nordwind Cloud Services GmbH, con sede in Amburgo (Germania), di seguito "il Fornitore",
e Delta Energia S.p.A., con sede in Milano, di seguito "il Cliente".

Art. 1 — Oggetto
Il Fornitore concede al Cliente l'accesso alla piattaforma Nordwind Operations in modalità
software come servizio, secondo le specifiche dell'Allegato A.

Art. 2 — Durata e rinnovo
Il presente contratto ha durata di 36 (trentasei) mesi a decorrere dal 1 marzo 2026. Alla
scadenza il contratto si intende tacitamente rinnovato per ulteriori 36 mesi, salvo disdetta
comunicata a mezzo raccomandata con almeno 6 (sei) mesi di preavviso rispetto alla scadenza.
Non è previsto recesso anticipato in assenza di inadempimento.

Art. 3 — Corrispettivi
Il canone annuo è fissato in euro 240.000 (duecentoquarantamila), fatturato trimestralmente in
via anticipata. Il Fornitore si riserva la facoltà di aggiornare il canone a ciascun rinnovo,
dandone comunicazione al Cliente.

Art. 4 — Livelli di servizio
Il Fornitore garantisce una disponibilità della piattaforma pari al 99,9% su base mensile,
calcolata sulle richieste andate a buon fine. Il tempo di presa in carico delle segnalazioni di
severità 1 non supererà i 60 minuti nell'orario di servizio. Il tempo di ripristino per
incidenti di severità 1 è fissato in 8 ore.
Il mancato raggiungimento dei livelli indicati non dà luogo ad alcun indennizzo, ferma restando
la facoltà del Cliente di segnalare l'anomalia al referente tecnico del Fornitore.

Art. 5 — Trattamento dei dati personali
Il Fornitore tratta i dati personali del Cliente in qualità di responsabile del trattamento,
nel rispetto della normativa applicabile. Il Fornitore è autorizzato in via generale a
ricorrere a sub-responsabili per l'esecuzione del servizio. In caso di violazione dei dati
personali il Fornitore informerà il Cliente senza indugio.
I dati sono ospitati presso i data center del Fornitore e dei suoi sub-responsabili.

Art. 6 — Sicurezza
Il Fornitore adotta misure tecniche e organizzative adeguate a proteggere i dati del Cliente da
accessi non autorizzati, secondo le migliori pratiche di settore.

Art. 7 — Limitazione di responsabilità
La responsabilità complessiva del Fornitore per qualsiasi titolo derivante dal presente
contratto è in ogni caso limitata a un importo pari a 3 (tre) mensilità del canone, con
esclusione del lucro cessante, del danno indiretto e della perdita di dati. La presente
limitazione si applica anche in caso di colpa grave.

Art. 8 — Proprietà intellettuale
Tutti i diritti sulla piattaforma restano in capo al Fornitore. I dati caricati dal Cliente
restano di proprietà del Cliente.

Art. 9 — Riservatezza
Le parti si obbligano a mantenere riservate le informazioni acquisite in esecuzione del
contratto, per tutta la durata dello stesso e per i 2 anni successivi.

Art. 10 — Cessazione
Alla cessazione del contratto, per qualsiasi causa, l'accesso alla piattaforma è disattivato
con effetto immediato. Eventuali attività di estrazione dati saranno quotate separatamente
secondo il listino professional services vigente.

Art. 11 — Legge applicabile e foro
Il presente contratto è regolato dalla legge tedesca. Per ogni controversia è competente in via
esclusiva il foro di Amburgo.

Art. 12 — Modifiche
Il Fornitore si riserva la facoltà di modificare le specifiche tecniche del servizio dandone
comunicazione al Cliente con 30 giorni di preavviso.`;

/**
 * Metriche misurate del periodo, in parte fuori soglia.
 *
 * `uptime_percent` 99,42% contro un impegno del 99,9% consuma quasi sei volte il
 * budget di indisponibilità concesso: è il caso che mostra perché la gravità di
 * uno scostamento percentuale non va misurata sulla soglia.
 */
export const SAMPLE_OBSERVED_METRICS: readonly ObservedMetric[] = [
  { metric: 'uptime_percent', value: 99.42, period: '2026-07' },
  { metric: 'first_response_minutes', value: 96, period: '2026-07' },
  { metric: 'restore_hours', value: 7.5, period: '2026-07' },
];

export const SAMPLE_ANNUAL_VALUE = 240_000;
