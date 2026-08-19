'use client';

import {
  AlertCircle,
  ArrowRight,
  Check,
  FileDown,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { AuditOnboarding } from '@/components/audit/audit-onboarding';
import { AuditProgress, type AuditProgressState } from '@/components/audit/audit-progress';
import { AuditSkeleton } from '@/components/audit/audit-skeleton';
import { AuditResult } from '@/components/audit/audit-result';
import { SpecBadge } from '@/components/dev-mode/spec-badge';
import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';
import { buildExecutiveReport } from '@/lib/audit/report';
import {
  SAMPLE_ANNUAL_VALUE,
  SAMPLE_CONTRACT,
  SAMPLE_CONTRACT_NAME,
  SAMPLE_OBSERVED_METRICS,
} from '@/lib/audit/sample-contract';
import { MAX_AUDIT_TEXT_LENGTH, type ContractAudit } from '@/lib/audit/schema';
import {
  readNdjsonStream,
  type AuditMetrics,
  type AuditPersistence,
  type AuditStreamEvent,
} from '@/lib/audit/stream';
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@/lib/schemas';
import { cn, copyToClipboard, downloadTextFile } from '@/lib/utils';

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv', '.log'];

interface MetricRow {
  readonly id: string;
  readonly metric: string;
  readonly value: string;
  readonly period: string;
}

interface AttachmentState {
  readonly name: string;
  readonly mediaType: (typeof ACCEPTED_ATTACHMENT_TYPES)[number];
  readonly data: string;
  readonly bytes: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function isAcceptedBinary(type: string): type is (typeof ACCEPTED_ATTACHMENT_TYPES)[number] {
  return (ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

function isTextFile(name: string, type: string): boolean {
  if (type.startsWith('text/') || type === 'application/json') return true;
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

let rowCounter = 0;
function newRow(metric = '', value = '', period = ''): MetricRow {
  rowCounter += 1;
  return { id: `row-${rowCounter}`, metric, value, period };
}

export function AuditWorkbench() {
  const textAreaId = useId();
  const sourceNameId = useId();
  const annualValueId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [annualValue, setAnnualValue] = useState('');
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);
  const [metricRows, setMetricRows] = useState<MetricRow[]>([]);
  const [dragging, setDragging] = useState(false);

  const [progress, setProgress] = useState<AuditProgressState | null>(null);
  const [audit, setAudit] = useState<ContractAudit | null>(null);
  const [metrics, setMetrics] = useState<AuditMetrics | null>(null);
  const [persistence, setPersistence] = useState<AuditPersistence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<{ message: string; suggestedPlan: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const busy = progress !== null;

  const acceptFile = useCallback(async (file: File): Promise<void> => {
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(
        `"${file.name}" pesa ${formatBytes(file.size)}: il limite è ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
      return;
    }
    if (isTextFile(file.name, file.type)) {
      const contents = await file.text();
      setAttachment(null);
      setText(contents.slice(0, MAX_AUDIT_TEXT_LENGTH));
      setSourceName((current) => (current.trim().length > 0 ? current : file.name));
      return;
    }
    if (isAcceptedBinary(file.type)) {
      const buffer = await file.arrayBuffer();
      setText('');
      setAttachment({
        name: file.name,
        mediaType: file.type,
        data: arrayBufferToBase64(buffer),
        bytes: file.size,
      });
      setSourceName((current) => (current.trim().length > 0 ? current : file.name));
      return;
    }
    setError(
      `Formato non supportato (${file.type || 'sconosciuto'}). Accettati: testo, Markdown, ` +
        'CSV, JSON, PDF, PNG, JPEG e WebP.',
    );
  }, []);

  const loadSample = (): void => {
    setText(SAMPLE_CONTRACT);
    setSourceName(SAMPLE_CONTRACT_NAME);
    setAnnualValue(String(SAMPLE_ANNUAL_VALUE));
    setAttachment(null);
    setMetricRows(
      SAMPLE_OBSERVED_METRICS.map((metric) =>
        newRow(metric.metric, String(metric.value), metric.period ?? ''),
      ),
    );
    setAudit(null);
    setMetrics(null);
    setError(null);
  };

  const reset = (): void => {
    setText('');
    setSourceName('');
    setAnnualValue('');
    setAttachment(null);
    setMetricRows([]);
    setAudit(null);
    setMetrics(null);
    setError(null);
  };

  const canRun = !busy && (text.trim().length > 0 || attachment !== null);

  const run = async (): Promise<void> => {
    if (!canRun) return;
    setAudit(null);
    setMetrics(null);
    setPersistence(null);
    setError(null);
    setPaywall(null);
    setProgress({
      phase: 'queued',
      clausesAssessed: 0,
      clausesTotal: CLAUSE_CATALOG.length,
      redFlags: 0,
      slaCommitments: 0,
      transcribed: false,
    });

    const observedMetrics = metricRows
      .filter((row) => row.metric.trim().length > 0 && row.value.trim().length > 0)
      .map((row) => ({
        metric: row.metric.trim(),
        value: Number(row.value.replace(',', '.')),
        period: row.period.trim().length > 0 ? row.period.trim() : null,
      }))
      .filter((metric) => Number.isFinite(metric.value));

    const parsedAnnualValue = Number(annualValue.replace(/[^\d.,]/g, '').replace(',', '.'));

    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(text.trim().length > 0 ? { text: text.trim() } : {}),
          ...(attachment !== null
            ? {
                attachment: {
                  name: attachment.name,
                  mediaType: attachment.mediaType,
                  data: attachment.data,
                },
              }
            : {}),
          ...(sourceName.trim().length > 0 ? { sourceName: sourceName.trim() } : {}),
          ...(observedMetrics.length > 0 ? { observedMetrics } : {}),
          ...(Number.isFinite(parsedAnnualValue) && parsedAnnualValue > 0
            ? { annualValueOverride: parsedAnnualValue }
            : {}),
        }),
      });

      // Gli errori di validazione e di configurazione arrivano prima dello stream,
      // come JSON con lo status giusto: vanno letti così, non come NDJSON.
      if (!response.ok || response.body === null) {
        const payload: unknown = await response.json().catch(() => null);
        // Il 402 non è un errore dell'utente: è una decisione commerciale, e
        // mostrarlo nel riquadro rosso degli errori la fa sembrare un guasto.
        if (response.status === 402 && typeof payload === 'object' && payload !== null) {
          const body = payload as { message?: unknown; suggestedPlan?: unknown };
          setPaywall({
            message: typeof body.message === 'string' ? body.message : 'Quota esaurita.',
            suggestedPlan: typeof body.suggestedPlan === 'string' ? body.suggestedPlan : null,
          });
          return;
        }
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : `Il server ha risposto ${response.status}.`;
        setError(message);
        return;
      }

      for await (const event of readNdjsonStream<AuditStreamEvent>(response.body)) {
        if (event.type === 'phase') {
          setProgress((current) =>
            current === null
              ? current
              : {
                  ...current,
                  phase: event.phase,
                  // Una volta trascritto resta trascritto: la barra non deve
                  // arretrare quando l'analisi subentra alla lettura visiva.
                  transcribed: current.transcribed || event.phase === 'transcribing',
                },
          );
        } else if (event.type === 'progress') {
          setProgress((current) =>
            current === null
              ? current
              : {
                  ...current,
                  clausesAssessed: event.clausesAssessed,
                  clausesTotal: event.clausesTotal,
                  redFlags: event.redFlags,
                  slaCommitments: event.slaCommitments,
                },
          );
        } else if (event.type === 'result') {
          setAudit(event.audit);
          setMetrics(event.metrics);
        } else if (event.type === 'persisted') {
          setPersistence(event.persistence);
        } else {
          setError(event.message);
        }
      }
    } catch {
      setError('Impossibile contattare il server. Verifica la connessione e riprova.');
    } finally {
      setProgress(null);
    }
  };

  const exportJson = (): void => {
    if (audit === null) return;
    downloadTextFile(`${audit.auditId}.json`, JSON.stringify(audit, null, 2), 'application/json');
  };

  const exportMarkdown = (): void => {
    if (audit === null) return;
    downloadTextFile(`${audit.auditId}.md`, buildExecutiveReport(audit), 'text/markdown');
  };

  const copyMarkdown = async (): Promise<void> => {
    if (audit === null) return;
    if (await copyToClipboard(buildExecutiveReport(audit))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="space-y-4">
      <AuditOnboarding onLoadSample={loadSample} />

      <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      {/* ── Ingresso ───────────────────────────────────────────────────────── */}
      <Card className="flex flex-col print:hidden xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)]">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-1.5">
              Documento da sottoporre ad audit
              <SpecBadge id="ocr-fallback" />
            </span>
          }
          description="Contratto, SLA o DPA. Il testo incollato permette di verificare le citazioni."
          action={
            <Button variant="ghost" onClick={reset} disabled={busy} className="px-2 py-1 text-xs">
              <Trash2 className="size-3.5" aria-hidden="true" />
              Svuota
            </Button>
          }
        />

        <div className="scrollbar-slim flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div
            onDragOver={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files.item(0);
              if (file !== null) void acceptFile(file);
            }}
            className={cn(
              'rounded-xl border-2 border-dashed p-4 text-center transition-colors',
              dragging
                ? 'border-accent bg-accent-soft/50'
                : 'border-border bg-surface-raised/50 hover:border-border-strong',
            )}
          >
            <Upload className="mx-auto size-5 text-muted" aria-hidden="true" />
            <p className="mt-1.5 text-xs font-medium">Trascina il contratto</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
            >
              oppure scegli un file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept={[...ACCEPTED_ATTACHMENT_TYPES, ...TEXT_EXTENSIONS].join(',')}
              onChange={(event) => {
                const file = event.target.files?.item(0);
                if (file != null) void acceptFile(file);
                event.target.value = '';
              }}
            />
          </div>

          {attachment !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2">
              <Paperclip className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium">{attachment.name}</p>
                <p className="text-[10px] text-muted">{formatBytes(attachment.bytes)}</p>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
                aria-label="Rimuovi allegato"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {attachment !== null && (
            <p className="rounded-lg border border-warning/30 bg-warning/10 p-2 text-[11px] leading-relaxed text-warning">
              Con un allegato binario le citazioni non sono verificabili: non c&apos;è testo
              sorgente su cui confrontarle. Per un audit pienamente verificabile, incolla il testo.
            </p>
          )}

          <div>
            <label htmlFor={textAreaId} className="mb-1 block text-xs font-medium text-muted">
              Testo del contratto
            </label>
            <textarea
              id={textAreaId}
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, MAX_AUDIT_TEXT_LENGTH))}
              placeholder="Incolla qui il contratto, lo SLA o il DPA…"
              className="scrollbar-slim min-h-48 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed placeholder:font-sans placeholder:text-muted"
            />
            <p className="mt-1 text-right text-[10px] tabular-nums text-muted">
              {text.length.toLocaleString('it-IT')} caratteri
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={sourceNameId} className="mb-1 block text-xs font-medium text-muted">
                Nome documento
              </label>
              <input
                id={sourceNameId}
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value.slice(0, 255))}
                placeholder="Contratto Acme 2026"
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted"
              />
            </div>
            <div>
              <label htmlFor={annualValueId} className="mb-1 block text-xs font-medium text-muted">
                Canone annuo
              </label>
              <input
                id={annualValueId}
                value={annualValue}
                onChange={(event) => setAnnualValue(event.target.value)}
                inputMode="decimal"
                placeholder="240000"
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums placeholder:text-muted"
              />
            </div>
          </div>

          {/* ── Metriche osservate ─────────────────────────────────────────── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Prestazioni misurate</span>
              <button
                type="button"
                onClick={() => setMetricRows((rows) => [...rows, newRow()])}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-soft"
              >
                <Plus className="size-3" aria-hidden="true" />
                Aggiungi
              </button>
            </div>

            {metricRows.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface-raised p-2 text-[11px] leading-relaxed text-muted">
                Senza dati misurati gli impegni di servizio vengono estratti e citati, ma non
                verificati. Il report lo dichiara invece di tacere.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {metricRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-1.5">
                    <input
                      value={row.metric}
                      onChange={(event) =>
                        setMetricRows((rows) =>
                          rows.map((entry) =>
                            entry.id === row.id ? { ...entry, metric: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="uptime_percent"
                      aria-label="Nome metrica"
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px]"
                    />
                    <input
                      value={row.value}
                      onChange={(event) =>
                        setMetricRows((rows) =>
                          rows.map((entry) =>
                            entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="99.42"
                      inputMode="decimal"
                      aria-label="Valore misurato"
                      className="w-20 rounded border border-border bg-background px-2 py-1 text-[11px] tabular-nums"
                    />
                    <input
                      value={row.period}
                      onChange={(event) =>
                        setMetricRows((rows) =>
                          rows.map((entry) =>
                            entry.id === row.id ? { ...entry, period: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="2026-07"
                      aria-label="Periodo"
                      className="w-24 rounded border border-border bg-background px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => setMetricRows((rows) => rows.filter((entry) => entry.id !== row.id))}
                      className="rounded p-1 text-muted hover:bg-surface-raised hover:text-danger"
                      aria-label="Rimuovi metrica"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error !== null && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-[11px] leading-relaxed text-danger"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <Button onClick={() => void run()} disabled={!canRun} className="w-full">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Audit in corso…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" aria-hidden="true" />
                Esegui audit di conformità
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={loadSample} disabled={busy} className="w-full">
            <FileText className="size-4" aria-hidden="true" />
            Carica contratto di esempio
          </Button>
        </div>
      </Card>

      {/* ── Risultato ──────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {/*
          Il paywall è un invito, non un muro. Dice quanto è stato usato, quando
          si azzera e che cosa cambierebbe: chi legge solo "quota esaurita" deve
          cercare altrove le altre due informazioni, e la maggior parte non
          cerca — chiude.
        */}
        {paywall !== null && (
          <div
            role="status"
            className="rounded-xl border border-accent/40 bg-accent-soft/60 p-4 print:hidden"
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-accent" aria-hidden="true" />
              Hai finito gli audit inclusi di questo mese
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{paywall.message}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90"
              >
                Vedi i piani
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/history"
                className="text-xs font-medium text-accent underline-offset-2 hover:underline"
              >
                Rivedi gli audit già fatti
              </Link>
            </div>
          </div>
        )}

        {/* Esito dell'archiviazione: dire dov'è finito il report vale quanto il report. */}
        {persistence !== null && audit !== null && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs print:hidden',
              persistence.recordId !== null
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-border bg-surface-raised text-muted',
            )}
          >
            {persistence.recordId !== null ? (
              <>
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Salvato nella cronologia del workspace.</span>
                <Link
                  href={`/history/${persistence.recordId}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  Aprilo
                </Link>
                {persistence.remaining !== null && (
                  <span className="ml-auto tabular-nums">
                    {persistence.remaining} audit rimasti questo mese
                  </span>
                )}
              </>
            ) : (
              <>
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{persistence.reason}</span>
                <Link
                  href="/register"
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Crea un account
                </Link>
              </>
            )}
          </div>
        )}

        {busy && progress !== null && (
          <div>
            <div className="mb-1.5 flex justify-end">
              <SpecBadge id="ndjson-streaming" />
            </div>
            <AuditProgress state={progress} />
          </div>
        )}

        {audit !== null && (
          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            <Badge tone="accent">{audit.redFlags.length} rilievi</Badge>
            <Badge tone="warning">{audit.missingClauses.length} clausole mancanti</Badge>
            <Badge tone="danger">{audit.slaViolations.length} SLA disattesi</Badge>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Button variant="secondary" onClick={exportJson} className="px-2.5 py-1.5 text-xs">
                <FileDown className="size-3.5" aria-hidden="true" />
                JSON
              </Button>
              <Button variant="secondary" onClick={exportMarkdown} className="px-2.5 py-1.5 text-xs">
                <ScrollText className="size-3.5" aria-hidden="true" />
                Markdown
              </Button>
              <Button
                variant="secondary"
                onClick={() => void copyMarkdown()}
                className="px-2.5 py-1.5 text-xs"
              >
                {copied ? 'Copiato' : 'Copia report'}
              </Button>
              <Button onClick={() => window.print()} className="px-2.5 py-1.5 text-xs">
                <Printer className="size-3.5" aria-hidden="true" />
                PDF
              </Button>
            </div>
          </div>
        )}

        {audit !== null ? (
          <AuditResult audit={audit} metrics={metrics} />
        ) : busy ? (
          // Lo scheletro mostra la forma di ciò che arriverà: sotto la barra,
          // il vuoto è l'unica parte dell'attesa che si può riempire di
          // informazione utile a chi non ha mai visto un risultato.
          <AuditSkeleton />
        ) : (
          <Card className="print:hidden">
            <EmptyState
              icon={<ShieldCheck className="size-5" />}
              title="Nessun audit eseguito"
              description="Carica un contratto o usa quello di esempio. L'analisi valuta una per una le clausole del catalogo, cita il testo a supporto di ogni rilievo e calcola il punteggio di rischio in modo deterministico."
            />
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
