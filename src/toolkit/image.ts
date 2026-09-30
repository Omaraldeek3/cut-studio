export type Raster = { width: number; height: number; data: Uint8ClampedArray };
/** Brightness/contrast are percentages; noise is the largest component area to remove; simplify is pixels. */
export type ImageOptions = { threshold: number; invert: boolean; brightness: number; contrast: number; noise: number; simplify: number };
type Point = { x: number; y: number };
type Contour = { points: Point[]; closed: boolean };
const MAX_PIXELS = 1_000_000;
const MAX_EDGES = 250_000;
const MAX_CONTOURS = 10_000;
const complexityError = () => new Error("Image is too complex to trace. Resize it smaller, raise noise removal, or use a simpler image.");

function validate(raster: Raster, options: ImageOptions) {
  if (!raster || !Number.isSafeInteger(raster.width) || !Number.isSafeInteger(raster.height) || raster.width < 1 || raster.height < 1) {
    throw new Error("Image dimensions must be positive integers.");
  }
  const count = raster.width * raster.height;
  if (count > MAX_PIXELS) throw new Error("Image exceeds 1,000,000 pixels. Resize it before processing.");
  if (!(raster.data instanceof Uint8ClampedArray) || raster.data.length !== count * 4) throw new Error("Image data must contain exactly four RGBA bytes per pixel.");
  if (!options || typeof options.invert !== "boolean") throw new Error("Image invert must be a boolean.");
  const ranges: [keyof Omit<ImageOptions, "invert">, number, number][] = [
    ["threshold", 0, 255], ["brightness", -100, 100], ["contrast", -100, 100], ["noise", 0, MAX_PIXELS], ["simplify", 0, 100],
  ];
  for (const [key, min, max] of ranges) {
    if (!Number.isFinite(options[key]) || options[key] < min || options[key] > max) throw new Error(`Image ${key} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(options.noise)) throw new Error("Image noise removal must be an integer pixel area.");
}

function grayscale(raster: Raster, options: ImageOptions) {
  const values = new Float32Array(raster.width * raster.height);
  const contrast = options.contrast < 0 ? 1 + options.contrast / 100 : 1 + options.contrast / 25;
  for (let i = 0; i < values.length; i++) {
    const at = i * 4;
    const alpha = raster.data[at + 3] / 255;
    const luminance = raster.data[at] * 0.2126 + raster.data[at + 1] * 0.7152 + raster.data[at + 2] * 0.0722;
    let value = (luminance * alpha + 255 * (1 - alpha) - 128) * contrast + 128 + options.brightness * 2.55;
    value = Math.max(0, Math.min(255, value));
    values[i] = options.invert ? 255 - value : value;
  }
  return values;
}

/** Four-connected components match the tracing rule at diagonal contacts. */
function removeNoise(mask: Uint8Array, width: number, noise: number) {
  if (!noise) return;
  const queue = new Uint32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let head = 0, tail = 1;
    queue[0] = start;
    mask[start] = 2;
    while (head < tail) {
      const at = queue[head++];
      const x = at % width;
      for (const next of [x ? at - 1 : -1, x + 1 < width ? at + 1 : -1, at - width, at + width]) {
        if (next >= 0 && next < mask.length && mask[next] === 1) {
          mask[next] = 2;
          queue[tail++] = next;
        }
      }
    }
    if (tail <= noise) for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] === 2) mask[i] = 1;
}

function binaryMask(raster: Raster, options: ImageOptions, dither: boolean) {
  const values = grayscale(raster, options);
  const mask = new Uint8Array(values.length);
  const width = raster.width;
  for (let i = 0; i < values.length; i++) {
    const old = values[i];
    const value = old < options.threshold ? 0 : 255;
    mask[i] = value === 0 ? 1 : 0;
    if (dither) {
      const error = old - value;
      const x = i % width;
      if (x + 1 < width) values[i + 1] += error * 7 / 16;
      if (i + width < values.length) {
        if (x > 0) values[i + width - 1] += error * 3 / 16;
        values[i + width] += error * 5 / 16;
        if (x + 1 < width) values[i + width + 1] += error / 16;
      }
    }
  }
  removeNoise(mask, width, options.noise);
  return mask;
}

function signedArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function segmentDistanceSquared(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
}

function simplifyContour(points: Point[], tolerance: number): Point[] {
  // Collinear reduction is exact even when the requested tolerance is zero.
  points = points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length], next = points[(index + 1) % points.length];
    return (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x);
  });
  if (!tolerance || points.length <= 3) return points;
  let opposite = 1, farthest = 0;
  for (let i = 1; i < points.length; i++) {
    const distance = (points[i].x - points[0].x) ** 2 + (points[i].y - points[0].y) ** 2;
    if (distance > farthest) { farthest = distance; opposite = i; }
  }
  const loop = [...points, points[0]];
  const keep = new Uint8Array(loop.length);
  keep[0] = keep[opposite] = keep[points.length] = 1;
  const stack = [[0, opposite], [opposite, points.length]];
  let operations = 0;
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let max = tolerance * tolerance, selected = -1;
    for (let i = start + 1; i < end; i++) {
      if (++operations > 5_000_000) throw complexityError();
      const distance = segmentDistanceSquared(loop[i], loop[start], loop[end]);
      if (distance > max) { max = distance; selected = i; }
    }
    if (selected >= 0) {
      keep[selected] = 1;
      stack.push([start, selected], [selected, end]);
    }
  }
  const simplified = points.filter((_, i) => keep[i]);
  // A tiny island or hole must survive even an excessively large tolerance.
  return simplified.length >= 3 && signedArea(simplified) * signedArea(points) > 0 ? simplified : points;
}

/** Trace clockwise exterior edges and counterclockwise holes in pixel coordinates. */
export function traceImage(raster: Raster, options: ImageOptions): { contours: Contour[]; width: number; height: number } {
  validate(raster, options);
  const { width, height } = raster;
  const mask = binaryMask(raster, options, false);
  // One bit per oriented edge: east (top), south (right), west (bottom), north (left).
  const edges = new Uint8Array(mask.length);
  let edgeCount = 0;
  for (let at = 0; at < mask.length; at++) {
    if (!mask[at]) continue;
    const x = at % width;
    if (at < width || !mask[at - width]) { edges[at] |= 1; edgeCount++; }
    if (x + 1 === width || !mask[at + 1]) { edges[at] |= 2; edgeCount++; }
    if (at + width >= mask.length || !mask[at + width]) { edges[at] |= 4; edgeCount++; }
    if (x === 0 || !mask[at - 1]) { edges[at] |= 8; edgeCount++; }
    if (edgeCount > MAX_EDGES) throw complexityError();
  }
  const contours: Contour[] = [];
  const dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
  function outgoing(x: number, y: number, direction: number) {
    const cellX = x - (direction === 1 || direction === 2 ? 1 : 0);
    const cellY = y - (direction === 2 || direction === 3 ? 1 : 0);
    if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) return -1;
    const cell = cellY * width + cellX;
    return edges[cell] & (1 << direction) ? cell : -1;
  }
  for (let start = 0; start < edges.length; start++) {
    for (let side = 0; side < 4; side++) {
      if (!(edges[start] & (1 << side))) continue;
      if (contours.length >= MAX_CONTOURS) throw complexityError();
      const startX = start % width + (side === 1 || side === 2 ? 1 : 0);
      const startY = Math.floor(start / width) + (side === 2 || side === 3 ? 1 : 0);
      let x = startX, y = startY, at = start, direction = side;
      const points: Point[] = [];
      do {
        points.push({ x, y });
        edges[at] &= ~(1 << direction);
        x += dx[direction]; y += dy[direction];
        if (x === startX && y === startY) break;
        let next = -1;
        // Prefer a right turn: diagonal black cells remain independent contours.
        for (const turn of [1, 0, 3, 2]) {
          const candidate = (direction + turn) % 4;
          next = outgoing(x, y, candidate);
          if (next >= 0) { direction = candidate; break; }
        }
        if (next < 0) throw new Error("Could not close an image contour. Try a smaller image.");
        at = next;
      } while (points.length <= MAX_EDGES);
      if (points.length > MAX_EDGES) throw complexityError();
      contours.push({ points: simplifyContour(points, options.simplify), closed: true });
    }
  }
  return { width, height, contours };
}

/** Produce an opaque black/white image for threshold or Floyd–Steinberg engraving. */
export function processImage(raster: Raster, options: ImageOptions, dither: boolean): Raster {
  validate(raster, options);
  if (typeof dither !== "boolean") throw new Error("Image dither must be a boolean.");
  const mask = binaryMask(raster, options, dither);
  const data = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i] ? 0 : 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}
