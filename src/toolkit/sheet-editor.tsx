'use client';
import { useMemo, useRef, useState } from 'react';
import type { Shape } from './types';
import { bounds, moveShape, normalize, shapesCollide } from './geometry';
import { pathData } from './export';
import { tx, type Language } from './copy';

/* Moving nested parts by hand: drag a part, nudge it with the arrow keys
   (Shift for 10 mm), turn it a quarter with R. A part closer than the
   spacing to another, or past the margin, turns red; nothing stops the move,
   so a part can pass through a crowded spot on its way somewhere free. */

type Props = { lang: Language; parts: Shape[]; width: number; height: number; margin: number; gap: number; onChange: (parts: Shape[]) => void };

/** Which parts are too close to another part or past the margin. */
export function clashes(parts: Shape[], width: number, height: number, margin: number, gap: number): Set<number> {
  const boxes = parts.map(bounds), bad = new Set<number>();
  boxes.forEach((b, i) => { if (b.x < margin - 1e-6 || b.y < margin - 1e-6 || b.x + b.width > width - margin + 1e-6 || b.y + b.height > height - margin + 1e-6) bad.add(i); });
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x > b.x + b.width + gap || b.x > a.x + a.width + gap || a.y > b.y + b.height + gap || b.y > a.y + a.height + gap) continue;
    // A hair under the spacing is the arranger's own rounding, not a clash.
    if (shapesCollide(parts[i], parts[j], Math.max(0, gap - 0.05))) { bad.add(i); bad.add(j); }
  }
  return bad;
}

/** The part turned a quarter clockwise about the centre of its bounds. */
export function quarterTurn(part: Shape): Shape {
  const b = bounds(part), turned = normalize(part, 90), t = bounds(turned);
  return { ...moveShape(turned, b.x + b.width / 2 - t.width / 2, b.y + b.height / 2 - t.height / 2), id: part.id, name: part.name };
}

export function SheetEditor({ lang, parts, width, height, margin, gap, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState(-1);
  const [drag, setDrag] = useState<{ index: number; from: { x: number; y: number }; dx: number; dy: number } | null>(null);
  const shown = useMemo(() => drag ? parts.map((p, i) => (i === drag.index ? moveShape(p, drag.dx, drag.dy) : p)) : parts, [parts, drag]);
  const bad = useMemo(() => clashes(shown, width, height, margin, gap), [shown, width, height, margin, gap]);
  const toSheet = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const replace = (index: number, part: Shape) => onChange(parts.map((p, i) => (i === index ? part : p)));
  const nudge = (dx: number, dy: number) => { if (selected >= 0) replace(selected, moveShape(parts[selected], dx, dy)); };
  const turn = () => { if (selected >= 0) replace(selected, quarterTurn(parts[selected])); };
  return <div className="sheet-editor">
    <div className="sheet-editor-tools">
      <button type="button" className="button secondary" disabled={selected < 0} onClick={turn}>{tx(lang, 'Turn 90° (R)', 'تدوير ٩٠° (R)')}</button>
      <span className="micro">{bad.size ? tx(lang, `${bad.size} parts too close or past the margin (red).`, `قطع قريبة جداً أو خارج الهامش (بالأحمر): ${bad.size}.`) : tx(lang, 'Drag a part, or select it and use the arrow keys (Shift for 10 mm).', 'اسحب قطعة، أو اخترها واستخدم الأسهم (مع Shift لـ ١٠ مم).')}</span>
    </div>
    <svg ref={svg} className="vector-paper sheet-editor-paper" viewBox={`0 0 ${width} ${height}`} style={{ aspectRatio: `${width}/${height}` }} tabIndex={0} role="application" aria-label={tx(lang, 'Sheet layout: move parts by hand', 'ترتيب اللوح: حرّك القطع يدوياً')}
      onKeyDown={e => {
        const step = e.shiftKey ? 10 : 1, keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (keys[e.key]) { e.preventDefault(); nudge(...keys[e.key]); } else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); turn(); }
      }}
      onPointerMove={e => { if (!drag) return; const p = toSheet(e); setDrag({ ...drag, dx: p.x - drag.from.x, dy: p.y - drag.from.y }); }}
      onPointerUp={() => { if (drag) { if (drag.dx || drag.dy) replace(drag.index, moveShape(parts[drag.index], drag.dx, drag.dy)); setDrag(null); } }}
      onPointerCancel={() => setDrag(null)}>
      <rect width={width} height={height} fill="#fffcf5" />
      <rect x={margin} y={margin} width={width - 2 * margin} height={height - 2 * margin} fill="none" stroke="#b9b2a4" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {shown.map((part, i) => <path key={part.id} d={pathData(part)} fillRule="evenodd" className={`sheet-part${i === selected ? ' selected' : ''}${bad.has(i) ? ' clash' : ''}`} vectorEffect="non-scaling-stroke"
        onPointerDown={e => { e.stopPropagation(); e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId); setSelected(i); setDrag({ index: i, from: toSheet(e), dx: 0, dy: 0 }); svg.current?.focus(); }} />)}
    </svg>
  </div>;
}
