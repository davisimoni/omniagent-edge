import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection, SubProcessorTable } from '@/components/legal/legal-page';
import { PLANS } from '@/lib/billing/plans';

export const metadata: Metadata = {
  title: 'Informativa privacy',
  description:
    'Quali dati tratta OmniAgent Edge, con quali fornitori, in quale regione e per quanto tempo.',
};

/**
 * Elenco dei sub-responsabili.
 *
 * È il primo documento che un ufficio acquisti chiede a un fornitore SaaS, e
 * l'assenza di questa tabella è da sola un motivo di scarto in una valutazione
 * B2B. Va tenuta allineata ai servizi realmente in uso: una voce di troppo è
 * una dichiarazione falsa, una di meno è una violazione dell'art. 28.
 */
const SUB_PROCESSORS = [
  {
    name: 'Vercel',
    purpose: 'Esecuzione dell’applicazione e delle funzioni Edge',
    region: 'Francoforte (fra1)',
  },
  {
    name: 'Anthropic',
    purpose: 'Analisi dei documenti e generazione dei rilievi',
    region: 'UE / Stati Uniti',
  },
  {
    name: 'Neon',
    purpose: 'Database: account, audit archiviati, consumi',
    region: 'Francoforte (eu-central-1)',
  },
  { name: 'Upstash', purpose: 'Conteggio delle richieste per il rate limiting', region: 'UE' },
  {
    name: 'Stripe',
    purpose: 'Pagamenti e fatturazione degli abbonamenti',
    region: 'UE / Stati Uniti',
  },
] as const;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Informativa privacy"
      updatedAt="20 agosto 2026"
      intro="Che cosa raccogliamo, perché, con chi lo condividiamo e per quanto lo conserviamo. Scritta per essere letta, non per essere accettata senza leggerla."
    >
      <LegalSection title="Titolare del trattamento">
        <p>
          Il titolare è l’operatore di questa installazione di OmniAgent Edge, raggiungibile
          all’indirizzo di contatto pubblicato nel proprio sito. Per le richieste sui dati
          personali si può scrivere a quell’indirizzo indicando l’oggetto della richiesta.
        </p>
      </LegalSection>

      <LegalSection title="Quali dati trattiamo">
        <p>
          <strong className="text-foreground">Dati di account.</strong> Nome, indirizzo email e
          nome del workspace, forniti alla registrazione. La password non viene mai conservata: in
          archivio resta solo una derivazione crittografica dalla quale non è ricostruibile.
        </p>
        <p>
          <strong className="text-foreground">Documenti caricati.</strong> Il testo dei contratti,
          degli SLA e dei documenti che scegli di analizzare, insieme al report che ne deriva. Sono
          i dati più sensibili che ci affidi e restano associati esclusivamente al tuo workspace.
        </p>
        <p>
          <strong className="text-foreground">Dati di utilizzo.</strong> Numero di audit eseguiti,
          token consumati e costo stimato, necessari a far rispettare i limiti del piano e a
          mostrarti quanto stai usando.
        </p>
        <p>
          <strong className="text-foreground">Indirizzo IP.</strong> Usato per limitare le
          richieste e contenere gli abusi. Non viene conservato in chiaro: è ridotto a un digest
          con sale prima di diventare una chiave, quindi non è riconducibile a te né utilizzabile
          per altro.
        </p>
      </LegalSection>

      <LegalSection title="Perché li trattiamo">
        <p>
          Per erogare il servizio che hai richiesto — esecuzione del contratto, art. 6(1)(b) GDPR —
          e per la sicurezza della piattaforma e la prevenzione degli abusi, che rientrano nel
          legittimo interesse dell’art. 6(1)(f).
        </p>
        <p>
          <strong className="text-foreground">
            I tuoi documenti non vengono usati per addestrare modelli.
          </strong>{' '}
          Vengono analizzati per produrre il tuo report e archiviati nel tuo workspace: nient’altro.
        </p>
      </LegalSection>

      <LegalSection title="Con chi li condividiamo">
        <p>
          Solo con i fornitori necessari a far funzionare il servizio, ciascuno vincolato da un
          accordo sul trattamento. L’elaborazione delle funzioni applicative è ancorata alla
          regione di Francoforte.
        </p>
        <SubProcessorTable rows={SUB_PROCESSORS} />
        <p>
          Dove un fornitore può trattare dati fuori dall’Unione Europea, il trasferimento avviene
          sulla base delle Clausole Contrattuali Standard adottate dalla Commissione europea.
        </p>
      </LegalSection>

      <LegalSection title="Per quanto li conserviamo">
        <p>
          I dati di account e i documenti archiviati restano finché il workspace esiste. Alla
          chiusura dell’account vengono eliminati entro 30 giorni, salvo quanto la legge imponga di
          conservare — per esempio i documenti contabili legati alle fatture.
        </p>
        <p>
          I contatori di consumo sono conservati per 24 mesi, il tempo necessario a ricostruire la
          fatturazione di un periodo contestato.
        </p>
      </LegalSection>

      <LegalSection title="I tuoi diritti">
        <p>
          Puoi chiedere accesso, rettifica, cancellazione, limitazione del trattamento e
          portabilità, e opporti a un trattamento fondato sul legittimo interesse (artt. 15-22
          GDPR). Rispondiamo entro un mese.
        </p>
        <p>
          Se ritieni che il trattamento violi il Regolamento, puoi presentare reclamo all’autorità
          di controllo del tuo Stato: in Italia, il Garante per la protezione dei dati personali.
        </p>
      </LegalSection>

      <LegalSection title="Cosa facciamo per proteggerli">
        <p>
          Le password sono derivate con PBKDF2-HMAC-SHA256 e sale per record. Le sessioni viaggiano
          in cookie firmati, non accessibili agli script della pagina. Ogni query filtra
          sull’organizzazione a livello di accesso al database, non con un controllo
          nell’interfaccia. Gli indirizzi che indichi per le notifiche passano da una verifica che
          impedisce di dirigere le nostre richieste verso reti interne.
        </p>
        <p>
          Nessun dato di carta di credito transita dai nostri sistemi: il pagamento è gestito
          interamente da Stripe e noi conserviamo soltanto riferimenti opachi.
        </p>
      </LegalSection>

      <LegalSection title="Prova gratuita e uso senza account">
        <p>
          Il piano {PLANS.free.name} consente {PLANS.free.auditsPerMonth} audit al mese senza carta
          di credito. È anche possibile provare l’analisi senza registrarsi: in quel caso nulla
          viene archiviato e il report esiste solo finché resta aperta la pagina.
        </p>
        <p>
          Le condizioni d’uso sono descritte nelle{' '}
          <Link href="/terms" className="font-medium text-accent underline-offset-2 hover:underline">
            condizioni di servizio
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
