// Writes a machine test pack: the same jobs as SVG and DXF, to open in
// CorelDRAW and RDWorks and to cut. Run with: npx jiti scripts/test-pack.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { toSvg, toDxf } from '../src/toolkit/export';
import { buildBox } from '../src/toolkit/box';
import { defaultBoxOptions } from '../src/toolkit/box/types';
import { gearDrawing, defaultGear, puzzleDrawing, defaultPuzzle } from '../src/toolkit/generators';
import { vectorize, defaultVectorize } from '../src/toolkit/vectorize';
import { cutDrawing, resultToDrawing } from '../src/toolkit/vector-export';
import { offsetContours } from '../src/toolkit/vector-ops';
import type { Drawing } from '../src/toolkit/types';
import { logoRaster } from '../tests/fixtures/logo';

const out = 'test-pack';
mkdirSync(out, { recursive: true });
const save = (name: string, d: Drawing) => {
  writeFileSync(`${out}/${name}.svg`, toSvg(d));
  writeFileSync(`${out}/${name}.dxf`, toDxf(d));
};

save('box-closed-3mm', buildBox(defaultBoxOptions).drawing);
save('gear-24-teeth', gearDrawing(defaultGear));
save('puzzle-5x4', puzzleDrawing(defaultPuzzle));
const raster = await logoRaster();
save('logo-outline-200mm', resultToDrawing(vectorize(raster, { ...defaultVectorize, mode: 'outline' }), 200));
save('logo-cutout-cutlines-200mm', cutDrawing(vectorize(raster, { ...defaultVectorize, mode: 'color', layering: 'cutout', colors: 8 }), 200));
const square = [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 40 }, { x: 10, y: 40 }];
save('offset-5mm-round', { width: 80, height: 60, shapes: [{ id: 'o', name: 'offset', contours: offsetContours([square], 5) }] });
console.log(`test pack written to ${out}/`);
