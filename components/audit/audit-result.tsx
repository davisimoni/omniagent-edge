'use client';

import {
  AlertTriangle,
  BadgeCheck,
  CircleHelp,
  FileWarning,
  Gauge,
  ListChecks,
  ShieldQuestion,
} from 'lucide-react';
import { RiskHeatmap, RiskScoreDial } from '@/components/audit/risk-heatmap';
import { Badge, type Tone } from '@/components/ui/primitives';
import { buildExecutiveSummary } from '@/lib/audit/report';
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type CitationVerification,
  type ContractAudit,
  type RiskSeverity,
} from '@/lib/audit/schema';
import type { AuditMetrics } from '@/lib/audit/stream';
import { formatCostUsd, formatLatency, formatTokens } from '@/lib/metrics';
import { cn } from '@/lib/utils';

/**
 * Presentazione dell'audit.
 *
 * È anche la radice di stampa (`data-print-root`): l'esportazione in PDF passa
 * dal motore di stampa del browser, quindi ciò che si vede qui è ciò che finisce
 * nel PDF. Vale la pena dirlo esplicitamente perché è una scelta, non una
 * scorciatoia: una libreria PDF lato server non gira su Edge runtime, e una resa
 * lato client con canvas produrrebbe un'immagine — un documento in cui il testo
 * non si seleziona, non si cerca e non si copia. Un report di audit viene letto
 * cercandoci dentro.
 */

const SEVERITY_TONES: Readonly<Record<RiskSeverity, Tone>> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

const VERIFICATION_META: Readonly<
  Record<CitationVerification, { label: string; tone: Tone; hint: string }>
> = {
  verified: {
    label: 'citazione confermata',
    tone: 'success',
    hint: 'Il passaggio è stato ritrovato alla lettera nel documento.',
  },
  partial: {
    label: 'citazione parziale',
    tone: 'warning',
    hint: 'Il passaggio esiste ma non combacia parola per parola: controllalo sul testo.',
  },
  unverified: {
    label: 'citazione NON trovata',
    tone: 'danger',
    hint: 'Questo passaggio non è stato ritrovato nel documento. Verificalo prima di usarlo.',
  },
  'no-source': {
    label: 'non verificabile',
    tone: 'neutral',
    hint: 'Il documento è stato analizzato come allegato: non c\'è testo su cui confrontare.',
  },
};

