/* Print-sheet imposition: as many copies of one design as fit on a sheet,
   for stickers, labels and sublimation transfers. Arithmetic only, in mm. */

export type SheetSize = { id: string; en: string; ar: string; width: number; height: number };

export const sheets: SheetSize[] = [
  { id: 'a4', en: 'A4', ar: 'A4', width: 210, height: 297 },
  { id: 'a3', en: 'A3', ar: 'A3', width: 297, height: 420 },
  { id: 'a3plus', en: 'A3+ / SRA3', ar: 'A3+ / SRA3', width: 320, height: 450 },
  { id: 'letter', en: 'Letter', ar: 'Letter', width: 215.9, height: 279.4 },
  { id: 'roll60', en: 'Sticker roll 60 × 100 cm', ar: 'رول ستيكر ٦٠ × ١٠٠ سم', width: 600, height: 1000 },
];

/** Common items, so a mug or a label is one click. Sizes in mm. */
export const items = [
  { id: 'mug11', en: 'Mug 11 oz wrap', ar: 'التفاف كوب ١١ أونصة', width: 200, height: 95 },
  { id: 'mug15', en: 'Mug 15 oz wrap', ar: 'التفاف كوب ١٥ أونصة', width: 216, height: 108 },
  { id: 'shirt', en: 'T-shirt chest print', ar: 'طباعة صدر تيشيرت', width: 250, height: 300 },
  { id: 'label50', en: 'Round label 50 mm', ar: 'ملصق دائري ٥٠ مم', width: 50, height: 50 },
  { id: 'card', en: 'Business card', ar: 'بطاقة عمل', width: 90, height: 50 },
];

export type ImpositionOptions = {
  sheetWidth: number;
  sheetHeight: number;
  itemWidth: number;
  itemHeight: number;
  margin: number;
  gap: number;
  /** Extra image beyond the cut on every side, in mm. */
  bleed: number;
  /** Also try the item turned a quarter, and keep whichever fits more. */
  rotate: boolean;
};

export type Placement = { x: number; y: number; width: number; height: number; rotated: boolean };
export type Imposition = { placements: Placement[]; columns: number; rows: number; rotated: boolean; used: number };

function grid(o: ImpositionOptions, w: number, h: number, rotated: boolean): Imposition {
  const cellW = w + 2 * o.bleed, cellH = h + 2 * o.bleed;
  const availW = o.sheetWidth - 2 * o.margin, availH = o.sheetHeight - 2 * o.margin;
  const columns = cellW > availW ? 0 : Math.floor((availW + o.gap) / (cellW + o.gap));
  const rows = cellH > availH ? 0 : Math.floor((availH + o.gap) / (cellH + o.gap));
  // The block is centred on the sheet, so the margins come out even.
  const blockW = columns * cellW + Math.max(0, columns - 1) * o.gap, blockH = rows * cellH + Math.max(0, rows - 1) * o.gap;
  const x0 = (o.sheetWidth - blockW) / 2 + o.bleed, y0 = (o.sheetHeight - blockH) / 2 + o.bleed;
  const placements: Placement[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    placements.push({ x: x0 + c * (cellW + o.gap), y: y0 + r * (cellH + o.gap), width: w, height: h, rotated });
  }
  return { placements, columns, rows, rotated, used: (placements.length * w * h) / (o.sheetWidth * o.sheetHeight) };
}

export function impose(o: ImpositionOptions): Imposition {
  for (const [value, name] of [[o.sheetWidth, 'Sheet width'], [o.sheetHeight, 'Sheet height'], [o.itemWidth, 'Item width'], [o.itemHeight, 'Item height']] as const) {
    if (!(value > 0) || value > 100000) throw new Error(`${name} must be above zero.`);
  }
  if (o.margin < 0 || o.gap < 0 || o.bleed < 0) throw new Error('Margins, gaps and bleed cannot be negative.');
  const straight = grid(o, o.itemWidth, o.itemHeight, false);
  if (!o.rotate) return straight;
  const turned = grid(o, o.itemHeight, o.itemWidth, true);
  return turned.placements.length > straight.placements.length ? turned : straight;
}
