import { fitCubic, fitLoop, flatten, polygonArea, tangent, type Bez, type Curve, type V, type VectorPath } from './vectorize';

/* Cut-out tracing on one shared boundary graph.

   Tracing each colour on its own draws every border between two colours
   twice, once from each side, and the two copies never quite agree: a laser
   cuts the line twice and the plotter leaves slivers. Here the borders are
   found once, on the cracks between pixels of different labels. A border runs
   from one junction (where three or more regions meet) to the next, or round
   in a loop, and is smoothed and fitted once with its ends pinned to the
   junctions. Every region's outline is then the chain of its borders, so
   neighbouring colours share exactly the same curve. */

/** A fitted border. `left` and `right` are the labels on each side, walking
 *  from start to end in y-down coordinates; -1 is outside or ignored. */
export type TracedEdge = VectorPath & { closed: boolean; left: number; right: number; raw: V[] };

type Options = { error: number; cornerAngle: number; reach: number; minLoop: number };

const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const len = (a: V) => Math.hypot(a.x, a.y);

/** Corners of an open chain: interior points that turn more sharply than `angle`. */
function openCorners(d: V[], angle: number): number[] {
  const n = d.length, limit = Math.cos((angle * Math.PI) / 180);
  const sharp = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) {
    const turn = -dot(tangent(d, i, -1, 2.5, false), tangent(d, i, 1, 2.5, false));
    sharp[i] = turn < limit ? limit - turn : 0;
  }
  const corners: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!sharp[i]) continue;
    let best = true;
    for (let k = -4; k <= 4 && best; k++) if (k && i + k > 0 && i + k < n - 1 && sharp[i + k] > sharp[i]) best = false;
    if (best && (!corners.length || i - corners[corners.length - 1] > 2)) corners.push(i);
  }
  return corners;
}

/** Averages each point with its neighbours up to `reach` away, never past a fixed point. */
function softenOpen(d: V[], fixed: Uint8Array, reach: number): V[] {
  const n = d.length;
  let total = 0;
  for (let i = 1; i < n; i++) total += len({ x: d[i].x - d[i - 1].x, y: d[i].y - d[i - 1].y });
  const k = Math.min(Math.floor(n / 6), Math.round(reach / (total / Math.max(1, n - 1))));
  if (k < 1) return d;
  return d.map((p, i) => {
    if (fixed[i]) return p;
    let sx = 0, sy = 0, weight = 0;
    for (const step of [1, -1]) for (let j = 1; j <= k; j++) {
      const q = i + step * j;
      if (q < 0 || q >= n) break;
      const w = k + 1 - j;
      sx += d[q].x * w; sy += d[q].y * w; weight += w;
      if (fixed[q]) break;
    }
    const own = k + 1;
    return { x: (sx + p.x * own) / (weight + own), y: (sy + p.y * own) / (weight + own) };
  });
}

/** Where the straight runs on either side of corner `i` would meet, when that is close. */
function sharpenOpen(d: V[], i: number): V {
  const n = d.length;
  if (i - 8 < 0 || i + 8 >= n) return d[i];
  const along = (s: 1 | -1) => {
    const near = d[i + s * 3], far = d[i + s * 8], l = len({ x: near.x - far.x, y: near.y - far.y }) || 1;
    return { o: near, dir: { x: (near.x - far.x) / l, y: (near.y - far.y) / l } };
  };
  const a = along(-1), b = along(1);
  const cross = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
  if (Math.abs(cross) < 0.2) return d[i];
  const t = ((b.o.x - a.o.x) * b.dir.y - (b.o.y - a.o.y) * b.dir.x) / cross;
  const meet = { x: a.o.x + a.dir.x * t, y: a.o.y + a.dir.y * t };
  return len({ x: meet.x - d[i].x, y: meet.y - d[i].y }) < 2 ? meet : d[i];
}

/** Fits an open chain with cubics, its two ends kept exactly where they are. */
function fitOpen(points: V[], o: Options): VectorPath {
  const n = points.length;
  const first = points[0], last = points[n - 1];
  const straight = (a: V, b: V): Bez => [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 }, b];
  const out: Bez[] = [];
  if (n <= 3) out.push(straight(first, last));
  else {
    const corners = openCorners(points, o.cornerAngle);
    const fixed = new Uint8Array(n);
    fixed[0] = fixed[n - 1] = 1;
    for (const c of corners) fixed[c] = 1;
    const d = softenOpen(points, fixed, o.reach);
    for (const c of corners) d[c] = sharpenOpen(points, c);
    const cuts = [0, ...corners, n - 1];
    const snap = Math.max(0.35, o.error * 0.5);
    for (let c = 0; c < cuts.length - 1; c++) {
      const piece = d.slice(cuts[c], cuts[c + 1] + 1);
      const a = piece[0], b = piece[piece.length - 1], chord = len({ x: b.x - a.x, y: b.y - a.y });
      if (piece.length <= 2 || (chord > 0 && piece.every(p => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / chord <= snap))) {
        out.push(straight(a, b));
        continue;
      }
      fitCubic(piece, 0, piece.length - 1, tangent(piece, 0, 1, 2, false), tangent(piece, piece.length - 1, -1, 2, false), o.error, out);
    }
  }
  return { x: first.x, y: first.y, curves: out.map(b => [b[1].x, b[1].y, b[2].x, b[2].y, b[3].x, b[3].y] as Curve) };
}

