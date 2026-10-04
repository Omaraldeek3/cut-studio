import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localizeError } from '../src/toolkit/errors';
import { quote, defaultQuote } from '../src/toolkit/quote';

// Developer checks that no form or file can trigger; they stay in English.
const internal = new Set(['RowResampler only shrinks.', 'RowUpsampler only enlarges.', 'aborted', 'Unsupported SVG path command.']);
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
const sources = files('src/toolkit').filter(f => !f.endsWith('errors.ts')).map(f => readFileSync(f, 'utf8'));

test('every fixed error message the toolkit throws has an Arabic version', () => {
  const missing = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(/(?:fail|Error)\(\s*(['`])((?:\\.|(?!\1).)*)\1/g)) {
    const text = m[2];
    if (!text || text.includes('${') || internal.has(text)) continue;
    if (localizeError(text, 'ar') === text) missing.add(text);
  }
  expect([...missing]).toEqual([]);
});

test('every field named in a range check has an Arabic name', () => {
  const missing = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(/\b(?:check|finite)\([^;()]*?,\s*'([A-Z][a-zA-Z ]*)'\)/g)) {
    const message = `${m[1]} must be between 0 and 1.`;
    // Acronyms such as DPI stay in Latin letters; English words do not.
    if (/[a-z]{3}/.test(localizeError(message, 'ar'))) missing.add(m[1]);
  }
  expect([...missing]).toEqual([]);
});

test('messages read naturally in Arabic and stay as they are in English', () => {
  let message = '';
  try { quote(null, { ...defaultQuote, profit: 5000 }); } catch (e) { message = (e as Error).message; }
  expect(message).toBe('Profit must be between 0 and 1000.');
  expect(localizeError(message, 'ar')).toBe('الربح يجب أن يكون بين 0 و1000.');
  expect(localizeError(message, 'en')).toBe(message);
  expect(localizeError('DXF: Binary DXF is unsupported; export ASCII DXF.', 'ar')).toBe('DXF: ملفات DXF الثنائية غير مدعومة. صدّر الملف بصيغة ASCII DXF.');
  expect(localizeError('Unsupported entity HATCH. Convert it to flat LINE, POLYLINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE or SPLINE geometry before import.', 'ar')).toContain('HATCH');
  expect(localizeError('Something new.', 'ar')).toBe('Something new.');
});
