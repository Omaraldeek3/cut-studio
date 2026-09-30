import type * as HB from 'harfbuzzjs';

/* Setting text as cuttable outlines. HarfBuzz does the shaping, which is
   what makes Arabic come out joined: every letter takes its initial, medial or
   final form and ligatures like لا form as the font intends. Lines are split
   into runs of one direction first, so a shop name that mixes Arabic with a
   brand in Latin letters, or with a phone number, reads in the right order. */

type Pt = { x: number; y: number };
export type Command = { type: string; values: number[] };
export type Shaper = { font: HB.Font; upem: number };
export type Fonts = { arabic: Shaper; latin: Shaper };
export type Align = 'right' | 'center' | 'left';
export type LayoutOptions = { lineHeight: number; wordSpacing: number; letterSpacing: number; align: Align };
export type Layout = { glyphs: Command[][]; missing: number; lines: number };

const ARABIC = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
const DIGIT = /[0-9٠-٩۰-۹]/;

export type Run = { text: string; rtl: boolean };

/** Splits a line into runs of one direction, in logical order, and says
 *  which way the line as a whole reads. A simplified bidi: Arabic is
 *  right-to-left, Latin letters and all digits left-to-right, and spaces or
 *  punctuation follow their neighbours when both agree, the line otherwise. */
export function bidiRuns(line: string): { rtl: boolean; runs: Run[] } {
  const chars = [...line];
  const kind = chars.map(c => (ARABIC.test(c) && !DIGIT.test(c) ? 'R' : LATIN.test(c) || DIGIT.test(c) ? 'L' : 'N'));
  const firstStrong = kind.find(k => k !== 'N');
  const rtl = firstStrong ? firstStrong === 'R' : false;
  const resolved = kind.map((k, i) => {
    if (k !== 'N') return k;
    let before = 'N', after = 'N';
    for (let j = i - 1; j >= 0 && before === 'N'; j--) before = kind[j];
    for (let j = i + 1; j < kind.length && after === 'N'; j++) after = kind[j];
    return before === after && before !== 'N' ? before : rtl ? 'R' : 'L';
  });
  // A closing bracket takes the direction of its opening one, so "(2026)"
  // stays one piece instead of losing its last bracket to the other side.
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const open: number[] = [];
  chars.forEach((c, i) => {
    if (c === '(' || c === '[' || c === '{') open.push(i);
    else if (pairs[c]) {
      const at = open.map(j => chars[j]).lastIndexOf(pairs[c]);
      if (at >= 0) { resolved[i] = resolved[open[at]]; open.splice(at); }
    }
  });
  const runs: Run[] = [];
  chars.forEach((c, i) => {
    const r = resolved[i] === 'R';
    const last = runs[runs.length - 1];
    if (last && last.rtl === r) last.text += c;
    else runs.push({ text: c, rtl: r });
  });
  return { rtl, runs };
}

type Placed = { gid: number; x: number; y: number; shaper: Shaper };

function shapeRun(hb: typeof HB, shaper: Shaper, run: Run, o: LayoutOptions) {
  const buffer = new hb.Buffer();
  buffer.addText(run.text);
  buffer.setDirection(run.rtl ? hb.Direction.RTL : hb.Direction.LTR);
  buffer.guessSegmentProperties();
  hb.shape(shaper.font, buffer);
  const k = 1000 / shaper.upem;
  const units = run.text.split('');
  let pen = 0, missing = 0;
  const glyphs: Placed[] = [];
  for (const g of buffer.getGlyphInfosAndPositions()) {
    if (g.codepoint === 0 && units[g.cluster] !== undefined && units[g.cluster].trim()) missing++;
    glyphs.push({ gid: g.codepoint, x: pen + (g.xOffset ?? 0) * k, y: (g.yOffset ?? 0) * k, shaper });
    pen += (g.xAdvance ?? 0) * k;
    const char = units[g.cluster];
    if (char === ' ') pen += o.wordSpacing * 1000;
    // Letter spacing only between separate letters, never inside a joined word.
    else if (!run.rtl && o.letterSpacing) pen += o.letterSpacing * 1000;
  }
  return { glyphs, width: pen, missing };
}

