import sharp from 'sharp';
import type { Raster } from '../../src/toolkit/image';

/** A workshop-style logo: a red ring around a navy square, Latin and Arabic
 *  lettering, on white. Circles and straight edges show whether tracing
 *  gives back true geometry; neighbouring colours show whether cut-out
 *  tracing draws each border once. */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#fff"/><circle cx="220" cy="250" r="170" fill="#d62828"/><circle cx="220" cy="250" r="110" fill="#fff"/><rect x="150" y="180" width="140" height="140" fill="#003049"/><text x="430" y="230" font-family="Arial" font-weight="bold" font-size="110" fill="#003049">SIGN</text><text x="430" y="360" font-family="Tahoma" font-weight="bold" font-size="110" fill="#f77f00">ورشة</text></svg>`;

export async function logoRaster(): Promise<Raster> {
  const { data, info } = await sharp(Buffer.from(LOGO_SVG)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}
