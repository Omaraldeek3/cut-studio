/* Starting feeds and speeds for a CNC router. A cutter works when each tooth
   takes a chip of the right thickness (the chip load): too thin and it rubs
   and burns, too thick and it chips or breaks. So the feed follows from the
   spindle speed, the number of flutes and the chip load:
     feed (mm/min) = rpm × flutes × chip load (mm per tooth).
   Chip loads below are the mid-range of common router-bit maker charts, for
   3, 6 and 12 mm bits, interpolated between. They are starting points: listen
   to the cut and look at the chips. */

export type FeedMaterial = 'softwood' | 'hardwood' | 'mdf' | 'plywood' | 'acrylic' | 'hdpe' | 'aluminium';
export type Rigidity = 'light' | 'medium' | 'heavy';

type Row = { chip: [number, number, number]; rpm: number; depth: number; plunge: number };
/** Chip load (mm per tooth) at 3, 6 and 12 mm; preferred rpm; depth per pass as a share of the diameter; plunge as a share of the feed. */
export const MATERIALS: Record<FeedMaterial, Row> = {
  softwood: { chip: [0.125, 0.29, 0.45], rpm: 18000, depth: 1, plunge: 1 / 3 },
  hardwood: { chip: [0.105, 0.24, 0.4], rpm: 18000, depth: 0.75, plunge: 1 / 3 },
  mdf: { chip: [0.125, 0.33, 0.5], rpm: 18000, depth: 1, plunge: 1 / 3 },
  plywood: { chip: [0.105, 0.29, 0.45], rpm: 18000, depth: 0.75, plunge: 1 / 3 },
  acrylic: { chip: [0.065, 0.165, 0.29], rpm: 16000, depth: 0.5, plunge: 1 / 4 },
  hdpe: { chip: [0.115, 0.25, 0.4], rpm: 16000, depth: 0.75, plunge: 1 / 3 },
  aluminium: { chip: [0.032, 0.065, 0.115], rpm: 14000, depth: 0.2, plunge: 1 / 4 },
};
const RIGIDITY: Record<Rigidity, number> = { light: 0.5, medium: 0.75, heavy: 1 };

export type FeedOptions = {
  material: FeedMaterial; diameter: number; flutes: number;
  minRpm: number; maxRpm: number; maxFeed: number; rigidity: Rigidity;
  /** Chip load to use instead of the chart's, mm per tooth (NaN for the chart's). */
  chipLoad?: number;
};
export const defaultFeeds: FeedOptions = { material: 'plywood', diameter: 6, flutes: 2, minRpm: 8000, maxRpm: 24000, maxFeed: 5000, rigidity: 'light' };

export type FeedResult = {
  rpm: number; feed: number; plunge: number; chipLoad: number; chartChipLoad: number;
  depth: number; roughStepover: number; finishStepover: number;
  /** Why the result is not the material's ideal, if it is not. */
  notes: ('feed-limited' | 'below-min-rpm' | 'chip-overridden')[];
};

function check(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
}

/** The chart chip load at any diameter: linear between 3, 6 and 12 mm, in proportion beyond. */
export function chartChipLoad(material: FeedMaterial, diameter: number): number {
  const [a, b, c] = MATERIALS[material].chip;
  if (diameter <= 3) return (a * diameter) / 3;
  if (diameter <= 6) return a + ((b - a) * (diameter - 3)) / 3;
  if (diameter <= 12) return b + ((c - b) * (diameter - 6)) / 6;
  return (c * diameter) / 12;
}

export function feedsAndSpeeds(o: FeedOptions): FeedResult {
  check(o.diameter, 0.5, 25, 'Bit diameter'); check(o.flutes, 1, 6, 'Flutes');
  check(o.minRpm, 1000, 60000, 'Lowest spindle speed'); check(o.maxRpm, o.minRpm, 60000, 'Highest spindle speed');
  check(o.maxFeed, 100, 50000, 'Highest feed rate');
  if (!Number.isInteger(o.flutes)) throw new Error('Flutes must be a whole number.');
  const row = MATERIALS[o.material], chart = chartChipLoad(o.material, o.diameter);
  const overridden = o.chipLoad !== undefined && Number.isFinite(o.chipLoad);
  if (overridden) check(o.chipLoad!, 0.005, 1, 'Chip load');
  const chip = overridden ? o.chipLoad! : chart;
  const notes: FeedResult['notes'] = overridden ? ['chip-overridden'] : [];
  let rpm = Math.min(o.maxRpm, Math.max(o.minRpm, row.rpm));
  let feed = rpm * o.flutes * chip;
  // A feed the machine cannot reach is met by slowing the spindle, keeping the chip: never by thinning it.
  if (feed > o.maxFeed) {
    notes.push('feed-limited');
    rpm = o.maxFeed / (o.flutes * chip);
    if (rpm < o.minRpm) { notes.push('below-min-rpm'); rpm = o.minRpm; }
    feed = Math.min(o.maxFeed, rpm * o.flutes * chip);
  }
  const chipLoad = feed / (rpm * o.flutes);
  return {
    rpm: Math.round(rpm), feed: Math.round(feed), plunge: Math.round(feed * row.plunge), chipLoad, chartChipLoad: chart,
    depth: +(o.diameter * row.depth * RIGIDITY[o.rigidity]).toFixed(2),
    roughStepover: +(o.diameter * 0.4).toFixed(2), finishStepover: +(o.diameter * 0.1).toFixed(2), notes,
  };
}
