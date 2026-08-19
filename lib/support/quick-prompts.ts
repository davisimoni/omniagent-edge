/**
 * Suggerimenti rapidi del riquadro di supporto.
 *
 * File separato da `knowledge.ts`, e per la stessa ragione di
 * `lib/ingestion/modes.ts`: la base di conoscenza importa il catalogo delle
 * clausole, il motore di punteggio e il limitatore per generare i fatti dalle
 * costanti reali. Il widget gira nel browser e di tutto quello ha bisogno di
 * zero: gli servono sei etichette. Importarle da lì trascinerebbe metà del
 * server dentro il bundle del client.
 *
 * Scelti per coprire i tre motivi per cui qualcuno apre davvero un riquadro di
 * supporto qui: non capisce un risultato che ha davanti, non sa da dove
 * cominciare, oppure sta valutando com'è fatto il software. Più uno sul limite
 * legale — è la domanda che conviene ricevere qui, invece di scoprirla
 * fraintesa dopo.
 */
export const QUICK_PROMPTS: readonly { label: string; prompt: string }[] = [
  {
    label: 'Come funziona il punteggio di rischio?',
    prompt: 'Come funziona il punteggio di rischio? Chi lo calcola, il modello o il codice?',
  },
  {
    label: 'Spiegami la pipeline OCR',
    prompt:
      'Spiegami la pipeline OCR: come fa il sistema a capire che un PDF è scansionato, e cosa cambia per le citazioni?',
  },
  {
    label: 'Quali clausole vengono analizzate?',
    prompt: 'Quali clausole vengono analizzate, e come fate a sapere che una manca?',
  },
  {
    label: 'Perché una citazione risulta «non trovata»?',
    prompt: 'Che cosa significa quando una citazione è marcata "NON trovata" e cosa devo farci?',
  },
  {
    label: 'Come faccio il mio primo audit?',
    prompt: 'Non sono tecnico: spiegami passo passo come faccio il mio primo audit di un contratto.',
  },
  {
    label: 'Il report vale come attestazione?',
    prompt: 'Posso usare il report come attestazione di conformità? Che valore ha legalmente?',
  },
];
