import { BadgeCheck, Clock, FileSearch, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { authUnavailableReason, getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';
import { PLANS } from '@/lib/billing/plans';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';

export const metadata: Metadata = {
  title: 'Crea il tuo workspace',
  description:
    'Tre audit gratuiti al mese, senza carta di credito. Ogni rilievo con la citazione del contratto.',
};

export const dynamic = 'force-dynamic';

/**
 * Registrazione.
 *
 * La colonna di sinistra non elenca funzionalità: risponde alla domanda che si
 * fa chi sta per lasciare un'email, cioè "che cosa ottengo, e che cosa mi costa
 * scoprirlo". Tre promesse verificabili — nessuna carta, un numero di clausole
 * che si può contare, una citazione per ogni rilievo — invece di aggettivi.
 */
export default async function RegisterPage() {
  if (await getCurrentAccount()) redirect('/history');

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:gap-16">
      <div className="order-2 lg:order-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Scopri che cosa hai firmato,
          <span className="text-accent"> prima di firmarlo di nuovo</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Carica un contratto fornitore. In meno di un minuto ottieni i rilievi che contano —
          penali, recesso, foro, lacune GDPR e ISO 27001 — ognuno con il passaggio esatto che lo
          genera, così puoi verificarlo invece di fidarti.
        </p>

        <ul className="mt-6 space-y-3">
          <Promise
            icon={<BadgeCheck className="size-4" />}
            title={`${PLANS.free.auditsPerMonth} audit gratuiti ogni mese`}
            body="Senza carta di credito e senza chiamata commerciale. Se non ti serve, non ne parliamo più."
          />
          <Promise
            icon={<FileSearch className="size-4" />}
            title={`${CLAUSE_CATALOG.length} clausole controllate una per una`}
            body="Non un riassunto generico: un elenco fisso, con l'esito di ciascuna e il motivo per cui conta."
          />
          <Promise
            icon={<ShieldCheck className="size-4" />}
            title="Ogni citazione verificata sul documento"
            body="Se una frase non si trova nel contratto, il report lo dice. Nessun rilievo inventato arriva a un tavolo di trattativa."
          />
          <Promise
            icon={<Clock className="size-4" />}
            title="La cronologia diventa il tuo storico fornitori"
            body="Ogni audit resta. Alla revisione successiva vedi che cosa è cambiato e se il rischio è salito o sceso."
          />
        </ul>

        <p className="mt-6 rounded-lg border border-border bg-surface-raised p-3 text-xs leading-relaxed text-muted">
          Analisi generata automaticamente a supporto della revisione contrattuale. Non sostituisce
          il parere di un legale, e il report lo dichiara in ogni pagina.
        </p>
      </div>

      <div className="order-1 lg:order-2">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">Crea il workspace</h2>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-muted">
            Trenta secondi. Il primo audit lo fai subito dopo.
          </p>
          <AuthForm
            mode="register"
            disabled={!isAuthAvailable()}
            disabledReason={authUnavailableReason()}
          />
        </div>
      </div>
    </div>
  );
}

function Promise({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{body}</p>
      </div>
    </li>
  );
}
