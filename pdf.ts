/* A deliberately small PDF writer: one page, vector content, optional JPEG
   images and one optional spot colour. That is everything a print shop needs
   from Cut Studio: colour vectors for the RIP, and print-and-cut files whose
   cut line is the spot colour the cutter looks for ("CutContour").
   Content streams are written as plain text; binary image data is copied in
   untouched, so the byte offsets in the cross-reference table stay exact. */

export type PdfImage = { name: string; jpeg: Uint8Array; width: number; height: number };
export type PdfSpot = { name: string; cmyk: [number, number, number, number] };
export type PdfPage = {
  /** Page size in points (1/72 inch). */
  width: number;
  height: number;
  content: string;
  images?: PdfImage[];
  /** Referenced from the content as /Spot, e.g. "/Spot CS 1 SCN". */
  spot?: PdfSpot;
  /** Shading dictionaries, each written as "/Name << ... >>" and painted
   *  from the content with "/Name sh". */
  shadings?: string[];
  title?: string;
};

const encoder = new TextEncoder();
const num = (v: number) => String(Math.round(v * 1000) / 1000);

export const mmToPt = (mm: number) => (mm * 72) / 25.4;

export function buildPdf(page: PdfPage): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    body();
    write('\nendobj\n');
  };

  const images = page.images ?? [];
  const firstImage = 5;
  const spotId = firstImage + images.length;
  const infoId = spotId + (page.spot ? 1 : 0);
  const content = encoder.encode(page.content);

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, () => write('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => write('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, () => {
    const xobjects = images.map((image, i) => `/${image.name} ${firstImage + i} 0 R`).join(' ');
    const resources = [
      images.length ? `/XObject << ${xobjects} >>` : '',
      page.spot ? `/ColorSpace << /Spot ${spotId} 0 R >>` : '',
      page.shadings?.length ? `/Shading << ${page.shadings.join(' ')} >>` : '',
    ].join(' ');
    write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Contents 4 0 R /Resources << ${resources} >> >>`);
  });
  object(4, () => {
    write(`<< /Length ${content.length} >>\nstream\n`);
    write(content);
    write('\nendstream');
  });
  images.forEach((image, i) => object(firstImage + i, () => {
    write(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`);
    write(image.jpeg);
    write('\nendstream');
  }));
  if (page.spot) {
    const [c, m, y, k] = page.spot.cmyk;
    object(spotId, () => write(`[/Separation /${page.spot!.name} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${c} ${m} ${y} ${k}] /N 1 >>]`));
  }
  object(infoId, () => write(`<< /Producer (Cut Studio) /Title (${(page.title ?? 'Cut Studio').replace(/[()\\]/g, '')}) >>`));

  const xref = length;
  const count = infoId + 1;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

/** PDF path operators for a closed path of cubic curves, in the caller's units. */
export function pdfPath(start: { x: number; y: number }, curves: ArrayLike<number>[]) {
  let s = `${num(start.x)} ${num(start.y)} m\n`;
  for (const c of curves) s += `${num(c[0])} ${num(c[1])} ${num(c[2])} ${num(c[3])} ${num(c[4])} ${num(c[5])} c\n`;
  return s + 'h\n';
}

export const pdfNumber = num;
