import { cn } from '@/lib/utils';

/**
 * Scheletro del risultato durante l'analisi.
 *
 * **Perché uno scheletro e non un solo indicatore di caricamento.** La barra di
 * avanzamento dice *quanto manca*; lo scheletro dice *che cosa arriverà*. Chi
 * aspetta trenta secondi il primo audit della sua vita non sa se otterrà un
 * numero, un elenco o un documento, e il vuoto sotto la barra è l'unica parte
 * dell'attesa che si può riempire di informazione utile.
 *
 * La forma ricalca quella del risultato vero — indicatore, mattonelle per area,
 * schede di rilievo — così il passaggio da scheletro a contenuto non sposta il
 * riquadro sotto il cursore di chi stava già leggendo.
 */
function Bar({ className }: { className?: string }) {
  return <div className={cn('omni-skeleton rounded', className)} />;
}

export function AuditSkeleton() {
  return (
    <div
      // Il contenuto è decorativo: l'avanzamento reale è annunciato dalla barra,
      // e far leggere a uno screen reader una dozzina di rettangoli vuoti
      // sarebbe rumore al posto di un'informazione.
      aria-hidden="true"
      className="space-y-6 print:hidden"
    >
      {/* Esito */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="omni-skeleton size-[104px] shrink-0 rounded-full" />
            <div className="space-y-2">
              <Bar className="h-5 w-40" />
              <Bar className="h-3 w-64" />
              <Bar className="h-3 w-52" />
            </div>
          </div>
          <div className="hidden space-y-1.5 lg:block">
            <Bar className="ml-auto h-3 w-32" />
            <Bar className="ml-auto h-3 w-40" />
          </div>
        </div>
        <Bar className="mt-4 h-10 w-full" />
      </section>

      {/* Mattonelle per area */}
      <section>
        <Bar className="mb-2 h-4 w-32" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="rounded-lg border border-border bg-surface-raised px-2.5 py-2">
              <Bar className="h-2.5 w-full" />
              <Bar className="mt-1.5 h-5 w-8" />
              <Bar className="mt-1.5 h-2 w-3/4" />
            </div>
          ))}
        </div>
      </section>

      {/* Rilievi */}
      <section>
        <Bar className="mb-2 h-4 w-44" />
        <div className="space-y-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Bar className="h-4 w-14 rounded-full" />
                <Bar className="h-4 w-20 rounded-full" />
                <Bar className="h-4 w-48" />
              </div>
              <Bar className="mt-2 h-3 w-full" />
              <Bar className="mt-1 h-3 w-11/12" />
              <div className="mt-2 border-l-2 border-border pl-2.5">
                <Bar className="h-3 w-full" />
                <Bar className="mt-1 h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
