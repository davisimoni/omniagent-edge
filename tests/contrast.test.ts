import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Verifica dei contrasti WCAG sui token del tema.
 *
 * I colori qui sotto non sono decorativi: `success`, `warning` e `danger`
 * portano le etichette di rischio — "Basso", "Medio", "Critico" — che sono
 * l'informazione per cui questa interfaccia esiste. Un'etichetta di rischio
 * illeggibile è un difetto funzionale, non estetico.
 *
 * Il test legge i valori **dal foglio di stile**, non da una copia: un test che
 * verifica costanti duplicate nel file di test dimostra solo che le due copie
 * coincidono. Così, chi ritocca una tinta in `globals.css` scopre subito se l'ha
 * portata sotto soglia.
 *
 * Soglia 4,5:1 (WCAG 2.1 AA, testo normale): le etichette sono a 11px, quindi
 * non godono della soglia ridotta del testo grande.
 */

const CSS = readFileSync(resolve(__dirname, '..', 'app', 'globals.css'), 'utf8');

const AA_NORMAL_TEXT = 4.5;

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Estrae un token `--nome: oklch(L C H)` dal blocco indicato. */
function readToken(block: string, name: string): Oklch {
  const match = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(block);
  if (match === null) throw new Error(`Token --${name} non trovato nel blocco.`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function blockFor(selector: string): string {
  const index = CSS.indexOf(selector);
  if (index === -1) throw new Error(`Selettore ${selector} non trovato.`);
  const start = CSS.indexOf('{', index);
  const end = CSS.indexOf('}', start);
  return CSS.slice(start, end);
}

/** OKLCH → sRGB lineare, secondo la conversione di riferimento di OKLab. */
function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
}

function relativeLuminance(color: Oklch): number {
  const [r, g, b] = toLinearSrgb(color);
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function contrast(a: Oklch, b: Oklch): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const FOREGROUND_TOKENS = ['foreground', 'muted', 'accent', 'success', 'warning', 'danger'] as const;
const SURFACE_TOKENS = ['background', 'surface', 'surface-raised'] as const;

describe.each([
  { mode: 'chiaro', selector: ':root' },
  { mode: 'scuro', selector: '.dark' },
])('contrasto in tema $mode', ({ selector }) => {
  const block = blockFor(selector);

  it.each(FOREGROUND_TOKENS)('%s raggiunge 4,5:1 su ogni superficie', (token) => {
    const color = readToken(block, token);
    for (const surfaceToken of SURFACE_TOKENS) {
      const surface = readToken(block, surfaceToken);
      const ratio = contrast(color, surface);
      expect(ratio, `--${token} su --${surfaceToken}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    }
  });
});

describe('accent-foreground', () => {
  it('è leggibile sul proprio accent, in entrambi i temi', () => {
    // È il testo dei pulsanti principali e delle mattonelle di priorità: qui il
    // contrasto si misura contro l'accent, non contro lo sfondo della pagina.
    for (const selector of [':root', '.dark']) {
      const block = blockFor(selector);
      const ratio = contrast(readToken(block, 'accent-foreground'), readToken(block, 'accent'));
      expect(ratio, `${selector}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });
});
