import type { Contour, Drawing, Point, Shape } from './types';
import { circle, roundedRect } from './generators';
import { bounds, moveShape } from './geometry';
import { buildBox, defaultBoxOptions, type BoxOptions } from './box';

/* Ready-made workshop products, each from flat sheet and a few settings.
   Parts join with tabs through slots: a slot is the material thickness plus
   the clearance wide, so a tab slides in snug. Engraved lines (blue) mark
   where a QR sticker or text goes. Sizes in mm. */

export type TemplateId = 'qr' | 'menu' | 'door' | 'easel' | 'phone' | 'card' | 'napkin' | 'marker' | 'gift' | 'organizer';
export type Field = { key: string; en: string; ar: string; min: number; max: number; step?: number; unit?: string };
export type Template = { id: TemplateId; en: string; ar: string; noteEn: string; noteAr: string; fields: Field[]; defaults: Record<string, number>; build: (v: Record<string, number>) => Drawing };

const closed = (points: Point[], layer?: 'engrave'): Contour => (layer ? { closed: true, points, layer } : { closed: true, points });
const rect = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const part = (id: string, name: string, contours: Contour[]): Shape => ({ id, name, contours });

function check(v: Record<string, number>, fields: Field[]) {
  for (const f of fields) { const x = v[f.key]; if (!Number.isFinite(x) || x < f.min || x > f.max) throw new Error(`${f.en} must be between ${f.min} and ${f.max}.`); }
}
/** The parts side by side, 6 mm apart, in a drawing just big enough. */
function layout(parts: Shape[]): Drawing {
  let x = 0, height = 0;
  const shapes = parts.map(p => { const b = bounds(p), out = moveShape(p, x - b.x, -b.y); x += b.width + 6; height = Math.max(height, b.height); return out; });
  return { width: Math.max(1, x - 6), height, shapes };
}
/** A w × h panel whose bottom edge has tabs `depth` deep, each `len` long, centred at `xs`. */
function tabbedPanel(w: number, h: number, xs: number[], len: number, depth: number): Point[] {
  const out: Point[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }];
  for (const x of [...xs].sort((a, b) => b - a)) out.push({ x: x + len / 2, y: h }, { x: x + len / 2, y: h + depth }, { x: x - len / 2, y: h + depth }, { x: x - len / 2, y: h });
  out.push({ x: 0, y: h });
  return out;
}

/** Two side profiles joined by two bars: the item rests on a ledge and leans back at `angle`. */
function leanStand(v: Record<string, number>): Drawing {
  const { width: w, height: H, item, thickness: t, clearance: c } = v, tan = Math.tan((v.angle * Math.PI) / 180);
  const base = 16, lipW = 6, lipH = 8, ledge = item + 2, front = lipW + ledge, topFront = front + (H - base) / tan, topBack = topFront + 10, L = topBack + 20;
  // The side profile, drawn y-up and then flipped: base, back, top, lean edge, ledge, lip.
  const up = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: base }, { x: topBack, y: H }, { x: topFront, y: H }, { x: front, y: base }, { x: lipW, y: base }, { x: lipW, y: base + lipH }, { x: 0, y: base + lipH }];
  const flip = (p: Point) => ({ x: p.x, y: H - p.y });
  const barH = 12, tabH = barH * 0.6, slotW = t + c, slotH = tabH + c;
  // Bars through the base near the back, and higher up behind the lean edge.
  const y2 = H * 0.45, x2 = (front + (y2 - base) / tan + (L + (topBack - L) * ((y2 - base) / (H - base)))) / 2;
  const slots = [{ x: L - 14, y: base / 2 }, { x: x2, y: y2 }].map(s => closed(rect(s.x - slotW / 2, H - s.y - slotH / 2, slotW, slotH)));
  const side = (i: number) => part(`side-${i}`, `Side ${i}`, [closed(up.map(flip)), ...slots]);
  const tab = t + 1;
  const bar = (i: number) => part(`bar-${i}`, `Bar ${i}`, [closed([{ x: 0, y: (barH - tabH) / 2 }, { x: tab, y: (barH - tabH) / 2 }, { x: tab, y: 0 }, { x: tab + w, y: 0 }, { x: tab + w, y: (barH - tabH) / 2 }, { x: 2 * tab + w, y: (barH - tabH) / 2 }, { x: 2 * tab + w, y: (barH + tabH) / 2 }, { x: tab + w, y: (barH + tabH) / 2 }, { x: tab + w, y: barH }, { x: tab, y: barH }, { x: tab, y: (barH + tabH) / 2 }, { x: 0, y: (barH + tabH) / 2 }])]);
  return layout([side(1), side(2), bar(1), bar(2)]);
}

