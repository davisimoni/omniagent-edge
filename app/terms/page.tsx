import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/legal/legal-page';
import { PLANS } from '@/lib/billing/plans';

export const metadata: Metadata = {
  title: 'Condizioni di servizio',
  description:
    'Che cosa fa OmniAgent Edge, che cosa non fa, come funzionano abbonamento e disdetta.',
};

/**
 * Condizioni di servizio.
 *
 * Prezzi e limiti sono interpolati da `lib/billing/plans.ts`, non riscritti: un
 * documento contrattuale che promette cinque audit mentre il codice ne concede
 * tre è un impegno che non manteniamo, ed è il tipo di discrepanza che si scopre
 * in una contestazione.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Condizioni di servizio"
      updatedAt="20 agosto 2026"
      intro="Che cosa offriamo, che cosa ci impegniamo a fare e dove finisce la nostra responsabilità. In italiano corrente, perché un contratto che non si capisce non protegge nessuno."
    >
      <LegalSection title="Che cosa è questo servizio">
        <p>
          OmniAgent Edge analizza contratti di fornitura, accordi sui livelli di servizio e
          documenti affini, e produce un report con i rilievi individuati, ciascuno accompagnato
          dalla citazione del passaggio che lo genera.
        </p>
      </LegalSection>

      <LegalSection title="Che cosa NON è">
        <p>
          <strong className="text-foreground">
            Non è consulenza legale e non certifica alcuna conformità.
          </strong>{' '}
          È uno strumento che accelera una revisione contrattuale mostrando dove guardare. La
          valutazione di adeguatezza, la decisione di firmare e la responsabilità verso le autorità
          di controllo restano di chi le prende.
        </p>
        <p>
          L’analisi è generata da un modello linguistico e può contenere errori: può mancare un
          rilievo presente e può segnalarne uno che, letto nel contesto, non lo è. Per questo ogni
          citazione viene verificata automaticamente contro il documento e il report dichiara quali
          non è stato possibile ritrovare. Quelle indicazioni vanno lette, non saltate.
        </p>
        <p>
          Non usare questo servizio come unica base per decisioni contrattuali rilevanti. Fallo
          rivedere da un professionista abilitato.
        </p>
      </LegalSection>

      <LegalSection title="Account">
        <p>
          Sei responsabile delle credenziali del tuo account e delle attività svolte al suo interno.
          Se sospetti che qualcuno vi abbia accesso, cambia la password: l’operazione disconnette
          immediatamente ogni dispositivo, compreso il tuo.
        </p>
        <p>
          Un workspace può avere più persone entro il numero di postazioni del piano attivo. Chi
          amministra il workspace è responsabile di chi vi invita.
        </p>
      </LegalSection>

      <LegalSection title="Piani, pagamenti e disdetta">
        <p>
          Il piano {PLANS.free.name} include {PLANS.free.auditsPerMonth} audit al mese senza costi e
          senza carta di credito. Il piano {PLANS.pro.name} costa {PLANS.pro.priceLabel}{' '}
          {PLANS.pro.period} e include {PLANS.pro.auditsPerMonth} audit al mese e {PLANS.pro.seats}{' '}
          postazioni. Il piano {PLANS.enterprise.name} è a trattativa.
        </p>
        <p>
          Gli abbonamenti si rinnovano automaticamente alla fine di ogni periodo, finché non vengono
          disdetti. La disdetta ha effetto al termine del periodo già pagato: continui a usare il
          piano fino a quella data, dopodiché il workspace torna al piano {PLANS.free.name}.{' '}
          <strong className="text-foreground">Non cancelliamo i tuoi dati</strong> alla disdetta:
          cambia solo quanti audit nuovi puoi eseguire.
        </p>
        <p>
          I pagamenti e la gestione dell’abbonamento sono affidati a Stripe. Le quote non utilizzate
          in un periodo non si cumulano su quello successivo.
        </p>
      </LegalSection>

      <LegalSection title="Uso accettabile">
        <p>
          Non caricare documenti su cui non hai il diritto di operare. Non tentare di aggirare i
          limiti di utilizzo, di sondare l’infrastruttura o di usare il servizio per costruirne uno
          concorrente rivendendone gli output automatici come propri.
        </p>
        <p>
          Possiamo sospendere un account che comprometta la stabilità o la sicurezza della
          piattaforma, dandone comunicazione.
        </p>
      </LegalSection>

      <LegalSection title="Disponibilità">
        <p>
          Ci impegniamo a mantenere il servizio disponibile ma, sui piani {PLANS.free.name} e{' '}
          {PLANS.pro.name}, non offriamo un livello di servizio contrattualizzato. Un impegno con
          penali è oggetto del piano {PLANS.enterprise.name}.
        </p>
      </LegalSection>

      <LegalSection title="Limitazione di responsabilità">
        <p>
          Nei limiti consentiti dalla legge, la nostra responsabilità complessiva verso di te è
          limitata all’importo che ci hai corrisposto nei dodici mesi precedenti l’evento.
        </p>
        <p>
          Questo limite non si applica in caso di dolo o colpa grave, né dove la legge non ne
          ammetta l’esclusione. Se sei un consumatore, i tuoi diritti inderogabili restano
          impregiudicati.
        </p>
      </LegalSection>

      <LegalSection title="Modifiche">
        <p>
          Possiamo aggiornare queste condizioni. Le modifiche che incidono in modo sostanziale sui
          tuoi diritti vengono comunicate con almeno 30 giorni di preavviso: se non le accetti, puoi
          disdire prima che abbiano effetto.
        </p>
      </LegalSection>

      <LegalSection title="Legge applicabile">
        <p>
          Queste condizioni sono regolate dalla legge italiana. Per le controversie è competente il
          foro del luogo in cui ha sede il titolare, salvo il foro inderogabile del consumatore dove
          applicabile.
        </p>
        <p>
          Il trattamento dei dati personali è descritto nell’
          <Link
            href="/privacy"
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            informativa privacy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
