'use client';

import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  Copy,
  Download,
  FileText,
  Loader2,
  Paperclip,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, StatTile } from '@/components/ui/primitives';
import { formatCostUsd, formatLatency, formatTokens } from '@/lib/metrics';
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_EXTRACT_TEXT_LENGTH,
  type StructuredExtraction,
} from '@/lib/schemas';
import { cn, copyToClipboard, downloadTextFile } from '@/lib/utils';

/**
 * Banco di lavoro dell'estrattore.
 *
 * Due percorsi di ingresso, perché i documenti arrivano in due forme diverse:
 * il testo incollato va direttamente nel prompt, mentre PDF e immagini viaggiano
 * come `file` part e sono letti dalle capacità multimodali del modello — senza
 * un parser PDF lato server, che su Edge non avrebbe dove girare.
 */

/** Estensioni testuali lette nel browser: qui il modello riceve testo, non byte. */
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.yaml', '.yml'];

interface ExtractionMetrics {
  readonly modelId: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number | null;
}

interface AttachmentState {
  readonly name: string;
  readonly mediaType: (typeof ACCEPTED_ATTACHMENT_TYPES)[number];
  readonly data: string;
  readonly bytes: number;
}

/** Converte un ArrayBuffer in base64 a blocchi: `String.fromCharCode(...tutto)` esplode sui MB. */
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

