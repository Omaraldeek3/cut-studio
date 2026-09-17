export type Point = { x: number; y: number };
/** layer 'engrave' marks marking strokes (labels); everything else is cut. */
export type Contour = { points: Point[]; closed: boolean; layer?: 'engrave' };
export type Shape = { id: string; name: string; contours: Contour[] };
/** skippedText counts live text objects left out because they are not cutting outlines. */
export type Drawing = { width: number; height: number; shapes: Shape[]; skippedText?: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type NestOptions = { width: number; height: number; margin: number; gap: number; copies: number; rotate: boolean };
export type NestResult = { sheets: Shape[][]; unplaced: string[]; total: number; area: number; elapsed: number; outlineTolerance: number };
