import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_SPECS,
  CATEGORY_LABELS,
  getSpec,
  SPEC_CATEGORIES,
  specsByCategory,
  TECH_STACK,
} from '@/lib/showcase/specs';

/**
 * Test del catalogo mostrato in Developer Mode.
 *
 * Il test che conta davvero è quello sui percorsi dei file: un badge che indica
 * `lib/audit/scoring.ts` a un tecnico che poi va a cercarlo e non lo trova fa
 * più danno del badge assente, perché mette in dubbio anche tutto il resto della
 * pagina. Qui i percorsi vengono verificati sul disco, così una rinomina di file
 * rompe la build dei test invece della credibilità della vetrina.
 */

const ROOT = resolve(__dirname, '..');

describe('ARCHITECTURE_SPECS', () => {
  it('non contiene identificativi duplicati', () => {
    const ids = ARCHITECTURE_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ogni percorso di file esiste davvero nel repository', () => {
    for (const spec of ARCHITECTURE_SPECS) {
      expect(existsSync(resolve(ROOT, spec.file)), `manca ${spec.file} (spec ${spec.id})`).toBe(
        true,
      );
    }
  });

  it('ogni voce spiega il perché, non solo il cosa', () => {
    // È la parte che distingue una decisione da un default lasciato com'era, ed
    // è l'unica ragione per cui questa vetrina esiste.
    for (const spec of ARCHITECTURE_SPECS) {
      expect(spec.why.length, `perché troppo corto in ${spec.id}`).toBeGreaterThan(120);
      expect(spec.what.length).toBeGreaterThan(40);
      expect(spec.headline.length).toBeGreaterThan(15);
    }
  });

  it('ogni voce porta uno spezzone di codice', () => {
    for (const spec of ARCHITECTURE_SPECS) {
      expect(spec.snippet.trim().length, `spezzone vuoto in ${spec.id}`).toBeGreaterThan(20);
    }
  });

  it('tiene i badge corti abbastanza da stare accanto a un titolo', () => {
    for (const spec of ARCHITECTURE_SPECS) {
      expect(spec.label.length, `etichetta lunga in ${spec.id}`).toBeLessThanOrEqual(32);
    }
  });

  it('usa solo categorie dichiarate, tutte etichettate', () => {
    for (const spec of ARCHITECTURE_SPECS) {
      expect(SPEC_CATEGORIES).toContain(spec.category);
    }
    for (const category of SPEC_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('nessuna metrica dichiara una latenza inventata', () => {
    // Un badge "Edge Runtime · 12ms" su una pagina che non ha misurato nulla è
    // un numero decorativo, e su un'applicazione il cui argomento è "i numeri li
    // calcola il codice" è il dettaglio che smonta il resto. Le latenze reali
    // stanno dove vengono misurate: metriche di run e tabella dei costi.
    for (const spec of ARCHITECTURE_SPECS) {
      expect(spec.metric, `metrica temporale in ${spec.id}`).not.toMatch(/\d+\s*(ms|s\b|sec)/i);
    }
  });

  it('copre ogni categoria con almeno una voce', () => {
    for (const category of SPEC_CATEGORIES) {
      expect(specsByCategory(category).length, `categoria vuota: ${category}`).toBeGreaterThan(0);
    }
  });

  it('la somma delle categorie ricompone il catalogo, senza doppioni', () => {
    const total = SPEC_CATEGORIES.reduce((sum, c) => sum + specsByCategory(c).length, 0);
    expect(total).toBe(ARCHITECTURE_SPECS.length);
  });
});

describe('getSpec', () => {
  it('trova una voce per identificativo', () => {
    expect(getSpec('deterministic-scoring')?.category).toBe('ai');
  });

  it('restituisce undefined su un identificativo ignoto, senza lanciare', () => {
    // Il badge in interfaccia non rende nulla in questo caso: un riquadro vuoto
    // sarebbe peggio dell'assenza.
    expect(getSpec('non-esiste')).toBeUndefined();
  });
});

describe('TECH_STACK', () => {
  it('elenca aree non vuote', () => {
    expect(TECH_STACK.length).toBeGreaterThan(3);
    for (const group of TECH_STACK) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('non ripete la stessa area', () => {
    const areas = TECH_STACK.map((group) => group.area);
    expect(new Set(areas).size).toBe(areas.length);
  });
});
