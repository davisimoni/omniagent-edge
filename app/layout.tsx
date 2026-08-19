import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { DevModeProvider } from '@/components/dev-mode/dev-mode-provider';
import { SiteHeader } from '@/components/site-header';
import { SupportWidget } from '@/components/ui/support-widget';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-code',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'OmniAgent Edge',
    template: '%s · OmniAgent Edge',
  },
  description:
    'Piattaforma di agenti AI su Vercel Edge: ciclo ReAct osservabile, RAG ibrido su pgvector ed estrazione di dati strutturati validati.',
  applicationName: 'OmniAgent Edge',
  robots: { index: false, follow: false },
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
      <body className={`${inter.variable} ${jetbrainsMono.variable} min-h-dvh antialiased`}>
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
          </div>
          {/* Fuori dal <main>: e' un accessorio persistente, non contenuto della
              pagina, e resta montato attraverso le navigazioni client. */}
          <SupportWidget />
        </DevModeProvider>
      </body>
    </html>
  );
}
