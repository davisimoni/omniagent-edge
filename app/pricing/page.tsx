import { ArrowRight, Check, Minus, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { getCurrentAccount } from '@/lib/auth/current-user';
import { PLANS, PLAN_IDS, type Plan } from '@/lib/billing/plans';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';
import { isStripeConfigured } from '@/lib/billing/stripe';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Prezzi',
  description:
    'Tre audit gratuiti al mese, senza carta. Pro a $99/mese con cronologia, confronti fra versioni e avvisi al team.',
};

export const dynamic = 'force-dynamic';

/**
 * Listino.
 *
 * **I limiti sono scritti accanto a ciò che è incluso, non in una nota.** Un
 * piano che elenca solo i vantaggi costringe chi valuta a cercare il trucco, e
 * chi cerca il trucco e non lo trova diffida invece di convertire. Dirlo prima
 * costa una riga e toglie la domanda.
 *
 * Il numero di clausole viene dal catalogo reale, non da una promessa scritta a
 * mano: se il catalogo cambia, il listino cambia con lui.
 */
export default async function PricingPage() {
  const account = await getCurrentAccount();
  const currentPlan = account?.organization.plan ?? null;
  const stripeReady = isStripeConfigured();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mx-auto max-w-2xl text-center">
        <Badge tone="accent">
          <ShieldCheck className="size-3" aria-hidden="true" />
          {CLAUSE_CATALOG.length} clausole controllate a ogni audit
        </Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Un contratto letto male costa più di un anno di abbonamento
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
          Un massimale da tre mensilità, un rinnovo tacito con disdetta a sei mesi, uno SLA senza
          penale: sono clausole che si notano il giorno in cui servono. Comincia gratis, sul tuo
          contratto vero — non su una demo.
        </p>
      </header>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PLAN_IDS.map((id) => (
          <PlanCard
            key={id}
            plan={PLANS[id]}
            current={currentPlan === id}
            authenticated={account !== null}
            stripeReady={stripeReady}
          />
        ))}
      </div>

      {!stripeReady && (
        <p
          role="status"
          className="mx-auto mt-6 max-w-2xl rounded-lg border border-warning/30 bg-warning/10 p-3 text-center text-xs leading-relaxed text-warning"
        >
          Il pagamento non è attivo su questa installazione (STRIPE_SECRET_KEY non configurata). Il
          piano Free resta pienamente utilizzabile.
        </p>
      )}

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="text-center text-xl font-semibold tracking-tight">Domande che riceviamo</h2>
        <dl className="mt-5 space-y-3">
          <Faq
            question="Che succede quando finisco i tre audit gratuiti?"
            answer="Nulla si cancella. La quota si azzera all'inizio del mese successivo e la tua cronologia resta accessibile: puoi rileggere, esportare e confrontare tutti gli audit già fatti."
          />
          <Faq
            question="Il report ha valore legale?"
            answer="No, ed è scritto in ogni pagina che produciamo. È uno strumento che accelera una revisione contrattuale mostrando dove guardare e citando il testo: la valutazione di adeguatezza e la decisione di firmare restano di chi le prende."
          />
          <Faq
            question="I miei contratti finiscono in addestramento?"
            answer="No. I documenti vengono analizzati per produrre il tuo report e archiviati nel tuo workspace. Elaborazione e archiviazione avvengono nella regione di Francoforte."
          />
          <Faq
            question="Posso disdire quando voglio?"
            answer="Sì, dalle impostazioni, senza parlare con nessuno. Alla disdetta il workspace torna al piano Free: i dati restano, cambia solo quanti audit nuovi puoi fare."
          />
        </dl>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  authenticated,
  stripeReady,
}: {
  plan: Plan;
  current: boolean;
  authenticated: boolean;
  stripeReady: boolean;
}) {
  const href =
    plan.id === 'enterprise'
      ? 'mailto:sales@example.invalid?subject=OmniAgent%20Edge%20Enterprise'
      : plan.id === 'free'
        ? authenticated
          ? '/audit'
          : '/register'
        : authenticated
          ? '/api/billing/checkout'
          : '/register';

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-surface p-5',
        plan.highlighted ? 'border-accent shadow-lg lg:-mt-3 lg:pb-8' : 'border-border shadow-sm',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
        {plan.highlighted && <Badge tone="accent">Il più scelto</Badge>}
        {current && <Badge tone="success">Il tuo piano</Badge>}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-muted">{plan.audience}</p>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{plan.priceLabel}</span>
        <span className="text-xs text-muted">{plan.period}</span>
      </p>

      <ul className="mt-4 flex-1 space-y-1.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-xs leading-relaxed">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
            {feature}
          </li>
        ))}
        {plan.limitations.map((limitation) => (
          <li
            key={limitation}
            className="flex items-start gap-2 text-xs leading-relaxed text-muted"
          >
            <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {limitation}
          </li>
        ))}
      </ul>

      {current ? (
        <p className="mt-5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-center text-xs text-muted">
          Attivo su questo workspace
        </p>
      ) : plan.id === 'pro' && authenticated && !stripeReady ? (
        <p className="mt-5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-center text-xs text-muted">
          Pagamento non configurato
        </p>
      ) : (
        <Link
          href={href}
          className={cn(
            'mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-opacity',
            plan.highlighted
              ? 'bg-accent text-accent-foreground hover:opacity-90'
              : 'border border-border bg-surface hover:bg-surface-raised',
          )}
        >
          {plan.cta}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-sm font-medium">{question}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-muted">{answer}</dd>
    </div>
  );
}
