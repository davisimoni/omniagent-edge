'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dialogo modale, costruito sull'elemento `<dialog>` nativo.
 *
 * **Perché il nativo e non un div con un focus trap scritto a mano.** Un modale
 * accessibile deve fare quattro cose: intrappolare il focus, restituirlo
 * all'elemento che l'ha aperto, chiudersi con Escape e rendere inerte il resto
 * della pagina per gli screen reader. Riscriverle è un esercizio noto per
 * riuscire male — il focus trap perde i controlli dentro un iframe, l'inertizzazione
 * si dimentica di `aria-hidden`, la restituzione del focus salta se l'elemento
 * originale è stato smontato. `showModal()` le fa tutte e quattro, nel browser,
 * senza dipendenze e senza JavaScript da mantenere.
 *
 * Restano da aggiungere due sole cose: la chiusura sul click esterno, che il
 * nativo non prevede, e il collegamento dello stato React al ciclo di vita del
 * dialogo.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    // `showModal()` su un dialogo già aperto lancia: la guardia non è difensiva,
    // è richiesta dalla specifica.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    // L'evento `close` copre sia Escape sia `close()`: agganciarsi solo al
    // pulsante lascerebbe lo stato React aperto dopo una chiusura da tastiera.
    const handleClose = (): void => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  /**
   * Chiusura sul click esterno.
   *
   * Il backdrop non è un elemento a sé: i suoi click hanno come target il
   * `<dialog>` stesso. Si distingue confrontando le coordinate con il rettangolo
   * del contenuto — il confronto sul solo target chiuderebbe il dialogo anche
   * quando si trascina una selezione di testo fin fuori dal bordo.
   */
  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>): void => {
    if (event.target !== ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) ref.current.close();
  };

  return (
    <dialog
      ref={ref}
      onClick={handleBackdropClick}
      aria-labelledby="dialog-title"
      aria-describedby={description !== undefined ? 'dialog-description' : undefined}
      className={cn(
        'w-[min(52rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl',
        'backdrop:bg-black/50 backdrop:backdrop-blur-sm',
        'open:animate-omni-dialog-in',
        className,
      )}
    >
      <div className="flex max-h-[min(44rem,calc(100dvh-4rem))] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description !== undefined && (
              <p id="dialog-description" className="mt-1 text-xs leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Chiudi"
            className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer !== undefined && (
          <div className="border-t border-border px-5 py-3">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
