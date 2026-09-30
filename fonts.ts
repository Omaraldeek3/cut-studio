'use client';
import type * as HB from 'harfbuzzjs';
import { commandLoops, layoutText, type Fonts, type LayoutOptions, type Shaper } from './lettering';
import { woffToSfnt } from './woff';

/* Fonts for the tools that set text: HarfBuzz, loaded once from the copy
   served next to the page, and the built-in Tajawal in three weights. */

export type LocalFont = { family: string; fullName: string; postscriptName: string; style: string; blob: () => Promise<Blob> };
export type FontChoice = { label: string; fonts: Fonts };

export const WEIGHTS = [{ id: '400', en: 'Regular', ar: 'عادي' }, { id: '700', en: 'Bold', ar: 'عريض' }, { id: '900', en: 'Black', ar: 'عريض جداً' }];

let harfbuzz: Promise<typeof HB> | null = null;
export function loadHarfBuzz() {
  return (harfbuzz ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/harfbuzz/index.mjs', window.location.origin).href) as Promise<typeof HB>);
}

export async function shaperFrom(hb: typeof HB, bytes: Uint8Array, postscript?: string): Promise<Shaper> {
  const sfnt = await woffToSfnt(bytes);
  const blob = new hb.Blob(sfnt);
  // A collection (.ttc) holds several faces; pick the one asked for.
  const collection = sfnt[0] === 0x74 && sfnt[1] === 0x74 && sfnt[2] === 0x63 && sfnt[3] === 0x66;
  let face = new hb.Face(blob, 0);
  if (collection && postscript) {
    for (let i = 0; i < 32; i++) {
      const candidate = new hb.Face(blob, i);
      if (!candidate.upem) break;
      if (candidate.getName(6, 'en') === postscript) { face = candidate; break; }
    }
  }
  if (!face.upem) throw new Error('This file is not a font HarfBuzz can read.');
  return { font: new hb.Font(face), upem: face.upem };
}

/** The built-in Tajawal: an Arabic file and a Latin file of one weight. */
export async function builtInFonts(weight: string): Promise<{ engine: typeof HB; choice: FontChoice }> {
  const engine = await loadHarfBuzz();
  const read = async (script: string) => new Uint8Array(await (await fetch(`/vendor/fonts/tajawal-${script}-${weight}-normal.woff`)).arrayBuffer());
  const [arabic, latin] = await Promise.all([shaperFrom(engine, await read('arabic')), shaperFrom(engine, await read('latin'))]);
  return { engine, choice: { label: `Tajawal ${WEIGHTS.find(x => x.id === weight)?.en ?? ''}`, fonts: { arabic, latin } } };
}

/** Shaped text as closed loops in font units, moved so its bounds start at
 *  (0, 0). Curves are flattened within `tolerance` font units. */
export function textLoops(hb: typeof HB, fonts: Fonts, text: string, tolerance: number, o: LayoutOptions = { lineHeight: 1.1, wordSpacing: 0, letterSpacing: 0, align: 'center' }) {
  const layout = layoutText(hb, fonts, text, o);
  const loops = commandLoops(layout.glyphs, tolerance);
  if (!loops.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const loop of loops) for (const p of loop) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { loops: loops.map(loop => loop.map(p => ({ x: p.x - x0, y: p.y - y0 }))), width: x1 - x0, height: y1 - y0, missing: layout.missing };
}
