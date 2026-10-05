'use client';
import type * as HB from 'harfbuzzjs';
import { shaperFrom } from './fonts';
import type { Shaper } from './lettering';

/* Harf's Arabic fonts in the lettering tool. Harf (harf.omardeek.tech) is the
   font previewer next to Cut Studio; it publishes the Arabic part of its
   catalogue as one small file, and every font is loaded from there when it is
   chosen. Nothing about the text goes out: only the font files come in. */

export const HARF_URL = 'https://harf.omardeek.tech';

export type HarfFile = { path: string; weight: number; variable: boolean };
export type HarfFont = {
  id: string; family: string; category: string;
  /** Whether the font also draws Latin letters and digits. */
  latin: boolean;
  weights: number[]; weightRange: [number, number] | null;
  files: HarfFile[]; designers: string[];
  licence: string; licenceFile: string;
};

/** Harf's own categories, with names for both sites. */
export const harfCategories: { id: string; en: string; ar: string }[] = [
  { id: '', en: 'All', ar: 'الكل' },
  { id: 'عصري', en: 'Modern', ar: 'عصري' },
  { id: 'نسخي', en: 'Naskh', ar: 'نسخي' },
  { id: 'عرض', en: 'Display', ar: 'عرض' },
  { id: 'يدوي', en: 'Handwritten', ar: 'يدوي' },
  { id: 'ثابت', en: 'Fixed width', ar: 'ثابت العرض' },
];

export const weightNames: Record<number, [string, string]> = {
  100: ['Thin', 'رفيع جداً'], 200: ['Extra light', 'رفيع'], 300: ['Light', 'خفيف'], 400: ['Regular', 'عادي'], 500: ['Medium', 'متوسط'],
  600: ['Semibold', 'شبه عريض'], 700: ['Bold', 'عريض'], 800: ['Extra bold', 'عريض جداً'], 900: ['Black', 'أسود'], 1000: ['Extra black', 'أسود جداً'],
};

/** A file's address on Harf. Commas stay literal, the way Harf serves them. */
export function harfFileUrl(path: string) {
  return `${HARF_URL}/${path.split('/').map(part => encodeURIComponent(part).replace(/%2C/gi, ',')).join('/')}`;
}

let catalogue: Promise<HarfFont[]> | null = null;
/** The catalogue, fetched once; a failed fetch can be tried again. */
export function harfCatalogue(): Promise<HarfFont[]> {
  return (catalogue ??= fetch(`${HARF_URL}/catalog/arabic.json`)
    .then(response => { if (!response.ok) throw new Error('The Harf font library could not be reached.'); return response.json() as Promise<{ fonts: HarfFont[] }>; })
    .then(data => data.fonts)
    .catch(cause => { catalogue = null; throw cause instanceof Error && cause.message.startsWith('The Harf') ? cause : new Error('The Harf font library could not be reached.'); }));
}

/** The weight to start a font at: bold where it has one, since bold letters cut cleanly. */
export function startWeight(font: HarfFont) {
  return [...font.weights].sort((a, b) => Math.abs(a - 700) - Math.abs(b - 700) || b - a)[0] ?? 400;
}

/** The file that draws `weight`, and the weight axis to set when that file is variable. */
export function harfFileFor(font: HarfFont, weight: number): { file: HarfFile; wght: number | null } {
  const variable = font.files.find(f => f.variable);
  if (variable) {
    const [low, high] = font.weightRange ?? [weight, weight];
    return { file: variable, wght: Math.min(high, Math.max(low, weight)) };
  }
  const file = [...font.files].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || a.weight - b.weight)[0];
  if (!file) throw new Error('This font has no files.');
  return { file, wght: null };
}

const downloads = new Map<string, Promise<Uint8Array>>();
function download(path: string) {
  let pending = downloads.get(path);
  if (!pending) {
    pending = fetch(harfFileUrl(path))
      .then(response => { if (!response.ok) throw new Error('The font could not be loaded.'); return response.arrayBuffer(); })
      .then(buffer => new Uint8Array(buffer))
      .catch(cause => { downloads.delete(path); throw cause; });
    downloads.set(path, pending);
  }
  return pending;
}

/** A Harf font ready for HarfBuzz at the weight asked for. */
export async function harfShaper(hb: typeof HB, font: HarfFont, weight: number): Promise<Shaper> {
  const { file, wght } = harfFileFor(font, weight);
  const shaper = await shaperFrom(hb, await download(file.path));
  if (wght !== null) shaper.font.setVariations([new hb.Variation('wght', wght)]);
  return shaper;
}

const faces = new Map<string, Promise<string>>();
/** Loads a font for its preview card as a web font, once, and gives the CSS family to use. */
export function previewFamily(font: HarfFont): Promise<string> {
  let pending = faces.get(font.id);
  if (!pending) {
    const { file } = harfFileFor(font, 400);
    const family = `harf-${font.id}`;
    const face = new FontFace(family, `url("${harfFileUrl(file.path)}")`, file.variable && font.weightRange ? { weight: `${font.weightRange[0]} ${font.weightRange[1]}` } : {});
    pending = face.load().then(loaded => { document.fonts.add(loaded); return family; }).catch(cause => { faces.delete(font.id); throw cause; });
    faces.set(font.id, pending);
  }
  return pending;
}
