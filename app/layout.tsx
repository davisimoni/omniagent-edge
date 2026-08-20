import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { DevModeProvider } from '@/components/dev-mode/dev-mode-provider';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SupportWidget } from '@/components/ui/support-widget';
import './globals.css';

/*
 * Nessun `next/font/google` qui, ed è deliberato.
 *
 * Quell'import scarica i file dei caratteri a ogni compilazione con cache
 * vuota: la disponibilità di Google diventa una condizione per il deploy, e
 * durante lo sviluppo di questo progetto ha fatto fallire il build tre volte
 * senza che una riga di codice fosse in causa. Gli elenchi di caratteri di
 * sistema vivono ora in `app/globals.css`.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://omniagent-edge.vercel.app';
const DESCRIPTION =
  'Audit automatico dei contratti fornitori: rilievi GDPR e ISO 27001, penali, recesso e ' +
  'scostamenti di SLA, ciascuno con la citazione del passaggio che lo genera.';

/**
 * Metadati.
 *
 * `metadataBase` è obbligatorio perché OpenGraph vuole URL assoluti: senza,
 * Next emette percorsi relativi che i crawler non risolvono, e l'anteprima
 * condivisa resta vuota proprio dove serve — in un messaggio Slack o LinkedIn,
 * cioè nel modo in cui questo prodotto viene davvero mostrato a qualcuno.
 *
 * L'indicizzazione è ora attiva: `noindex` aveva senso finché non esistevano
 * pagine pubbliche, e oggi listino, informativa e condizioni sono esattamente le
 * pagine che devono essere trovabili.
 */
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'OmniAgent Edge — audit dei contratti fornitori',
    template: '%s · OmniAgent Edge',
  },
  description: DESCRIPTION,
  applicationName: 'OmniAgent Edge',
  keywords: [
    'audit contratti',
    'conformità fornitori',
    'GDPR art. 28',
    'ISO 27001',
    'violazioni SLA',
    'contract risk',
    'vendor compliance',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'OmniAgent Edge',
    locale: 'it_IT',
    url: APP_URL,
    title: 'OmniAgent Edge — audit dei contratti fornitori',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OmniAgent Edge — audit dei contratti fornitori',
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#111114' },
  ],
};

/**
 * Applica il tema prima del primo paint.
 *
 * Deve essere uno script inline e sincrono: qualunque soluzione in React girerebbe
 * dopo l'idratazione, e l'utente vedrebbe un lampo di tema chiaro prima che il
 * suo tema scuro venga applicato. Il `try` copre localStorage negato (Safari in
 * navigazione privata, cookie di terze parti bloccati in iframe), dove l'accesso
 * lancia invece di restituire null.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('omniagent-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = stored === 'dark' || (stored !== 'light' && prefersDark);
    document.documentElement.classList.toggle('dark', useDark);
  } catch (e) {
    /* Preferenza non leggibile: resta il tema di sistema via CSS. */
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        {/* Il salto al contenuto è la prima tabulazione utile per chi naviga da tastiera. */}
        <a
          href="#contenuto"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-foreground"
        >
          Vai al contenuto
        </a>
        {/* Il provider avvolge tutto: i badge di Developer Mode stanno accanto ai
            componenti che spiegano, quindi lo stato deve essere leggibile da
            qualunque punto dell'albero. */}
        <DevModeProvider>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            <main id="contenuto" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
          {/* Fuori dal <main>: e' un accessorio persistente, non contenuto della
              pagina, e resta montato attraverso le navigazioni client. */}
          <SupportWidget />
        </DevModeProvider>
      </body>
    </html>
  );
}
