'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/audit', label: 'Audit' },
  { href: '/extractor', label: 'Estrattore' },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sezioni principali" className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            // `aria-current` è ciò che uno screen reader annuncia: il solo colore
            // non comunica "sei qui" a chi non lo vede.
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
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