/** A box from the box maker, as a product: no part labels, fingers to suit the material. */
function box(o: Partial<BoxOptions>): ReturnType<typeof buildBox> {
  const t = o.thickness ?? 3;
  return buildBox({ ...defaultBoxOptions, sizing: 'outside', labels: false, finger: Math.max(8, 3 * t), spacing: 6, ...o });
}
const whole = (x: number, name: string) => { if (!Number.isInteger(x)) throw new Error(`${name}: use a whole number.`); return x; };

const T: Field = { key: 'thickness', en: 'Material thickness', ar: 'سماكة الخامة', min: 1, max: 12, step: 0.5, unit: 'mm' };
const C: Field = { key: 'clearance', en: 'Clearance', ar: 'الخلوص', min: 0, max: 1, step: 0.05, unit: 'mm' };

export const TEMPLATES: Template[] = [
  {
    id: 'qr', en: 'QR code stand', ar: 'حامل رمز QR',
    noteEn: 'Slide the leg into the plate\'s slot: they cross and stand. Stick the QR code in the engraved square.', noteAr: 'أدخل الساق في مجرى اللوح فيتقاطعان ويقفان. ألصق رمز QR داخل المربع المحفور.',
    fields: [{ key: 'width', en: 'Width', ar: 'العرض', min: 50, max: 400, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 60, max: 500, unit: 'mm' }, { key: 'qr', en: 'QR size', ar: 'مقاس QR', min: 20, max: 300, unit: 'mm' }, T, C],
    defaults: { width: 100, height: 150, qr: 70, thickness: 3, clearance: 0.2 },
    build: v => {
      const { width: w, height: h, qr: q, thickness: t, clearance: c } = v;
      if (q > w - 10 || q > h * 0.6) throw new Error('The QR square does not fit the plate. Make it smaller or the plate larger.');
      const s = t + c, a = h / 4, leg = h / 2, depth = Math.max(40, h * 0.45);
      // The plate's slot runs up from its bottom; the leg's runs down from its top; together they span the leg.
      const plate = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: w / 2 + s / 2, y: h }, { x: w / 2 + s / 2, y: h - a }, { x: w / 2 - s / 2, y: h - a }, { x: w / 2 - s / 2, y: h }, { x: 0, y: h }];
      const stand = [{ x: 0, y: 0 }, { x: depth / 2 - s / 2, y: 0 }, { x: depth / 2 - s / 2, y: leg - a }, { x: depth / 2 + s / 2, y: leg - a }, { x: depth / 2 + s / 2, y: 0 }, { x: depth, y: 0 }, { x: depth, y: leg }, { x: 0, y: leg }];
      return layout([part('plate', 'Plate', [closed(plate), closed(rect((w - q) / 2, 10, q, q), 'engrave')]), part('leg', 'Leg', [closed(stand)])]);
    },
  },
  {
    id: 'menu', en: 'Menu holder', ar: 'حامل منيو',
    noteEn: 'Glue the slotted layer on the solid one; the menu card stands in the slot. The card outline is for cutting it from acrylic.', noteAr: 'الصق الطبقة ذات المجرى فوق الطبقة المصمتة، وتقف ورقة المنيو في المجرى. حدود الورقة لقصها من الأكريليك.',
    fields: [{ key: 'cardWidth', en: 'Card width', ar: 'عرض الورقة', min: 50, max: 420, unit: 'mm' }, { key: 'cardHeight', en: 'Card height', ar: 'ارتفاع الورقة', min: 50, max: 600, unit: 'mm' }, { key: 'cardThickness', en: 'Card thickness', ar: 'سماكة الورقة', min: 0.5, max: 10, step: 0.5, unit: 'mm' }, { key: 'depth', en: 'Base depth', ar: 'عمق القاعدة', min: 30, max: 200, unit: 'mm' }, T, C],
    defaults: { cardWidth: 148, cardHeight: 210, cardThickness: 3, depth: 50, thickness: 6, clearance: 0.2 },
    build: v => {
      const w = v.cardWidth + 30, d = v.depth, slotL = v.cardWidth + v.clearance, slotW = v.cardThickness + v.clearance;
      return layout([
        part('top', 'Slotted layer', [closed(roundedRect(0, 0, w, d, 5)), closed(rect((w - slotL) / 2, d / 2 - slotW / 2, slotL, slotW))]),
        part('bottom', 'Solid layer', [closed(roundedRect(0, 0, w, d, 5))]),
        part('card', 'Menu card', [closed(roundedRect(0, 0, v.cardWidth, v.cardHeight, 4))]),
      ]);
    },
  },
  {
    id: 'door', en: 'Door sign', ar: 'لوحة باب',
    noteEn: 'Write the name in Arabic lettering and engrave it inside the border. Screw the spacers behind the holes for a floating sign.', noteAr: 'اكتب الاسم بأداة الكتابة العربية واحفره داخل الإطار. ضع الحلقات خلف الثقوب لتبدو اللوحة معلّقة بعيداً عن الباب.',
    fields: [{ key: 'width', en: 'Width', ar: 'العرض', min: 60, max: 800, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 30, max: 500, unit: 'mm' }, { key: 'radius', en: 'Corner radius', ar: 'نصف قطر الزوايا', min: 0, max: 100, unit: 'mm' }, { key: 'holes', en: 'Screw holes (0, 2 or 4)', ar: 'ثقوب المسامير (0 أو 2 أو 4)', min: 0, max: 4 }, { key: 'spacers', en: 'Spacers', ar: 'حلقات تبعيد', min: 0, max: 4 }],
    defaults: { width: 200, height: 80, radius: 8, holes: 2, spacers: 2 },
    build: v => {
      const { width: w, height: h } = v;
      if (![0, 2, 4].includes(v.holes)) throw new Error('A sign takes 0, 2 or 4 screw holes.');
      const m = Math.min(10, h / 5), holes = v.holes === 2 ? [[m, h / 2], [w - m, h / 2]] : v.holes === 4 ? [[m, m], [w - m, m], [m, h - m], [w - m, h - m]] : [];
      const inset = v.holes ? 2 * m : 6;
      const parts = [part('sign', 'Sign', [closed(roundedRect(0, 0, w, h, v.radius)), ...holes.map(([x, y]) => closed(circle(x, y, 2))), closed(roundedRect(inset, 6, w - 2 * inset, h - 12, Math.max(0, v.radius - 4)), 'engrave')])];
      for (let i = 0; i < Math.round(v.spacers); i++) parts.push(part(`spacer-${i + 1}`, `Spacer ${i + 1}`, [closed(circle(7, 7, 7)), closed(circle(7, 7, 2))]));
      return layout(parts);
    },
  },
  {
    id: 'easel', en: 'Display easel', ar: 'ستاند عرض',
    noteEn: 'Push the two bars through the slots of both sides. The item rests on the ledge and leans back at the angle you set.', noteAr: 'أدخل العارضتين في فتحات الجانبين. تستند القطعة على الحافة وتميل للخلف بالزاوية المحددة.',
    fields: [{ key: 'width', en: 'Width between sides', ar: 'العرض بين الجانبين', min: 40, max: 600, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 60, max: 400, unit: 'mm' }, { key: 'angle', en: 'Lean angle', ar: 'زاوية الميل', min: 55, max: 85, unit: '°' }, { key: 'item', en: 'Item thickness', ar: 'سماكة القطعة المعروضة', min: 1, max: 30, step: 0.5, unit: 'mm' }, T, C],
    defaults: { width: 120, height: 120, angle: 70, item: 4, thickness: 3, clearance: 0.2 },
    build: leanStand,
  },
  {
    id: 'phone', en: 'Phone stand', ar: 'حامل جوال',
    noteEn: 'Push the two bars through the slots of both sides. The phone rests on the two ledges; the charging cable passes up between the sides.', noteAr: 'أدخل العارضتين في فتحات الجانبين. يستند الجوال على الحافتين، ويمر سلك الشحن بين الجانبين.',
    fields: [{ key: 'width', en: 'Width between sides', ar: 'العرض بين الجانبين', min: 30, max: 200, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 60, max: 250, unit: 'mm' }, { key: 'angle', en: 'Lean angle', ar: 'زاوية الميل', min: 55, max: 85, unit: '°' }, { key: 'item', en: 'Phone thickness with case', ar: 'سماكة الجوال مع الغطاء', min: 5, max: 30, step: 0.5, unit: 'mm' }, T, C],
    defaults: { width: 50, height: 100, angle: 65, item: 12, thickness: 3, clearance: 0.2 },
    build: leanStand,
  },
  {
    id: 'card', en: 'Business card holder', ar: 'حامل بطاقات عمل',
    noteEn: 'Push the back and the front lip into the base\'s slots. Holds standard 90 × 55 mm cards.', noteAr: 'أدخل الظهر والحافة الأمامية في فتحات القاعدة. يتسع لبطاقات ٩٠ × ٥٥ مم.',
    fields: [{ key: 'width', en: 'Width', ar: 'العرض', min: 60, max: 300, unit: 'mm' }, { key: 'stack', en: 'Stack depth', ar: 'سماكة رزمة البطاقات', min: 5, max: 60, unit: 'mm' }, T, C],
    defaults: { width: 100, stack: 20, thickness: 3, clearance: 0.2 },
    build: v => {
      const { width: w, stack, thickness: t, clearance: c } = v, d = stack + 2 * t + 16, tab = w / 4, xs = [w / 4, (3 * w) / 4];
      const slots = (y: number) => xs.map(x => closed(rect(x - (tab + c) / 2, y - (t + c) / 2, tab + c, t + c)));
      return layout([
        part('base', 'Base', [closed(roundedRect(0, 0, w, d, 4)), ...slots(8 + t / 2), ...slots(8 + t + stack + t / 2)]),
        part('back', 'Back', [closed(tabbedPanel(w, 45, xs, tab, t))]),
        part('lip', 'Front lip', [closed(tabbedPanel(w, 15, xs, tab, t))]),
      ]);
    },
  },
  {
    id: 'napkin', en: 'Napkin holder', ar: 'حامل مناديل',
    noteEn: 'Push both sides into the base\'s slots. The round cut-outs show the napkins and save material.', noteAr: 'أدخل الجانبين في فتحات القاعدة. الفتحات الدائرية تُظهر المناديل وتوفّر الخامة.',
    fields: [{ key: 'width', en: 'Napkin size', ar: 'مقاس المناديل', min: 80, max: 250, unit: 'mm' }, { key: 'gap', en: 'Gap between sides', ar: 'المسافة بين الجانبين', min: 15, max: 120, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 50, max: 250, unit: 'mm' }, T, C],
    defaults: { width: 170, gap: 40, height: 110, thickness: 3, clearance: 0.2 },
    build: v => {
      const { width: w, gap, height: h, thickness: t, clearance: c } = v, side = w + 10, tab = side / 4, xs = [side / 4, (3 * side) / 4], d = gap + 2 * t + 16;
      const slot = (x: number, y: number) => closed(rect(y - (t + c) / 2, x - (tab + c) / 2, t + c, tab + c));
      const panel = tabbedPanel(side, h, xs, tab, t);
      const window = closed(circle(side / 2, h * 0.45, Math.min(side, h) * 0.25));
      return layout([
        part('base', 'Base', [closed(roundedRect(0, 0, d, side, 4)), ...xs.flatMap(x => [slot(x, 8 + t / 2), slot(x, d - 8 - t / 2)])]),
        part('side-1', 'Side 1', [closed(panel), window]),
        part('side-2', 'Side 2', [closed(panel), { ...window, points: [...window.points] }]),
      ]);
    },
  },
  {
    id: 'marker', en: 'Plant markers', ar: 'شواخص النباتات',
    noteEn: 'Engrave each name in the label area (Arabic lettering, then Arrange on sheet), then push the stakes into the soil.', noteAr: 'احفر اسم كل نبتة في مساحة الاسم (بأداة الكتابة العربية ثم الترتيب على اللوح)، ثم اغرس الأعواد في التربة.',
    fields: [{ key: 'count', en: 'How many', ar: 'العدد', min: 1, max: 50 }, { key: 'width', en: 'Label width', ar: 'عرض مساحة الاسم', min: 30, max: 200, unit: 'mm' }, { key: 'length', en: 'Stake length', ar: 'طول العود', min: 30, max: 300, unit: 'mm' }],
    defaults: { count: 6, width: 70, length: 90 },
    build: v => {
      const { width: w, length: l } = v, lh = Math.max(20, w * 0.35), sw = Math.min(12, w / 4);
      const outline = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: lh }, { x: w / 2 + sw / 2, y: lh }, { x: w / 2 + sw / 2, y: lh + l - sw }, { x: w / 2, y: lh + l }, { x: w / 2 - sw / 2, y: lh + l - sw }, { x: w / 2 - sw / 2, y: lh }, { x: 0, y: lh }];
      return layout(Array.from({ length: Math.round(v.count) }, (_, i) => part(`marker-${i + 1}`, `Marker ${i + 1}`, [closed(outline), closed(roundedRect(4, 4, w - 8, lh - 8, 2), 'engrave')])));
    },
  },
  {
    id: 'gift', en: 'Gift box, sliding lid', ar: 'علبة هدايا بغطاء منزلق',
    noteEn: 'The lid slides in through the low front wall; push it with the thumb hole. Engrave a name or logo in the blue area on the lid.', noteAr: 'يدخل الغطاء من الجدار الأمامي المنخفض، ويُدفع من فتحة الإبهام. احفر اسماً أو شعاراً في المساحة الزرقاء على الغطاء.',
    fields: [{ key: 'width', en: 'Width', ar: 'العرض', min: 40, max: 600, unit: 'mm' }, { key: 'depth', en: 'Depth', ar: 'العمق', min: 40, max: 600, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 25, max: 400, unit: 'mm' }, T, C],
    defaults: { width: 160, depth: 110, height: 70, thickness: 3, clearance: 0.3 },
    build: v => {
      const r = box({ type: 'sliding', width: v.width, depth: v.depth, height: v.height, thickness: v.thickness, clearance: v.clearance });
      const i = r.parts.findIndex(p => p.name === 'Lid'), lid = r.drawing.shapes[i];
      // The name area fills the lid on the larger side of the thumb hole, 8 mm in from its edges.
      const b = bounds(lid), pull = lid.contours.length > 1 ? bounds({ ...lid, contours: lid.contours.slice(1) }) : null;
      const after = !pull || b.y + b.height - (pull.y + pull.height) > pull.y - b.y;
      const top = pull && after ? pull.y + pull.height + 6 : b.y + 8, bottom = pull && !after ? pull.y - 6 : b.y + b.height - 8;
      if (bottom - top < 10) return r.drawing;
      const area = closed(roundedRect(b.x + 8, top, b.width - 16, bottom - top, 3), 'engrave');
      return { ...r.drawing, shapes: r.drawing.shapes.map((s, k) => (k === i ? { ...s, contours: [...s.contours, area] } : s)) };
    },
  },
  {
    id: 'organizer', en: 'Desk organizer', ar: 'منظم مكتب',
    noteEn: 'An open tray split into compartments: the dividers slot into each other and lock into the walls. Set both to 1 for one open space.', noteAr: 'صينية مفتوحة مقسمة إلى خانات: تتداخل الفواصل مع بعضها وتُثبّت في الجدران. اجعل الاثنين 1 لمساحة واحدة مفتوحة.',
    fields: [{ key: 'width', en: 'Width', ar: 'العرض', min: 60, max: 600, unit: 'mm' }, { key: 'depth', en: 'Depth', ar: 'العمق', min: 40, max: 400, unit: 'mm' }, { key: 'height', en: 'Height', ar: 'الارتفاع', min: 20, max: 250, unit: 'mm' }, { key: 'across', en: 'Compartments across', ar: 'الخانات بالعرض', min: 1, max: 10 }, { key: 'back', en: 'Compartments front to back', ar: 'الخانات من الأمام للخلف', min: 1, max: 6 }, T],
    defaults: { width: 240, depth: 120, height: 80, across: 4, back: 2, thickness: 3 },
    build: v => box({ type: 'open', width: v.width, depth: v.depth, height: v.height, thickness: v.thickness, columns: whole(v.across, 'Compartments across') - 1, rows: whole(v.back, 'Compartments front to back') - 1 }).drawing,
  },
];

export function buildTemplate(id: TemplateId, values: Record<string, number>): Drawing {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) throw new Error('Unknown template.');
  check(values, t.fields);
  return t.build(values);
}
