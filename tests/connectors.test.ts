import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_IDS,
  CONNECTORS,
  DEFAULT_LIMIT,
  describeCatalog,
  executeConnectorCall,
  listResources,
  MAX_LIMIT,
} from '@/lib/agent/connectors';

/**
 * Test dei connettori simulati.
 *
 * Il punto non è verificare dei dati finti, ma due proprietà da cui dipende il
 * resto: che le stesse chiamate diano sempre gli stessi record (altrimenti né i
 * test né la dashboard sono leggibili), e che un input sbagliato produca un
 * errore con le alternative valide invece di un risultato vuoto ambiguo.
 */

describe('catalogo', () => {
  it('dichiara almeno una risorsa per ogni connettore', () => {
    for (const id of CONNECTOR_IDS) {
      expect(listResources(id).length).toBeGreaterThan(0);
    }
  });

  it('dichiara i campi filtrabili di ogni risorsa', () => {
    for (const connector of Object.values(CONNECTORS)) {
      for (const resource of Object.values(connector.resources)) {
        expect(resource.fields.length).toBeGreaterThan(0);
      }
    }
  });

  it('descrive il catalogo con tutti i connettori: finisce nel prompt del tool', () => {
    const description = describeCatalog();
    for (const id of CONNECTOR_IDS) {
      expect(description).toContain(id);
    }
  });
});

describe('esecuzione', () => {
  it('restituisce record deterministici fra chiamate successive', () => {
    const first = executeConnectorCall({ connector: 'crm', resource: 'accounts', limit: 5 });
    const second = executeConnectorCall({ connector: 'crm', resource: 'accounts', limit: 5 });

    expect(first).toEqual(second);
  });

  it('marca sempre la risposta come simulata', () => {
    const result = executeConnectorCall({ connector: 'erp', resource: 'invoices' });
    expect(result).toMatchObject({ ok: true, simulated: true });
  });

  it('applica il limite di default quando non è specificato', () => {
    const result = executeConnectorCall({ connector: 'erp', resource: 'invoices' });
    expect(result.ok && result.records.length).toBe(DEFAULT_LIMIT);
  });

  it('costringe il limite entro il tetto massimo', () => {
    const result = executeConnectorCall({ connector: 'erp', resource: 'invoices', limit: 9_999 });
    expect(result.ok && result.records.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('espone il totale delle corrispondenze oltre a quelle restituite', () => {
    const result = executeConnectorCall({ connector: 'erp', resource: 'invoices', limit: 2 });
    expect(result.ok && result.totalMatching).toBeGreaterThan(2);
  });
});

describe('filtri', () => {
  it('filtra per sottostringa senza distinzione di maiuscole', () => {
    const result = executeConnectorCall({
      connector: 'erp',
      resource: 'invoices',
      filters: { status: 'SCADUTA' },
      limit: MAX_LIMIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((record) => record.status === 'scaduta')).toBe(true);
  });

  it('combina più filtri in AND', () => {
    const single = executeConnectorCall({
      connector: 'support',
      resource: 'tickets',
      filters: { severity: 'S1' },
      limit: MAX_LIMIT,
    });
    const combined = executeConnectorCall({
      connector: 'support',
      resource: 'tickets',
      filters: { severity: 'S1', status: 'aperto' },
      limit: MAX_LIMIT,
    });

    expect(single.ok && combined.ok).toBe(true);
    if (!single.ok || !combined.ok) return;
    expect(combined.totalMatching).toBeLessThanOrEqual(single.totalMatching);
  });
});

describe('errori', () => {
  it('su risorsa inesistente elenca quelle valide', () => {
    const result = executeConnectorCall({ connector: 'crm', resource: 'fatture' });

    expect(result).toMatchObject({ ok: false, error: 'unknown_resource' });
    expect(result.ok === false && result.available).toContain('accounts');
  });

  it('su campo di filtro inesistente elenca i campi validi', () => {
    const result = executeConnectorCall({
      connector: 'crm',
      resource: 'accounts',
      filters: { fatturato: '100' },
    });

    // Un campo sbagliato produrrebbe zero risultati indistinguibili da "nessuna
    // corrispondenza": il modello concluderebbe che il dato non esiste.
    expect(result).toMatchObject({ ok: false, error: 'unknown_filter_field' });
    expect(result.ok === false && result.available).toContain('arr_eur');
  });

  it('su connettore inesistente elenca quelli disponibili', () => {
    const result = executeConnectorCall({
      // Forzatura deliberata: simula un input che aggira la validazione Zod.
      connector: 'inesistente' as never,
      resource: 'accounts',
    });

    expect(result).toMatchObject({ ok: false, error: 'unknown_connector' });
    expect(result.ok === false && result.available).toEqual([...CONNECTOR_IDS]);
  });
});