/** Traces every border between different labels once. `ignore` marks labels
 *  treated as empty (transparent, hidden or background). */
export function traceEdges(labels: Uint8Array, w: number, h: number, ignore: (label: number) => boolean, o: Options): TracedEdge[] {
  const eff = new Int16Array(w * h);
  for (let i = 0; i < w * h; i++) eff[i] = ignore(labels[i]) ? -1 : labels[i];
  const L = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : eff[y * w + x]);
  const W = w + 1;
  // Horizontal cracks run from vertex (x, y) to (x + 1, y); vertical ones from (x, y) to (x, y + 1).
  const hasH = new Uint8Array(w * (h + 1)), hasV = new Uint8Array(W * h);
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (L(x, y - 1) !== L(x, y)) hasH[y * w + x] = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (L(x - 1, y) !== L(x, y)) hasV[y * W + x] = 1;
  const seenH = new Uint8Array(hasH.length), seenV = new Uint8Array(hasV.length);

  // The four ways out of a vertex: 0 east, 1 west, 2 south, 3 north.
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const has = (x: number, y: number, dir: number) =>
    dir === 0 ? x < w && hasH[y * w + x] === 1 : dir === 1 ? x > 0 && hasH[y * w + x - 1] === 1 : dir === 2 ? y < h && hasV[y * W + x] === 1 : y > 0 && hasV[(y - 1) * W + x] === 1;
  const seen = (x: number, y: number, dir: number) =>
    dir === 0 ? seenH[y * w + x] : dir === 1 ? seenH[y * w + x - 1] : dir === 2 ? seenV[y * W + x] : seenV[(y - 1) * W + x];
  const mark = (x: number, y: number, dir: number) => {
    if (dir === 0) seenH[y * w + x] = 1; else if (dir === 1) seenH[y * w + x - 1] = 1; else if (dir === 2) seenV[y * W + x] = 1; else seenV[(y - 1) * W + x] = 1;
  };
  const degree = (x: number, y: number) => +has(x, y, 0) + +has(x, y, 1) + +has(x, y, 2) + +has(x, y, 3);
  // Labels on the left and right of a crack walked out of (x, y) in `dir`.
  const sides = (x: number, y: number, dir: number): [number, number] =>
    dir === 0 ? [L(x, y - 1), L(x, y)] : dir === 1 ? [L(x - 1, y), L(x - 1, y - 1)] : dir === 2 ? [L(x, y), L(x - 1, y)] : [L(x - 1, y - 1), L(x, y - 1)];

  const edges: TracedEdge[] = [];
  const walk = (x0: number, y0: number, dir0: number, cycle: boolean) => {
    const [left, right] = sides(x0, y0, dir0);
    const points: V[] = cycle ? [] : [{ x: x0, y: y0 }];
    let x = x0, y = y0, dir = dir0;
    for (;;) {
      mark(x, y, dir);
      points.push({ x: x + DX[dir] / 2, y: y + DY[dir] / 2 });
      x += DX[dir]; y += DY[dir];
      if (x === x0 && y === y0 && cycle) break;
      if (degree(x, y) !== 2) { points.push({ x, y }); break; }
      let next = -1;
      for (let k = 0; k < 4; k++) if (has(x, y, k) && !seen(x, y, k)) { next = k; break; }
      if (next < 0) { points.push({ x, y }); break; }
      dir = next;
    }
    if (cycle) {
      if (points.length < 3 || Math.abs(polygonArea(points)) < o.minLoop) return;
      edges.push({ ...fitLoop(points, o.error, o.cornerAngle, o.reach), closed: true, left, right, raw: points });
    } else edges.push({ ...fitOpen(points, o), closed: false, left, right, raw: points });
  };
  // Borders between junctions first, then the loops that meet no junction.
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    // Three regions meeting give three cracks, four give four (or two regions
    // touching corner to corner); either way it is a junction.
    if (degree(x, y) < 3) continue;
    for (let dir = 0; dir < 4; dir++) if (has(x, y, dir) && !seen(x, y, dir)) walk(x, y, dir, false);
  }
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (hasH[y * w + x] && !seenH[y * w + x]) walk(x, y, 0, true);
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (hasV[y * W + x] && !seenV[y * W + x]) walk(x, y, 2, true);
  untangle(edges, o);
  return edges;
}