export function ExtractorWorkbench() {
  const textAreaId = useId();
  const instructionsId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StructuredExtraction | null>(null);
  const [metrics, setMetrics] = useState<ExtractionMetrics | null>(null);
  const [copied, setCopied] = useState(false);

  const acceptFile = useCallback(async (file: File): Promise<void> => {
    setError(null);

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(
        `"${file.name}" pesa ${formatBytes(file.size)}: il limite è ` +
          `${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
      return;
    }

    if (isTextFile(file.name, file.type)) {
      const contents = await file.text();
      setAttachment(null);
      setText(contents.slice(0, MAX_EXTRACT_TEXT_LENGTH));
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
      return;
    }

    // SVG rientra qui di proposito: è un documento eseguibile, non un'immagine
    // inerte, e non ha posto in un flusso di upload.
    setError(
      `Formato non supportato (${file.type || 'sconosciuto'}). Accettati: testo semplice, ` +
        'Markdown, CSV, JSON, PDF, PNG, JPEG e WebP.',
    );
  }, []);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file !== null) void acceptFile(file);
  };

  const reset = (): void => {
    setText('');
    setInstructions('');
    setAttachment(null);
    setResult(null);
    setMetrics(null);
    setError(null);
  };

  const canRun = !busy && (text.trim().length > 0 || attachment !== null);

  const run = async (): Promise<void> => {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setMetrics(null);

    try {
      const response = await fetch('/api/extract', {
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
          ...(instructions.trim().length > 0 ? { instructions: instructions.trim() } : {}),
        }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : `Il server ha risposto ${response.status}.`;
        setError(message);
        return;
      }

      const data = (payload as { data: StructuredExtraction; metrics: ExtractionMetrics }).data;
      setResult(data);
      setMetrics((payload as { metrics: ExtractionMetrics }).metrics);
    } catch {
      setError('Impossibile contattare il server. Verifica la connessione e riprova.');
    } finally {
      setBusy(false);
    }
  };

  const serializedResult = result === null ? '' : JSON.stringify(result, null, 2);

  const onCopy = async (): Promise<void> => {
    if (await copyToClipboard(serializedResult)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Ingresso ───────────────────────────────────────────────────────── */}
      <Card className="flex flex-col">
        <CardHeader
          title="Documento"
          description="Trascina un file, incolla del testo, o entrambi."
          action={
            <Button variant="ghost" onClick={reset} className="px-2 py-1 text-xs" disabled={busy}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              Svuota
            </Button>
          }
        />

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'rounded-xl border-2 border-dashed p-5 text-center transition-colors',
              dragging
                ? 'border-accent bg-accent-soft/50'
                : 'border-border bg-surface-raised/50 hover:border-border-strong',
            )}
          >
            <Upload className="mx-auto size-6 text-muted" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Trascina qui il documento</p>
            <p className="mt-0.5 text-xs text-muted">
              PDF, PNG, JPEG, WebP · testo, Markdown, CSV, JSON · max{' '}
              {formatBytes(MAX_ATTACHMENT_BYTES)}
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2.5 text-xs font-medium text-accent underline-offset-2 hover:underline"
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
                // Azzerato per poter riselezionare lo stesso file dopo un reset.
                event.target.value = '';
              }}
            />
          </div>

          {attachment !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2">
              <Paperclip className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{attachment.name}</p>
                <p className="text-[11px] text-muted">
                  {attachment.mediaType} · {formatBytes(attachment.bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
                aria-label="Rimuovi allegato"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="flex flex-1 flex-col">
            <label htmlFor={textAreaId} className="mb-1 text-xs font-medium text-muted">
              Testo da analizzare
            </label>
            <textarea
              id={textAreaId}
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, MAX_EXTRACT_TEXT_LENGTH))}
              placeholder="Incolla qui fatture, contratti, email, verbali…"
              className="scrollbar-slim min-h-40 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed placeholder:font-sans placeholder:text-muted"
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted">
              {text.length.toLocaleString('it-IT')} / {MAX_EXTRACT_TEXT_LENGTH.toLocaleString('it-IT')}
            </p>
          </div>

          <div>
            <label htmlFor={instructionsId} className="mb-1 block text-xs font-medium text-muted">
              Istruzioni (facoltative)
            </label>
            <input
              id={instructionsId}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value.slice(0, 2000))}
              placeholder="es. è una fattura, servono imponibile, IVA e scadenza"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted"
            />
          </div>

          {error !== null && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs leading-relaxed text-danger"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <Button onClick={() => void run()} disabled={!canRun} className="w-full">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Estrazione in corso…
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden="true" />
                Estrai JSON strutturato
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* ── Uscita ─────────────────────────────────────────────────────────── */}
      <Card className="flex flex-col">
        <CardHeader
          title="Risultato"
          description="Validato contro lo schema Zod prima di arrivare qui."
          action={
            result !== null ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={() => void onCopy()}
                  className="px-2 py-1 text-xs"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  {copied ? 'Copiato' : 'Copia'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadTextFile('estrazione.json', serializedResult, 'application/json')
                  }
                  className="px-2 py-1 text-xs"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Esporta
                </Button>
              </div>
            ) : undefined
          }
        />

        <div className="scrollbar-slim flex-1 overflow-y-auto p-4">
          {result === null ? (
            <EmptyState
              icon={<FileText className="size-5" />}
              title="Nessuna estrazione"
              description="Il risultato conterrà tipo di documento, sintesi, entità con citazione a supporto, campi salienti e le informazioni che il documento non permette di determinare."
            />
          ) : (
            <div className="space-y-4">
              {metrics !== null && (
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label="Latenza" value={formatLatency(metrics.latencyMs)} tone="accent" />
                  <StatTile
                    label="Token"
                    value={formatTokens(metrics.totalTokens)}
                    hint={`${formatTokens(metrics.inputTokens)} in`}
                  />
                  <StatTile label="Costo" value={formatCostUsd(metrics.costUsd)} hint="stima" />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="accent">{result.documentType}</Badge>
                <Badge>lingua: {result.language}</Badge>
                <Badge
                  tone={
                    result.overallConfidence >= 0.8
                      ? 'success'
                      : result.overallConfidence >= 0.5
                        ? 'warning'
                        : 'danger'
                  }
                >
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  confidenza {Math.round(result.overallConfidence * 100)}%
                </Badge>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Sintesi</h3>
                <p className="mt-1 text-sm leading-relaxed">{result.summary}</p>
              </div>

              {result.entities.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    Entità ({result.entities.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {result.entities.map((entity, index) => (
                      <li
                        key={`${entity.type}-${entity.value}-${index}`}
                        className="rounded-lg border border-border bg-surface-raised px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge>{entity.type}</Badge>
                          <span className="text-sm font-medium">{entity.value}</span>
                          {entity.normalized !== null && (
                            <span className="font-mono text-[11px] text-accent">
                              → {entity.normalized}
                            </span>
                          )}
                          <span className="ml-auto text-[11px] tabular-nums text-muted">
                            {Math.round(entity.confidence * 100)}%
                          </span>
                        </div>
                        {/* La citazione è ciò che rende l'estrazione verificabile:
                            senza, resta un'affermazione del modello. */}
                        <p className="mt-1 border-l-2 border-border pl-2 text-[11px] italic leading-relaxed text-muted">
                          {entity.evidence}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.keyFields.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    Campi salienti
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {result.keyFields.map((field) => (
                          <tr key={field.key}>
                            <th
                              scope="row"
                              className="whitespace-nowrap px-2.5 py-1.5 text-left font-mono font-normal text-muted"
                            >
                              {field.key}
                            </th>
                            <td className="px-2.5 py-1.5 font-medium">{field.value || '—'}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-muted">
                              {Math.round(field.confidence * 100)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.openQuestions.length > 0 && (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    <CircleHelp className="size-3.5" aria-hidden="true" />
                    Non determinabile dal documento
                  </h3>
                  <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-2.5">
                    {result.openQuestions.map((question) => (
                      <li key={question} className="text-xs leading-relaxed text-warning">
                        · {question}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="group">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
                  JSON completo
                </summary>
                <pre className="scrollbar-slim mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                  {serializedResult}
                </pre>
              </details>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
