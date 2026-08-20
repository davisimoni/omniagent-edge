import Link from 'next/link';
import { Logo } from '@/components/ui/logo';

/**
 * Piè di pagina.
 *
 * Esiste per tre ragioni concrete, non per riempire lo spazio. Stripe richiede
 * che condizioni e informativa siano raggiungibili da ogni pagina prima di
 * uscire dalla modalità test; i motori di ricerca usano i link interni per
 * capire quali pagine contano; e l'avvertenza sull'output automatico deve
 * comparire dove qualcuno la incontra senza cercarla, non solo dentro un report
 * che ha già deciso di generare.
 */
const SECTIONS: readonly { title: string; links: readonly { href: string; label: string }[] }[] = [
  {
    title: 'Prodotto',
    links: [
      { href: '/audit', label: 'Audit di conformità' },
      { href: '/extractor', label: 'Estrattore' },
      { href: '/', label: 'Console agente' },
      { href: '/pricing', label: 'Prezzi' },
    ],
  },
  {
    title: 'Legale',
    links: [
      { href: '/privacy', label: 'Informativa privacy' },
      { href: '/terms', label: 'Condizioni di servizio' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface print:hidden">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:justify-between">
          <div className="max-w-sm">
            <Logo size={26} />
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Audit automatico dei contratti fornitori: rilievi GDPR e ISO 27001, penali, recesso
              e scostamenti di SLA, ciascuno con la citazione del passaggio che lo genera.
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
              Elaborazione e archiviazione nella regione di Francoforte
            </p>
          </div>

          <nav aria-label="Collegamenti del piè di pagina" className="flex gap-12">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  {section.title}
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-xs text-muted transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-8 border-t border-border pt-4">
          <p className="text-[11px] leading-relaxed text-muted">
            © {new Date().getFullYear()} OmniAgent Edge. Le analisi sono generate automaticamente a
            supporto della revisione contrattuale: non costituiscono consulenza legale né
            attestazione di conformità.
          </p>
        </div>
      </div>
    </footer>
  );
}
