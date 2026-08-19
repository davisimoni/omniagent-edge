import { describe, expect, it } from 'vitest';
import {
  AUDIT_PHASES,
  computeProgress,
  PHASE_LABELS,
  PHASE_WEIGHTS,
  readNdjsonStream,
  type AuditStreamEvent,
} from '@/lib/audit/stream';

/**
 * Test del canale di avanzamento.
 *
 * Il lettore NDJSON è la parte che si rompe in produzione e non in sviluppo: in
 * locale un chunk di rete coincide quasi sempre con una riga, sulla rete vera no.
 * I casi qui sotto forzano proprio le frammentazioni che localmente non capitano.
 */

function streamFrom(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(stream: ReadableStream<Uint8Array>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of readNdjsonStream<T>(stream)) events.push(event);
  return events;
}

describe('fasi', () => {
  it('assegna a ogni fase una etichetta e un peso', () => {
    for (const phase of AUDIT_PHASES) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
      expect(PHASE_WEIGHTS[phase]).toBeGreaterThanOrEqual(0);
      expect(PHASE_WEIGHTS[phase]).toBeLessThanOrEqual(1);
    }
  });

  it('i pesi non decrescono lungo la sequenza', () => {
    const weights = AUDIT_PHASES.map((phase) => PHASE_WEIGHTS[phase]);
    for (let index = 1; index < weights.length; index += 1) {
      expect(weights[index]).toBeGreaterThanOrEqual(weights[index - 1] ?? 0);
    }
  });
});

describe('computeProgress', () => {
  it('parte da zero e arriva a uno', () => {
    expect(computeProgress('queued', 0, 20)).toBe(0);
    expect(computeProgress('done', 20, 20)).toBe(1);
  });

  it('durante l\'analisi interpola sulle clausole già valutate', () => {
    const start = computeProgress('analyzing', 0, 20);
    const half = computeProgress('analyzing', 10, 20);
    const end = computeProgress('analyzing', 20, 20);

    expect(start).toBe(PHASE_WEIGHTS.reading);
    expect(half).toBeGreaterThan(start);
    expect(end).toBe(PHASE_WEIGHTS.analyzing);
  });

  it('non supera il peso della fase anche se il conteggio sfora', () => {
    expect(computeProgress('analyzing', 999, 20)).toBe(PHASE_WEIGHTS.analyzing);
  });

  it('regge un totale di clausole pari a zero senza dividere per zero', () => {
    expect(computeProgress('analyzing', 0, 0)).toBe(PHASE_WEIGHTS.reading);
  });
});

describe('readNdjsonStream', () => {
  it('legge eventi separati da a capo', async () => {
    const events = await collect<AuditStreamEvent>(
      streamFrom(['{"type":"phase","phase":"reading"}\n{"type":"phase","phase":"analyzing"}\n']),
    );
    expect(events.map((event) => event.type)).toEqual(['phase', 'phase']);
  });

  it('ricompone un oggetto JSON spezzato fra due chunk di rete', async () => {
    // È il caso che rompe l'implementazione ingenua che fa JSON.parse sul chunk.
    const events = await collect<AuditStreamEvent>(
      streamFrom(['{"type":"phase","ph', 'ase":"verifying"}\n']),
    );
    expect(events).toEqual([{ type: 'phase', phase: 'verifying' }]);
  });

  it('legge più eventi arrivati in un solo chunk', async () => {
    const events = await collect<AuditStreamEvent>(
      streamFrom([
        '{"type":"phase","phase":"reading"}\n{"type":"phase","phase":"analyzing"}\n{"type":"phase","phase":"done"}\n',
      ]),
    );
    expect(events).toHaveLength(3);
  });

  it('legge l\'ultima riga anche senza a capo finale', async () => {
    const events = await collect<AuditStreamEvent>(
      streamFrom(['{"type":"phase","phase":"done"}']),
    );
    expect(events).toEqual([{ type: 'phase', phase: 'done' }]);
  });

  it('ignora le righe vuote', async () => {
    const events = await collect<AuditStreamEvent>(
      streamFrom(['\n\n{"type":"phase","phase":"done"}\n\n']),
    );
    expect(events).toHaveLength(1);
  });

  it('non produce nulla da uno stream vuoto', async () => {
    expect(await collect<AuditStreamEvent>(streamFrom([]))).toEqual([]);
  });

  it('conserva i caratteri multibyte spezzati fra due chunk', async () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode('{"type":"error","error":"e","message":"città"}\n');
    const cut = 40; // taglia in mezzo alla codifica di "à"
    const events = await collect<AuditStreamEvent>(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload.slice(0, cut));
          controller.enqueue(payload.slice(cut));
          controller.close();
        },
      }),
    );
    expect(events[0]).toMatchObject({ type: 'error', message: 'città' });
  });
});
