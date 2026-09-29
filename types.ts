import type { Curve } from './path';
export type Point = { x: number; y: number };
/** layer 'engrave' marks marking strokes (labels); everything else is cut.
 *  curve, when present, is the exact outline; points is its 0.05 mm flattening. */
export type Contour = { points: Point[]; closed: boolean; layer?: 'engrave'; curve?: Curve };
export type Shape = { id: string; name: string; contours: Contour[] };
/** skippedText counts live text objects left out because they are not cutting outlines. */
export type Drawing = { width: number; height: number; shapes: Shape[]; skippedText?: number };
export type Bounds = { x: number; y: number; width: number; height: number };
/** counts, when given, is the quantity of each shape by index (0 leaves it
 *  out) and replaces copies. */
export type NestOptions = { width: number; height: number; margin: number; gap: number; copies: number; rotate: boolean; counts?: number[] };
export type NestResult = { sheets: Shape[][]; unplaced: string[]; total: number; area: number; elapsed: number; outlineTolerance: number };