export function AuditResult({
  audit,
  metrics,
}: {
  audit: ContractAudit;
  metrics: AuditMetrics | null;
}) {
  const summary = buildExecutiveSummary(audit);

  return (
    <div data-print-root className="space-y-6">
      {/* ── Esito ──────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <RiskScoreDial riskScore={audit.riskScore} />
          <div className="shrink-0 text-xs text-muted lg:text-right">
            <p className="font-mono">{audit.auditId}</p>
            <p className="mt-0.5">{audit.sourceName}</p>
            <p className="mt-0.5">{new Date(audit.generatedAt).toLocaleString('it-IT')}</p>
            {metrics !== null && (
              <p className="mt-1.5 tabular-nums">
                {formatLatency(metrics.latencyMs)} · {formatTokens(metrics.totalTokens)} token ·{' '}
                {formatCostUsd(metrics.costUsd)}
              </p>
            )}
          </div>
        </div>

        <p
          className={cn(
            'mt-4 rounded-lg border px-3 py-2.5 text-sm font-medium leading-relaxed',
            audit.riskScore.band === 'critical' || audit.riskScore.band === 'high'
              ? 'border-danger/30 bg-danger/10 text-danger'
              : audit.riskScore.band === 'medium'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-success/30 bg-success/10 text-success',
          )}
        >
          {summary.verdict}
        </p>
      </section>

      {/* ── Heatmap ────────────────────────────────────────────────────────── */}
      <section>
        <SectionTitle icon={<Gauge className="size-4" />}>Rischio per area</SectionTitle>
        <RiskHeatmap riskScore={audit.riskScore} />
      </section>

      {/* ── Azioni ─────────────────────────────────────────────────────────── */}
      {summary.immediateActions.length > 0 && (
        <section>
          <SectionTitle icon={<ListChecks className="size-4" />}>
            Azioni prima della firma ({summary.immediateActions.length})
          </SectionTitle>
          <ol className="space-y-2">
            {summary.immediateActions.map((action, index) => (
              <li
                key={`${action.title}-${index}`}
                className="flex gap-2.5 rounded-lg border border-border bg-surface-raised p-3"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                  {action.priority}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{action.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{action.action}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Rilievi ────────────────────────────────────────────────────────── */}
      {audit.redFlags.length > 0 && (
        <section>
          <SectionTitle icon={<AlertTriangle className="size-4" />}>
            Rilievi con evidenza ({audit.redFlags.length})
          </SectionTitle>
          <ul className="space-y-2.5">
            {audit.redFlags.map((flag) => {
              const verification = VERIFICATION_META[flag.citation.verification];
              return (
                <li key={flag.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={SEVERITY_TONES[flag.severity]}>
                      {SEVERITY_LABELS[flag.severity]}
                    </Badge>
                    <Badge>{CATEGORY_LABELS[flag.category]}</Badge>
                    <span className="text-sm font-medium">{flag.title}</span>
                  </div>

                  <p className="mt-1.5 text-xs leading-relaxed">{flag.finding}</p>

                  <blockquote className="mt-2 border-l-2 border-accent/50 bg-surface-raised py-1.5 pl-2.5 pr-2">
                    <p className="text-[11px] italic leading-relaxed">
                      «{flag.citation.quote}»
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                      <span>{flag.citation.locator ?? 'posizione non indicata'}</span>
                      <Badge tone={verification.tone}>
                        {flag.citation.verification === 'verified' && (
                          <BadgeCheck className="size-3" aria-hidden="true" />
                        )}
                        {verification.label}
                      </Badge>
                      <span className="sr-only">{verification.hint}</span>
                    </p>
                  </blockquote>

                  <dl className="mt-2 grid gap-1.5 text-[11px] leading-relaxed sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-muted">Impatto</dt>
                      <dd>{flag.businessImpact}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-muted">Azione suggerita</dt>
                      <dd>{flag.suggestedAction}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Clausole mancanti ──────────────────────────────────────────────── */}
      {audit.missingClauses.length > 0 && (
        <section>
          <SectionTitle icon={<FileWarning className="size-4" />}>
            Clausole assenti o incomplete ({audit.missingClauses.length})
          </SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-raised text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-2.5 py-2 font-medium">Clausola</th>
                  <th scope="col" className="px-2.5 py-2 font-medium">Stato</th>
                  <th scope="col" className="px-2.5 py-2 font-medium">Gravità</th>
                  <th scope="col" className="px-2.5 py-2 font-medium">Riferimento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.missingClauses.map((clause) => (
                  <tr key={clause.clauseId}>
                    <td className="px-2.5 py-2">
                      <p className="font-medium">{clause.name}</p>
                      {clause.notes.trim().length > 0 && (
                        <p className="mt-0.5 text-[11px] text-muted">{clause.notes}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      {clause.status === 'partial' ? 'Incompleta' : 'Assente'}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <Badge tone={SEVERITY_TONES[clause.severity]}>
                        {SEVERITY_LABELS[clause.severity]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-muted">
                      {clause.reference ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── SLA ────────────────────────────────────────────────────────────── */}
      {audit.slaViolations.length > 0 && (
        <section>
          <SectionTitle icon={<Gauge className="size-4" />}>
            Livelli di servizio disattesi ({audit.slaViolations.length})
          </SectionTitle>
          <ul className="space-y-2">
            {audit.slaViolations.map((violation) => (
              <li key={violation.metric} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={SEVERITY_TONES[violation.severity]}>
                    {SEVERITY_LABELS[violation.severity]}
                  </Badge>
                  <span className="text-sm font-medium">{violation.description}</span>
                  {violation.period !== null && <Badge>{violation.period}</Badge>}
                </div>
                <p className="mt-1 text-xs tabular-nums">
                  Impegno <strong>{violation.committed}{violation.unit}</strong> · osservato{' '}
                  <strong className="text-danger">
                    {violation.observed}
                    {violation.unit}
                  </strong>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {violation.severityBasis === 'error_budget'
                    ? `Consumato ${violation.severityRatio.toFixed(1)}× il budget di indisponibilità concesso dal contratto.`
                    : `Scostamento pari al ${Math.round(violation.shortfallRatio * 100)}% della soglia.`}{' '}
                  {violation.penaltyPercent !== null
                    ? `Credito previsto: ${violation.penaltyPercent}% del canone` +
                      (violation.estimatedCreditValue !== null
                        ? ` (≈ ${violation.estimatedCreditValue.toLocaleString('it-IT')} per il periodo).`
                        : '.')
                    : 'Il contratto non prevede alcuna conseguenza economica per questo scostamento.'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Affidabilità ───────────────────────────────────────────────────── */}
      <section>
        <SectionTitle icon={<ShieldQuestion className="size-4" />}>
          Affidabilità di questa analisi
        </SectionTitle>
        <div className="space-y-2 rounded-lg border border-border bg-surface-raised p-3 text-xs leading-relaxed">
          {summary.citationReliability === null ? (
            <p className="text-muted">
              Citazioni non verificate: il documento è stato analizzato come allegato senza testo
              estratto, quindi non esiste un sorgente su cui confrontarle.
            </p>
          ) : (
            <p
              className={cn(
                audit.citationAudit.unverified > 0 ? 'text-danger' : 'text-muted',
              )}
            >
              {audit.citationAudit.verified} citazioni su {audit.citationAudit.total} ritrovate alla
              lettera nel documento ({Math.round(summary.citationReliability * 100)}%).{' '}
              {audit.citationAudit.unverified > 0
                ? `${audit.citationAudit.unverified} non sono state trovate: controllale a mano prima di qualunque uso negoziale.`
                : 'Nessuna citazione risulta priva di riscontro.'}
            </p>
          )}

          {!summary.coverageComplete && (
            <p className="flex items-start gap-1.5 text-warning">
              <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Copertura incompleta: {audit.clausesAssessed} clausole valutate su{' '}
              {audit.clausesInCatalog}. Le clausole non valutate non compaiono fra le mancanti,
              perché un rilievo senza evidenza non è un rilievo.
            </p>
          )}

          <p className="border-t border-border pt-2 text-[11px] text-muted">{audit.disclaimer}</p>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
      <span className="text-accent" aria-hidden="true">
        {icon}
      </span>
      {children}
    </h2>
  );
}
