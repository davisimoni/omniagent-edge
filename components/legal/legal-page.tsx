import type { ReactNode } from 'react';

/**
 * Impaginazione condivisa dei documenti legali.
 *
 * Misura di riga contenuta e gerarchia sobria: questi testi vengono letti da chi
 * sta decidendo se affidarci dei contratti, e un documento legale composto male
 * comunica trascuratezza proprio nel punto in cui si chiede fiducia.
 *
 * NOTA PER CHI GESTISCE IL PRODOTTO: i testi di `privacy` e `terms` sono
 * redatti sul funzionamento reale di questa applicazione — sub-responsabili,
 * regione di elaborazione, tempi di conservazione sono quelli veri — ma **non
 * sono stati verificati da un legale**. Prima dell'apertura commerciale vanno
 * fatti rivedere, insieme al DPA che i clienti B2B chiederanno.
 */
export function LegalPage({
  title,
  updatedAt,
  intro,
  children,
}: {
  title: string;
  updatedAt: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="border-b border-border pb-5">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{intro}</p>
        <p className="mt-3 text-xs text-muted">Ultimo aggiornamento: {updatedAt}</p>
      </header>

      <div className="mt-8 space-y-8">{children}</div>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** Tabella dei sub-responsabili: il dato che un cliente B2B chiede per primo. */
export function SubProcessorTable({
  rows,
}: {
  rows: readonly { name: string; purpose: string; region: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-raised text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Fornitore</th>
            <th scope="col" className="px-3 py-2 font-medium">Finalità</th>
            <th scope="col" className="px-3 py-2 font-medium">Regione</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
              <td className="px-3 py-2">{row.purpose}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.region}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