/** Shapes and places every line. Coordinates are in thousandths of an em,
 *  y pointing down, the first baseline at the font's ascender. */
export function layoutText(hb: typeof HB, fonts: Fonts, text: string, o: LayoutOptions): Layout {
  const lines = text.replace(/\r/g, '').split('\n');
  const extents = fonts.arabic.font.hExtents();
  const k = 1000 / fonts.arabic.upem;
  const ascender = extents.ascender * k, descender = -extents.descender * k;
  const advance = (ascender + descender) * o.lineHeight;
  const shaped = lines.map(line => {
    const { rtl, runs } = bidiRuns(line);
    // Within a run, each character goes to the font that has it; with the
    // built-in pair that sends Arabic to one file and Latin to the other, and
    // lets punctuation fall back to whichever file carries it. The pieces of a
    // right-to-left run are laid out right to left, like the run itself.
    const groups = runs.map(run => {
      const primary = ARABIC.test(run.text) ? fonts.arabic : fonts.latin;
      const segments: { shaper: Shaper; text: string }[] = [];
      for (const char of run.text) {
        const code = char.codePointAt(0)!;
        const shaper = ARABIC.test(char) ? fonts.arabic
          : LATIN.test(char) || /[0-9]/.test(char) ? fonts.latin
          : primary.font.glyph(code) !== undefined && primary.font.glyph(code) !== 0 ? primary
          : fonts.arabic === primary ? fonts.latin : fonts.arabic;
        const last = segments[segments.length - 1];
        if (last && last.shaper === shaper) last.text += char;
        else segments.push({ shaper, text: char });
      }
      const shapedSegments = segments.map(segment => shapeRun(hb, segment.shaper, { text: segment.text, rtl: run.rtl }, o));
      return run.rtl ? shapedSegments.reverse() : shapedSegments;
    });
    // Each group is already left to right inside; a right-to-left line
    // shows its runs in reverse, the first run on the right.
    const pieces = (rtl ? [...groups].reverse() : groups).flat();
    const width = pieces.reduce((sum, p) => sum + p.width, 0);
    return { rtl, pieces, width, missing: pieces.reduce((n, p) => n + p.missing, 0) };
  });
  const widest = Math.max(0, ...shaped.map(l => l.width));
  const glyphs: Command[][] = [];
  let missing = 0;
  shaped.forEach((line, index) => {
    missing += line.missing;
    const baseline = ascender + index * advance;
    let x = o.align === 'left' ? 0 : o.align === 'right' ? widest - line.width : (widest - line.width) / 2;
    for (const piece of line.pieces) {
      for (const g of piece.glyphs) {
        const scale = 1000 / g.shaper.upem;
        const commands = g.shaper.font.glyphToJson(g.gid).map(c => ({
          type: c.type,
          values: c.values.map((v, i) => (i % 2 === 0 ? x + g.x + v * scale : baseline - g.y - v * scale)),
        }));
        if (commands.length) glyphs.push(commands);
      }
      x += piece.width;
    }
  });
  return { glyphs, missing, lines: lines.length };
}

/** Closed loops from glyph commands, curves broken into straight segments
 *  no further than `tolerance` from the true curve. */
