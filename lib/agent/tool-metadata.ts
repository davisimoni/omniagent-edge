/**
 * Nomi ed etichette dei tool, senza dipendenze di runtime.
 *
 * Modulo separato da `tools.ts` di proposito: la dashboard ha bisogno delle sole
 * etichette per rendere la timeline, e importarle da `tools.ts` trascinerebbe nel
 * bundle del browser il driver del database, il provider del modello e i
 * connettori — cioè l'intero lato server, per tre stringhe.
 *
 * L'allineamento con i tool reali non è affidato alla disciplina: `tools.ts`
 * contiene un'asserzione di tipo che non compila se i due elenchi divergono.
 */

export const AGENT_TOOL_NAMES = [
  'searchVectorDB',
  'extractStructuredData',
  'fetchExternalAPI',
  'checkContractRisk',
  'verifySLABreach',
  'generateAuditReport',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** Tool di audit contrattuale, evidenziati a parte nell'interfaccia. */
export const COMPLIANCE_TOOL_NAMES = [
  'checkContractRisk',
  'verifySLABreach',
  'generateAuditReport',
] as const satisfies readonly AgentToolName[];

export function isComplianceTool(name: string): boolean {
  return (COMPLIANCE_TOOL_NAMES as readonly string[]).includes(name);
}

export const TOOL_LABELS: Readonly<Record<AgentToolName, string>> = {
  searchVectorDB: 'Ricerca vettoriale',
  extractStructuredData: 'Estrazione strutturata',
  fetchExternalAPI: 'API enterprise',
  checkContractRisk: 'Audit contrattuale',
  verifySLABreach: 'Verifica SLA',
  generateAuditReport: 'Report esecutivo',
};

export const TOOL_DESCRIPTIONS: Readonly<Record<AgentToolName, string>> = {
  searchVectorDB: 'Ricerca ibrida su pgvector: vettoriale + full-text, fuse con RRF.',
  extractStructuredData: 'Testo libero → JSON validato con citazione a supporto.',
  fetchExternalAPI: 'CRM, ERP e ticketing in sola lettura, da catalogo chiuso.',
  checkContractRisk: 'Rilievi GDPR/ISO, penali e recesso, con punteggio deterministico.',
  verifySLABreach: 'Prestazioni misurate contro impegni contrattuali, per aritmetica.',
  generateAuditReport: 'Report esecutivo con giudizio operativo, da un audit già eseguito.',
};