const crossing = (a: V, b: V, c: V, d: V) => {
  const s = (p: V, q: V, r: V) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = s(a, b, c), d2 = s(a, b, d), d3 = s(c, d, a), d4 = s(c, d, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
};

/** Where a region is thinner than the smoothing, the fitted borders on its
 *  two sides can touch or cross. Those borders are fitted again, closer to
 *  their pixels, until nothing crosses (or they follow the pixels exactly). */
function untangle(edges: TracedEdge[], o: Options) {
  // Raw pixel borders never cross each other, so the passes always finish.
  for (let pass = 0; pass < 12; pass++) {
    const cell = 8;
    const grid = new Map<string, number[]>();
    // Flattened finer than the audit that checks the files, so no crossing hides between samples.
    const lines = edges.map(e => { const p = flatten(e, 0.02); if (e.closed || (p.length > 1 && p[0].x === p[p.length - 1].x && p[0].y === p[p.length - 1].y)) p.push(p[0]); return p; });
    lines.forEach((pts, e) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const x0 = Math.floor(Math.min(pts[i].x, pts[i + 1].x) / cell), x1 = Math.floor(Math.max(pts[i].x, pts[i + 1].x) / cell);
        const y0 = Math.floor(Math.min(pts[i].y, pts[i + 1].y) / cell), y1 = Math.floor(Math.max(pts[i].y, pts[i + 1].y) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = `${gx},${gy}`; const list = grid.get(k); if (list) list.push(e, i); else grid.set(k, [e, i]); }
      }
    });
    const bad = new Set<number>();
    for (const list of grid.values()) for (let a = 0; a < list.length; a += 2) for (let b = a + 2; b < list.length; b += 2) {
      const ea = list[a], ia = list[a + 1], eb = list[b], ib = list[b + 1];
      if (ea === eb && Math.abs(ia - ib) <= 1) continue;
      const pa = lines[ea], pb = lines[eb];
      if (crossing(pa[ia], pa[ia + 1], pb[ib], pb[ib + 1])) { bad.add(ea); bad.add(eb); }
    }
    if (!bad.size) return;
    for (const i of bad) {
      const e = edges[i];
      if (pass < 2) {
        const tight = { ...o, error: o.error * (pass ? 0.12 : 0.35), reach: 0 };
        edges[i] = { ...e, ...(e.closed ? fitLoop(e.raw, tight.error, tight.cornerAngle, 0) : fitOpen(e.raw, tight)) };
        continue;
      }
      // Last resort: the pixel border itself, which cannot cross another.
      const pts = e.closed ? [...e.raw.slice(1), e.raw[0]] : e.raw.slice(1);
      let from = e.raw[0];
      const curves = pts.map(p => { const c: Curve = [from.x + (p.x - from.x) / 3, from.y + (p.y - from.y) / 3, from.x + (2 * (p.x - from.x)) / 3, from.y + (2 * (p.y - from.y)) / 3, p.x, p.y]; from = p; return c; });
      edges[i] = { ...e, x: e.raw[0].x, y: e.raw[0].y, curves };
    }
  }
}

const endOf = (p: VectorPath): V => (p.curves.length ? { x: p.curves[p.curves.length - 1][4], y: p.curves[p.curves.length - 1][5] } : { x: p.x, y: p.y });

/** The same path walked the other way. */
export function reversePath(p: VectorPath): VectorPath {
  const points: V[] = [{ x: p.x, y: p.y }, ...p.curves.map(c => ({ x: c[4], y: c[5] }))];
  const curves: Curve[] = [];
  for (let i = p.curves.length - 1; i >= 0; i--) {
    const c = p.curves[i];
    curves.push([c[2], c[3], c[0], c[1], points[i].x, points[i].y]);
  }
  const end = points[points.length - 1];
  return { x: end.x, y: end.y, curves };
}

/** Every closed outline of one label, made from the borders it touches,
 *  each turned so the label lies on its left. */
export function regionLoops(edges: TracedEdge[], label: number): VectorPath[] {
  const loops: VectorPath[] = [];
  const open: VectorPath[] = [];
  for (const e of edges) {
    if (e.left !== label && e.right !== label) continue;
    // Copies, so rescaling the layers later cannot touch the shared borders.
    const path: VectorPath = e.left === label ? { x: e.x, y: e.y, curves: e.curves.map(c => [...c] as Curve) } : reversePath(e);
    (e.closed ? loops : open).push(path);
  }
  const key = (p: V) => `${p.x},${p.y}`;
  const starts = new Map<string, number[]>();
  open.forEach((p, i) => { const k = key(p); starts.set(k, [...(starts.get(k) ?? []), i]); });
  const used = new Uint8Array(open.length);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const start = key(open[i]);
    const curves = [...open[i].curves];
    let end = endOf(open[i]), guard = open.length;
    while (key(end) !== start && guard--) {
      const next = (starts.get(key(end)) ?? []).find(j => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      curves.push(...open[next].curves);
      end = endOf(open[next]);
    }
    if (key(end) === start && curves.length) loops.push({ x: open[i].x, y: open[i].y, curves });
  }
  return loops;
}