export function commandLoops(glyphs: Command[][], tolerance: number): Pt[][] {
  const loops: Pt[][] = [];
  const t2 = tolerance * tolerance;
  const quad = (out: Pt[], p0: Pt, c: Pt, p: Pt, depth: number) => {
    const mx = (p0.x + 2 * c.x + p.x) / 4, my = (p0.y + 2 * c.y + p.y) / 4;
    const lx = (p0.x + p.x) / 2, ly = (p0.y + p.y) / 2;
    if (depth > 10 || (mx - lx) ** 2 + (my - ly) ** 2 <= t2) { out.push(p); return; }
    const a = { x: (p0.x + c.x) / 2, y: (p0.y + c.y) / 2 }, b = { x: (c.x + p.x) / 2, y: (c.y + p.y) / 2 };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    quad(out, p0, a, m, depth + 1); quad(out, m, b, p, depth + 1);
  };
  const cubic = (out: Pt[], p0: Pt, c1: Pt, c2: Pt, p: Pt, depth: number) => {
    const d1 = Math.abs((c1.x - p.x) * (p.y - p0.y) - (c1.y - p.y) * (p.x - p0.x));
    const d2 = Math.abs((c2.x - p.x) * (p.y - p0.y) - (c2.y - p.y) * (p.x - p0.x));
    const chord = (p.x - p0.x) ** 2 + (p.y - p0.y) ** 2;
    if (depth > 10 || (d1 + d2) ** 2 <= t2 * Math.max(chord, 1e-9)) { out.push(p); return; }
    const ab = { x: (p0.x + c1.x) / 2, y: (p0.y + c1.y) / 2 }, bc = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 }, cd = { x: (c2.x + p.x) / 2, y: (c2.y + p.y) / 2 };
    const abc = { x: (ab.x + bc.x) / 2, y: (ab.y + bc.y) / 2 }, bcd = { x: (bc.x + cd.x) / 2, y: (bc.y + cd.y) / 2 };
    const m = { x: (abc.x + bcd.x) / 2, y: (abc.y + bcd.y) / 2 };
    cubic(out, p0, ab, abc, m, depth + 1); cubic(out, m, bcd, cd, p, depth + 1);
  };
  for (const glyph of glyphs) {
    let current: Pt[] = [];
    let at: Pt = { x: 0, y: 0 };
    const close = () => { if (current.length > 2) loops.push(current); current = []; };
    for (const c of glyph) {
      const v = c.values;
      if (c.type === 'M') { close(); at = { x: v[0], y: v[1] }; current.push(at); }
      else if (c.type === 'L') { at = { x: v[0], y: v[1] }; current.push(at); }
      else if (c.type === 'Q') { const p = { x: v[2], y: v[3] }; quad(current, at, { x: v[0], y: v[1] }, p, 0); at = p; }
      else if (c.type === 'C') { const p = { x: v[4], y: v[5] }; cubic(current, at, { x: v[0], y: v[1] }, { x: v[2], y: v[3] }, p, 0); at = p; }
      else if (c.type === 'Z') close();
    }
    close();
  }
  return loops;
}

function area(loop: Pt[]) {
  let sum = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) sum += loop[j].x * loop[i].y - loop[i].x * loop[j].y;
  return Math.abs(sum / 2);
}

function inside(point: Pt, loop: Pt[]) {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Groups loops into parts: each outer outline with the holes directly
 *  inside it (the counters of ه, ص, o and the like). */
export function groupLoops(loops: Pt[][]): Pt[][][] {
  const order = loops.map((loop, i) => ({ loop, i, area: area(loop) })).sort((a, b) => b.area - a.area);
  const parent = new Map<number, number>(), depth = new Map<number, number>();
  order.forEach((item, rank) => {
    let owner = -1, d = 0;
    for (let r = rank - 1; r >= 0; r--) {
      const candidate = order[r];
      if (inside(item.loop[0], candidate.loop)) {
        d++;
        if (owner < 0) owner = candidate.i;
      }
    }
    parent.set(item.i, owner);
    depth.set(item.i, d);
  });
  const groups = new Map<number, Pt[][]>();
  for (const item of order) {
    if (depth.get(item.i)! % 2 === 0) groups.set(item.i, [item.loop]);
    else groups.get(parent.get(item.i)!)?.push(item.loop);
  }
  return [...groups.values()];
}
