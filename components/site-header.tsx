import Link from 'next/link';
import { AccountMenu } from '@/components/account-menu';
import { ArchitectureButton } from '@/components/dev-mode/architecture-dialog';
import { NavLinks } from '@/components/nav-links';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/ui/logo';
import { getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';

/**
 * Intestazione condivisa.
 *
 * Server component: legge la sessione qui e passa ai figli soltanto i dati da
 * mostrare. Il token non attraversa mai il confine verso il client — è in un
 * cookie `httpOnly`, e passarlo a un componente client lo renderebbe leggibile
 * da qualunque script della pagina, vanificando l'attributo.
 */
export async function SiteHeader() {
  const account = await getCurrentAccount();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          aria-label="OmniAgent Edge — vai alla dashboard"
        >
          {/* Su schermo stretto resta il solo simbolo: il marchio completo
              occuperebbe metà della barra, e sotto c'è una navigazione che
              scorre già di suo. */}
          <Logo variant="icon" size={28} className="sm:hidden" />
          <Logo size={28} className="hidden sm:inline-flex" />
        </Link>

        <NavLinks authenticated={account !== null} />

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted xl:inline-flex">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            Edge · fra1
          </span>

          <ArchitectureButton />
          <ThemeToggle />

          {account !== null ? (
            <AccountMenu
              name={account.user.name}
              email={account.user.email}
              workspace={account.organization.name}
              plan={account.organization.plan}
            />
          ) : (
            isAuthAvailable() && (
              <div className="flex items-center gap-1.5">
                <Link
                  href="/login"
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  Accedi
                </Link>
                <Link
                  href="/register"
                  className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90"
                >
                  Inizia gratis
                </Link>
              </div>
            )
          )}
        </div>
      </div>
    </header>
  );
}
