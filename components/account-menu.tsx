'use client';

import { ChevronDown, History, LogOut, Settings2, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Menu dell'account.
 *
 * Client component perché apre e chiude; riceve dal server i soli dati da
 * mostrare, mai la sessione. Un componente client che ricevesse il token
 * finirebbe nel bundle e quindi nelle mani di qualunque script della pagina —
 * che è esattamente ciò che il cookie `httpOnly` esiste per impedire.
 */
export function AccountMenu({
  name,
  email,
  workspace,
  plan,
}: {
  name: string;
  email: string;
  workspace: string;
  plan: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handlePointer = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handlePointer);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handlePointer);
    };
  }, [open]);

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-surface-raised"
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
          {initials || <User className="size-3" aria-hidden="true" />}
        </span>
        <span className="hidden max-w-24 truncate sm:inline">{name}</span>
        <ChevronDown className="size-3 text-muted" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-2xl motion-safe:animate-omni-dialog-in"
        >
          <div className="border-b border-border px-2 py-2">
            <p className="truncate text-xs font-medium">{name}</p>
            <p className="truncate text-[11px] text-muted">{email}</p>
            <p className="mt-1.5 flex items-center gap-1.5">
              <span className="truncate text-[11px] text-muted">{workspace}</span>
              <Badge tone={plan === 'free' ? 'neutral' : 'accent'}>{plan}</Badge>
            </p>
          </div>

          <MenuLink href="/history" icon={<History className="size-3.5" />} onNavigate={() => setOpen(false)}>
            Cronologia audit
          </MenuLink>
          <MenuLink href="/settings" icon={<Settings2 className="size-3.5" />} onNavigate={() => setOpen(false)}>
            Impostazioni
          </MenuLink>

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await fetch('/api/auth/logout', { method: 'POST' });
              router.refresh();
              router.push('/');
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Esci
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted',
        'transition-colors hover:bg-surface-raised hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
