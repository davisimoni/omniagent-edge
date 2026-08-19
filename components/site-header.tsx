import { Hexagon } from 'lucide-react';
import Link from 'next/link';
import { NavLinks } from '@/components/nav-links';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Intestazione condivisa.
 *
 * Server component: la parte interattiva è confinata in `NavLinks` (che deve
 * conoscere il percorso corrente) e in `ThemeToggle`. Il resto non ha stato e non
 * ha motivo di finire nel bundle del client.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          aria-label="OmniAgent Edge — vai alla dashboard"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Hexagon className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden sm:inline">OmniAgent Edge</span>
        </Link>

        <NavLinks />

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted md:inline-flex">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            Edge · fra1
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
