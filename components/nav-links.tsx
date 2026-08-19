'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Navigazione principale.
 *
 * La cronologia compare solo a chi ha una sessione: mostrarla a chi non è
 * autenticato produrrebbe un link che porta a una schermata di accesso, cioè
 * una promessa che l'interfaccia non mantiene.
 */
const PUBLIC_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/audit', label: 'Audit' },
  { href: '/extractor', label: 'Estrattore' },
  { href: '/pricing', label: 'Prezzi' },
] as const;

const PRIVATE_LINKS = [{ href: '/history', label: 'Cronologia' }] as const;

export function NavLinks({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname();
  const links = authenticated
    ? [...PUBLIC_LINKS.slice(0, 3), ...PRIVATE_LINKS, ...PUBLIC_LINKS.slice(3)]
    : PUBLIC_LINKS;

  return (
    <nav aria-label="Sezioni principali" className="scrollbar-slim flex items-center gap-0.5 overflow-x-auto">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            // `aria-current` è ciò che uno screen reader annuncia: il solo colore
            // non comunica "sei qui" a chi non lo vede.
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-surface-raised text-foreground'
                : 'text-muted hover:bg-surface hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
