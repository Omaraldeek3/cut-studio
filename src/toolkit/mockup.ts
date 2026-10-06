/* Product mockups drawn on a canvas, with no stock photos: the design as an
   acrylic sign on a wall, cut letters, an engraved board, a shop sign by day
   or night, LED neon, a T-shirt, a mug, a sticker, or placed on a photo of
   the customer's own shop. Every scene is drawn from shapes, gradients and
   seeded noise, so the same settings always give the same picture. */

export type SceneId = 'acrylic' | 'letters' | 'wood' | 'shop' | 'neon' | 'tshirt' | 'mug' | 'sticker' | 'photo';
export type PhotoEffect = 'flat' | 'raised' | 'lit';
export type MockupOptions = {
  scene: SceneId;
  /** How much of its space the design fills, 20 to 100 %. */
  scale: number;
  /** The wall, sky or backdrop. */
  wall: string;
  /** The material: acrylic tint, letter face, wood, fabric, mug, neon colour. */
  material: string;
  /** Letters and neon in the design's own colours instead of the material's. */
  ownColours: boolean;
  night: boolean;
  /** For a photo: where the design's centre sits, 0 to 100 % across and down, and its look. */
  x: number; y: number; effect: PhotoEffect;
};

export type Scene = { id: SceneId; en: string; ar: string; wall: string; material: string; ownColours: boolean; materialLabel: [string, string]; night?: boolean };
export const SCENES: Scene[] = [
  { id: 'acrylic', en: 'Acrylic sign on a wall', ar: 'لوحة أكريليك على جدار', wall: '#e9e4dc', material: '#ffffff', ownColours: true, materialLabel: ['Acrylic tint', 'لون الأكريليك'] },
  { id: 'letters', en: '3D cut letters', ar: 'حروف بارزة مقصوصة', wall: '#d9d4cc', material: '#c8a24a', ownColours: true, materialLabel: ['Letter colour', 'لون الحروف'] },
  { id: 'wood', en: 'Engraved wood', ar: 'حفر على خشب', wall: '#2f2a26', material: '#c9945a', ownColours: false, materialLabel: ['Wood', 'لون الخشب'] },
  { id: 'shop', en: 'Shop front sign', ar: 'لافتة واجهة محل', wall: '#d8cfc2', material: '#1d2126', ownColours: true, materialLabel: ['Sign board', 'لون اللوحة'] },
  { id: 'neon', en: 'LED neon', ar: 'نيون LED', wall: '#3a2a26', material: '#ff3fa4', ownColours: false, materialLabel: ['Neon colour', 'لون النيون'], night: true },
  { id: 'tshirt', en: 'T-shirt print', ar: 'طباعة على تيشيرت', wall: '#ecebe8', material: '#f7f7f5', ownColours: true, materialLabel: ['Shirt colour', 'لون التيشيرت'] },
  { id: 'mug', en: 'Mug', ar: 'كوب', wall: '#e7e2da', material: '#fbfbfa', ownColours: true, materialLabel: ['Mug colour', 'لون الكوب'] },
  { id: 'sticker', en: 'Die-cut sticker', ar: 'ستيكر مقصوص', wall: '#9aa0a6', material: '#ffffff', ownColours: true, materialLabel: ['Border colour', 'لون الحدّ'] },
  { id: 'photo', en: 'On your own photo', ar: 'على صورتك أنت', wall: '#000000', material: '#ffffff', ownColours: true, materialLabel: ['Glow colour', 'لون الإضاءة'] },
];
export const defaultMockup = (scene: SceneId = 'acrylic'): MockupOptions => {
  const s = SCENES.find(x => x.id === scene)!;
  return { scene, scale: 70, wall: s.wall, material: s.material, ownColours: s.ownColours, night: !!s.night, x: 50, y: 35, effect: 'raised' };
};

export const WIDTH = 1600, HEIGHT = 1100;
type Ctx = CanvasRenderingContext2D;
type Art = HTMLCanvasElement;

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const ctx = (c: HTMLCanvasElement) => c.getContext('2d')!;

/** A small fast random sequence, so textures come out the same every time. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function rgb(hex: string) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex: string, k: number) { const [r, g, b] = rgb(hex), f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); return `rgb(${f(r)},${f(g)},${f(b)})`; }
const luma = (hex: string) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/** The design in one colour, keeping its shape and soft edges. */
export function tint(art: Art, colour: string): Art {
  const c = canvas(art.width, art.height), x = ctx(c);
  x.drawImage(art, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = colour; x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The design's dark parts as a shape: what a laser burns. Light parts stay clear,
 *  so a light mark on a dark ground reads as it does on screen. A design that is
 *  all light (white on clear) burns by its shape instead. */
export function darkness(art: Art): Art {
  const c = canvas(art.width, art.height), x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(art, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
  let sum = 0, area = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; sum += a * (1 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255); area += a; }
  const byShape = area > 0 && sum / area < 0.15;
  for (let i = 0; i < d.length; i += 4) {
    const dark = byShape ? 1 : 1 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    d[i + 3] = Math.round(d[i + 3] * Math.min(1, dark * 1.25)); d[i] = d[i + 1] = d[i + 2] = 0;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** The design's lines: its outline and the edges between its colours, a few pixels wide. What a neon tube follows. */
export function lines(art: Art, width = 3): Art {
  const w = art.width, h = art.height, c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(art, 0, 0);
  const d = x.getImageData(0, 0, w, h).data, v = new Float32Array(w * h);
  // Brightness over white, so the outline of the shape counts as an edge too.
  for (let i = 0; i < w * h; i++) { const a = d[i * 4 + 3] / 255; v[i] = (1 - a) + a * (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255; }
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let px = 1; px < w - 1; px++) {
    const i = y * w + px;
    const gx = v[i - w + 1] + 2 * v[i + 1] + v[i + w + 1] - v[i - w - 1] - 2 * v[i - 1] - v[i + w - 1];
    const gy = v[i + w - 1] + 2 * v[i + w] + v[i + w + 1] - v[i - w - 1] - 2 * v[i - w] - v[i - w + 1];
    if (gx * gx + gy * gy > 0.09) edge[i] = 1;
  }
  const out = x.createImageData(w, h), r = Math.max(1, Math.round(width));
  for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) {
    if (!edge[y * w + px]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy, xx = px + dx;
      if (yy < 0 || xx < 0 || yy >= h || xx >= w || dx * dx + dy * dy > r * r) continue;
      out.data[(yy * w + xx) * 4 + 3] = 255;
    }
  }
  x.clearRect(0, 0, w, h);
  x.putImageData(out, 0, 0);
  return c;
}

/** The size the design takes inside a box, keeping its shape. */
function fit(art: Art, w: number, h: number) { const k = Math.min(w / art.width, h / art.height); return { w: art.width * k, h: art.height * k }; }

function speckle(x: Ctx, w: number, h: number, seed: number, amount: number, dark = true) {
  const r = random(seed), n = Math.round((w * h) / 90);
  for (let i = 0; i < n; i++) { x.fillStyle = dark ? `rgba(0,0,0,${r() * amount})` : `rgba(255,255,255,${r() * amount})`; x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
}
function vignette(x: Ctx, w: number, h: number, strength: number) {
  const g = x.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
}
function wall(x: Ctx, w: number, h: number, colour: string, seed = 7) {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(colour, 0.08)); g.addColorStop(1, shade(colour, -0.1));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  speckle(x, w, h, seed, 0.05);
  speckle(x, w, h, seed + 1, 0.05, false);
  vignette(x, w, h, 0.28);
}
function bricks(x: Ctx, w: number, h: number, colour: string) {
  x.fillStyle = shade(colour, -0.35); x.fillRect(0, 0, w, h);
  const r = random(11), bw = 120, bh = 46;
  for (let row = 0, y = 0; y < h; row++, y += bh) for (let bx = row % 2 ? -bw / 2 : 0; bx < w; bx += bw) {
    x.fillStyle = shade(colour, (r() - 0.5) * 0.25);
    x.fillRect(bx + 3, y + 3, bw - 6, bh - 6);
  }
  speckle(x, w, h, 12, 0.12);
  vignette(x, w, h, 0.55);
}
function rounded(x: Ctx, left: number, top: number, w: number, h: number, r: number) {
  x.beginPath(); x.roundRect(left, top, w, h, r);
}
/** Wood: a base colour, then wavy grain lines and a knot or two, clipped to the current path. */
function woodGrain(x: Ctx, left: number, top: number, w: number, h: number, colour: string, seed = 3) {
  x.fillStyle = colour; x.fillRect(left, top, w, h);
  const r = random(seed);
  for (let y = top - 20; y < top + h + 20; y += 2 + r() * 4) {
    const phase = r() * Math.PI * 2, amp = 3 + r() * 9, freq = 0.002 + r() * 0.004;
    x.strokeStyle = r() > 0.5 ? `rgba(70,40,15,${0.05 + r() * 0.12})` : `rgba(255,230,190,${0.04 + r() * 0.07})`;
    x.lineWidth = 0.6 + r() * 1.8;
    x.beginPath();
    for (let px = left; px <= left + w; px += 12) { const py = y + Math.sin(px * freq + phase) * amp + Math.sin(px * freq * 3.1 + phase) * amp * 0.25; if (px === left) x.moveTo(px, py); else x.lineTo(px, py); }
    x.stroke();
  }
  for (let k = 0; k < 2; k++) {
    const kx = left + w * (0.2 + r() * 0.6), ky = top + h * (0.2 + r() * 0.6);
    for (let ring = 1; ring < 7; ring++) { x.strokeStyle = `rgba(70,40,15,${0.16 - ring * 0.02})`; x.lineWidth = 1.5; x.beginPath(); x.ellipse(kx, ky, ring * 7, ring * 3, 0.1, 0, Math.PI * 2); x.stroke(); }
  }
}
/** A blurred copy of the design's shape, as the shadow it throws. */
function shadow(x: Ctx, art: Art, left: number, top: number, w: number, h: number, dx: number, dy: number, blur: number, alpha: number) {
  x.save(); x.filter = `blur(${blur}px)`; x.globalAlpha = alpha;
  x.drawImage(tint(art, '#000'), left + dx, top + dy, w, h);
  x.restore();
}
function gloss(x: Ctx, left: number, top: number, w: number, h: number, strength = 0.22) {
  const g = x.createLinearGradient(left, top, left + w, top + h);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.38, `rgba(255,255,255,${strength})`); g.addColorStop(0.46, 'rgba(255,255,255,0.02)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(left, top, w, h);
}
function standoff(x: Ctx, cx: number, cy: number, r: number) {
  x.save(); x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 8; x.shadowOffsetX = 3; x.shadowOffsetY = 4;
  const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#c9ccd0'); g.addColorStop(1, '#7c8086');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); x.restore();
}
/** Draws a lit copy of the design several times over, for a glow. */
function glow(x: Ctx, art: Art, left: number, top: number, w: number, h: number, colour: string, size: number) {
  const lit = tint(art, colour);
  x.save(); x.globalCompositeOperation = 'lighter';
  for (const [blur, alpha] of [[size, 0.55], [size / 2.5, 0.7], [size / 7, 0.9]] as const) { x.filter = `blur(${blur}px)`; x.globalAlpha = alpha; x.drawImage(lit, left, top, w, h); }
  x.restore();
}

// ——— The scenes ———

function acrylic(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  wall(x, W, H, o.wall);
  const box = fit(art, W * 0.62 * (o.scale / 100), H * 0.56 * (o.scale / 100)), pad = Math.max(box.w, box.h) * 0.09;
  const pw = box.w + 2 * pad, ph = box.h + 2 * pad, left = (W - pw) / 2, top = (H - ph) / 2 - H * 0.03;
  // The panel stands off the wall: its edge and the print both throw a shadow.
  x.save(); rounded(x, left, top, pw, ph, 14); x.shadowColor = 'rgba(0,0,0,0.28)'; x.shadowBlur = 38; x.shadowOffsetX = 16; x.shadowOffsetY = 22; x.fillStyle = 'rgba(255,255,255,0.12)'; x.fill(); x.restore();
  shadow(x, art, left + pad, top + pad, box.w, box.h, 18, 24, 7, 0.32);
  x.save(); rounded(x, left, top, pw, ph, 14); x.clip();
  const [r, g, b] = rgb(o.material), sheet = x.createLinearGradient(left, top, left, top + ph);
  sheet.addColorStop(0, `rgba(${r},${g},${b},0.30)`); sheet.addColorStop(1, `rgba(${r},${g},${b},0.14)`);
  x.fillStyle = sheet; x.fillRect(left, top, pw, ph);
  x.drawImage(o.ownColours ? art : tint(art, o.material), left + pad, top + pad, box.w, box.h);
  gloss(x, left, top, pw, ph);
  x.restore();
  x.save(); rounded(x, left + 1, top + 1, pw - 2, ph - 2, 13); x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 2; x.stroke();
  rounded(x, left - 1, top - 1, pw + 2, ph + 2, 15); x.strokeStyle = 'rgba(0,0,0,0.16)'; x.lineWidth = 1.5; x.stroke(); x.restore();
  const inset = Math.min(pad * 0.5, 40), sr = Math.max(9, Math.min(18, pw * 0.014));
  for (const [cx, cy] of [[left + inset, top + inset], [left + pw - inset, top + inset], [left + inset, top + ph - inset], [left + pw - inset, top + ph - inset]]) standoff(x, cx, cy, sr);
}

function letters(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  wall(x, W, H, o.wall, 9);
  const box = fit(art, W * 0.7 * (o.scale / 100), H * 0.6 * (o.scale / 100)), left = (W - box.w) / 2, top = (H - box.h) / 2 - H * 0.03;
  shadow(x, art, left, top, box.w, box.h, 26, 34, 14, 0.38);
  // The thickness of the letters, stepped back towards the wall.
  const depth = Math.max(6, Math.round(Math.min(box.w, box.h) * 0.035)), side = tint(art, shade(o.ownColours ? '#9a9a9a' : o.material, -0.45));
  for (let i = depth; i >= 1; i--) x.drawImage(side, left + i * 0.55, top + i * 0.75, box.w, box.h);
  const face = o.ownColours ? art : tint(art, o.material);
  x.drawImage(face, left, top, box.w, box.h);
  // A soft light from above on the faces.
  const lit = canvas(box.w, box.h), lx = ctx(lit);
  lx.drawImage(art, 0, 0, box.w, box.h); lx.globalCompositeOperation = 'source-in';
  const g = lx.createLinearGradient(0, 0, box.w * 0.3, box.h);
  g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
  lx.fillStyle = g; lx.fillRect(0, 0, box.w, box.h);
  x.drawImage(lit, left, top);
}

function wood(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  wall(x, W, H, o.wall, 5);
  const bw = W * 0.74, bh = H * 0.66, left = (W - bw) / 2, top = (H - bh) / 2 - H * 0.02, edge = 18;
  x.save(); rounded(x, left, top, bw, bh + edge, 22); x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 50; x.shadowOffsetY = 26; x.fillStyle = shade(o.material, -0.4); x.fill(); x.restore();
  x.save(); rounded(x, left, top, bw, bh, 22); x.clip(); woodGrain(x, left, top, bw, bh, o.material);
  const sheen = x.createLinearGradient(left, top, left, top + bh); sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(1, 'rgba(0,0,0,0.12)'); x.fillStyle = sheen; x.fillRect(left, top, bw, bh);
  const box = fit(art, bw * 0.8 * (o.scale / 100), bh * 0.78 * (o.scale / 100)), ax = left + (bw - box.w) / 2, ay = top + (bh - box.h) / 2;
  // Burnt in: the design darkens the wood it covers, a lighter rim where the beam stopped.
  const burn = darkness(art);
  x.globalAlpha = 0.35; x.drawImage(tint(burn, '#fff3dc'), ax + 1.5, ay + 1.5, box.w, box.h); x.globalAlpha = 1;
  x.globalCompositeOperation = 'multiply';
  x.drawImage(tint(burn, '#4a2c16'), ax, ay, box.w, box.h);
  x.globalAlpha = 0.55; x.drawImage(tint(burn, '#2a170b'), ax, ay, box.w, box.h);
  x.restore();
}

function shop(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  const night = o.night, sky = x.createLinearGradient(0, 0, 0, H * 0.3);
  sky.addColorStop(0, night ? '#0b1020' : '#9cc3e6'); sky.addColorStop(1, night ? '#1b2440' : '#d9e8f3');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  const fx = W * 0.06, fy = H * 0.14, fw = W * 0.88, fh = H * 0.74;
  // The building: wall, then the sign board, the windows and the door.
  x.fillStyle = night ? shade(o.wall, -0.65) : o.wall; x.fillRect(fx, fy, fw, fh);
  x.save(); x.beginPath(); x.rect(fx, fy, fw, fh); x.clip(); speckle(x, W, H, 21, 0.06); x.restore();
  const sx = fx + fw * 0.06, sy = fy + fh * 0.07, sw = fw * 0.88, sh = fh * 0.27;
  x.save(); x.shadowColor = 'rgba(0,0,0,0.4)'; x.shadowBlur = 24; x.shadowOffsetY = 14; x.fillStyle = o.material; x.fillRect(sx, sy, sw, sh); x.restore();
  x.strokeStyle = shade(o.material, 0.25); x.lineWidth = 4; x.strokeRect(sx + 2, sy + 2, sw - 4, sh - 4);
  const box = fit(art, sw * 0.86 * (o.scale / 100), sh * 0.78 * (o.scale / 100)), ax = sx + (sw - box.w) / 2, ay = sy + (sh - box.h) / 2;
  if (night) glow(x, art, ax, ay, box.w, box.h, '#fff6e0', 26);
  x.drawImage(art, ax, ay, box.w, box.h);
  if (night) { x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.25; x.drawImage(art, ax, ay, box.w, box.h); x.restore(); }
  const wy = sy + sh + fh * 0.08, wh = fh * 0.5, glassL = fx + fw * 0.06, door = fw * 0.2, glassW = (fw * 0.88 - door - fw * 0.04) / 2;
  const pane = (left: number, width: number, height: number) => {
    const g = x.createLinearGradient(left, wy, left + width, wy + height);
    if (night) { g.addColorStop(0, '#f6d48b'); g.addColorStop(1, '#c88a3c'); } else { g.addColorStop(0, '#5f7e94'); g.addColorStop(0.5, '#a9c2d2'); g.addColorStop(1, '#4a6476'); }
    x.fillStyle = g; x.fillRect(left, wy, width, height);
    x.strokeStyle = night ? '#2a2a2a' : '#3b3f44'; x.lineWidth = 8; x.strokeRect(left, wy, width, height);
  };
  pane(glassL, glassW, wh);
  pane(glassL + glassW + fw * 0.02, door, fy + fh - wy);
  pane(glassL + glassW + door + fw * 0.04, glassW, wh);
  x.fillStyle = night ? '#16181c' : '#8d8a84'; x.fillRect(0, fy + fh, W, H - fy - fh);
  if (night) { const g = x.createRadialGradient(W / 2, fy + fh, 10, W / 2, fy + fh, W * 0.5); g.addColorStop(0, 'rgba(255,214,140,0.25)'); g.addColorStop(1, 'rgba(255,214,140,0)'); x.fillStyle = g; x.fillRect(0, fy + fh - 40, W, H); }
}

function neon(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  bricks(x, W, H, o.wall);
  const box = fit(art, W * 0.7 * (o.scale / 100), H * 0.62 * (o.scale / 100)), left = (W - box.w) / 2, top = (H - box.h) / 2;
  // A clear backing board, then the tubes and their light on the wall.
  x.save(); rounded(x, left - 30, top - 30, box.w + 60, box.h + 60, 24); x.fillStyle = 'rgba(255,255,255,0.05)'; x.fill(); x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 2; x.stroke(); x.restore();
  // The tubes follow the design's lines, a few millimetres thick at any size.
  const tube = lines(art, Math.max(2, (art.width / box.w) * 5));
  const colour = o.ownColours ? null : o.material;
  if (colour) glow(x, tube, left, top, box.w, box.h, colour, 50);
  else {
    const coloured = canvas(art.width, art.height), cx = ctx(coloured);
    cx.drawImage(tube, 0, 0); cx.globalCompositeOperation = 'source-in'; cx.drawImage(art, 0, 0);
    x.save(); x.globalCompositeOperation = 'lighter'; x.filter = 'blur(30px)'; x.drawImage(coloured, left, top, box.w, box.h); x.filter = 'blur(10px)'; x.drawImage(coloured, left, top, box.w, box.h); x.restore();
  }
  x.drawImage(tint(tube, colour ? shade(colour, 0.6) : '#fff7ef'), left, top, box.w, box.h);
}

function tshirt(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  const bg = x.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H / 2, W * 0.7);
  bg.addColorStop(0, shade(o.wall, 0.15)); bg.addColorStop(1, shade(o.wall, -0.15));
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const s = H / 1100, cx = W / 2;
  const shirt = new Path2D();
  shirt.moveTo(cx - 150 * s, 120 * s);
  shirt.quadraticCurveTo(cx, 200 * s, cx + 150 * s, 120 * s);
  shirt.lineTo(cx + 330 * s, 200 * s); shirt.lineTo(cx + 470 * s, 420 * s); shirt.lineTo(cx + 350 * s, 490 * s); shirt.lineTo(cx + 290 * s, 400 * s);
  shirt.lineTo(cx + 300 * s, 1020 * s); shirt.quadraticCurveTo(cx, 1050 * s, cx - 300 * s, 1020 * s);
  shirt.lineTo(cx - 290 * s, 400 * s); shirt.lineTo(cx - 350 * s, 490 * s); shirt.lineTo(cx - 470 * s, 420 * s); shirt.lineTo(cx - 330 * s, 200 * s); shirt.closePath();
  x.save(); x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = 40; x.shadowOffsetY = 20; x.fillStyle = o.material; x.fill(shirt); x.restore();
  x.save(); x.clip(shirt);
  const folds = x.createLinearGradient(cx - 330 * s, 0, cx + 330 * s, 0);
  folds.addColorStop(0, 'rgba(0,0,0,0.16)'); folds.addColorStop(0.2, 'rgba(0,0,0,0.02)'); folds.addColorStop(0.5, 'rgba(255,255,255,0.06)'); folds.addColorStop(0.8, 'rgba(0,0,0,0.03)'); folds.addColorStop(1, 'rgba(0,0,0,0.18)');
  x.fillStyle = folds; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(0,0,0,0.08)'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 150 * s, 120 * s); x.quadraticCurveTo(cx, 230 * s, cx + 150 * s, 120 * s); x.stroke();
  const box = fit(art, 400 * s * (o.scale / 100), 440 * s * (o.scale / 100)), ax = cx - box.w / 2, ay = 290 * s;
  x.globalCompositeOperation = luma(o.material) > 0.55 ? 'multiply' : 'source-over';
  x.globalAlpha = 0.94; x.drawImage(art, ax, ay, box.w, box.h);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  speckle(x, W, H, 31, 0.05);
  x.restore();
}

function mug(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  wall(x, W, H, o.wall, 13);
  const table = x.createLinearGradient(0, H * 0.72, 0, H);
  table.addColorStop(0, shade(o.wall, -0.18)); table.addColorStop(1, shade(o.wall, -0.32));
  x.fillStyle = table; x.fillRect(0, H * 0.72, W, H * 0.28);
  const mw = W * 0.34, mh = H * 0.56, left = (W - mw) / 2 - W * 0.03, top = H * 0.2, rx = mw / 2, ry = mw * 0.09;
  x.save(); x.filter = 'blur(18px)'; x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(left + mw / 2 + 30, top + mh + 6, rx * 1.05, ry * 1.4, 0, 0, Math.PI * 2); x.fill(); x.restore();
  // The handle, behind and to the right.
  x.save(); x.lineWidth = mw * 0.09; x.strokeStyle = shade(o.material, -0.12); x.beginPath(); x.ellipse(left + mw, top + mh * 0.45, mw * 0.2, mh * 0.24, 0, -Math.PI / 2, Math.PI / 2); x.stroke(); x.restore();
  const body = new Path2D(); body.moveTo(left, top); body.lineTo(left, top + mh); body.ellipse(left + rx, top + mh, rx, ry, 0, Math.PI, 0, true); body.lineTo(left + mw, top); body.closePath();
  x.fillStyle = o.material; x.fill(body);
  x.save(); x.clip(body);
  // The print wraps round the cylinder: drawn in thin columns, squeezed towards the sides.
  const box = fit(art, mw * 0.78 * (o.scale / 100), mh * 0.62 * (o.scale / 100)), ay = top + (mh - box.h) / 2 + ry * 0.5, columns = Math.min(260, Math.round(box.w));
  const span = box.w / mw;
  for (let i = 0; i < columns; i++) {
    const u0 = i / columns, u1 = (i + 1) / columns;
    const a0 = (u0 - 0.5) * span * Math.PI * 0.9, a1 = (u1 - 0.5) * span * Math.PI * 0.9;
    const x0 = left + rx + Math.sin(a0) * rx, x1 = left + rx + Math.sin(a1) * rx;
    x.drawImage(art, u0 * art.width, 0, art.width / columns + 0.5, art.height, x0, ay, Math.max(0.6, x1 - x0 + 0.4), box.h);
  }
  const g = x.createLinearGradient(left, 0, left + mw, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(0.28, 'rgba(255,255,255,0.18)'); g.addColorStop(0.36, 'rgba(255,255,255,0.05)'); g.addColorStop(0.75, 'rgba(0,0,0,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.34)');
  x.fillStyle = g; x.fillRect(left, top, mw, mh + ry);
  x.restore();
  x.fillStyle = shade(o.material, -0.18); x.beginPath(); x.ellipse(left + rx, top, rx, ry, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = shade(o.material, -0.45); x.beginPath(); x.ellipse(left + rx, top + 3, rx * 0.9, ry * 0.75, 0, 0, Math.PI * 2); x.fill();
}

function sticker(x: Ctx, art: Art, o: MockupOptions, W: number, H: number) {
  const lid = x.createLinearGradient(0, 0, W, H);
  lid.addColorStop(0, shade(o.wall, 0.25)); lid.addColorStop(1, shade(o.wall, -0.25));
  x.fillStyle = lid; x.fillRect(0, 0, W, H);
  speckle(x, W, H, 41, 0.04, false);
  const box = fit(art, W * 0.5 * (o.scale / 100), H * 0.6 * (o.scale / 100)), border = Math.max(8, Math.min(box.w, box.h) * 0.04);
  const pad = border + 4, c = canvas(box.w + 2 * pad, box.h + 2 * pad), sx = ctx(c);
  // The die-cut border: the shape grown outwards by drawing it round a circle.
  const edge = tint(art, o.material);
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; sx.drawImage(edge, pad + Math.cos(a) * border, pad + Math.sin(a) * border, box.w, box.h); }
  sx.drawImage(edge, pad, pad, box.w, box.h);
  sx.drawImage(art, pad, pad, box.w, box.h);
  x.save(); x.translate(W / 2, H / 2); x.rotate(-0.07);
  x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 16; x.shadowOffsetY = 8;
  x.drawImage(c, -c.width / 2, -c.height / 2);
  x.shadowColor = 'transparent';
  x.globalCompositeOperation = 'source-atop';
  gloss(x, -c.width / 2, -c.height / 2, c.width, c.height, 0.16);
  x.restore();
}

function onPhoto(x: Ctx, art: Art, o: MockupOptions, W: number, H: number, photo: CanvasImageSource | null) {
  if (photo) x.drawImage(photo, 0, 0, W, H); else wall(x, W, H, '#cfc8be');
  const box = fit(art, W * 0.6 * (o.scale / 100), H * 0.6 * (o.scale / 100)), left = (o.x / 100) * W - box.w / 2, top = (o.y / 100) * H - box.h / 2;
  if (o.effect === 'raised') shadow(x, art, left, top, box.w, box.h, box.w * 0.012, box.w * 0.016, Math.max(3, box.w * 0.008), 0.45);
  if (o.effect === 'lit') glow(x, art, left, top, box.w, box.h, o.material, Math.max(12, box.w * 0.03));
  x.drawImage(art, left, top, box.w, box.h);
}

/** Draws the mockup into `target`, which takes the scene's size. */
export function renderMockup(target: HTMLCanvasElement, art: Art, o: MockupOptions, photo?: { image: CanvasImageSource; width: number; height: number } | null) {
  let W = WIDTH, H = HEIGHT;
  if (o.scene === 'photo' && photo) { const k = Math.min(1, 1600 / Math.max(photo.width, photo.height)) || 1; W = Math.round(photo.width * k); H = Math.round(photo.height * k); }
  target.width = W; target.height = H;
  const x = ctx(target);
  x.save(); x.clearRect(0, 0, W, H); x.imageSmoothingQuality = 'high';
  switch (o.scene) {
    case 'acrylic': acrylic(x, art, o, W, H); break;
    case 'letters': letters(x, art, o, W, H); break;
    case 'wood': wood(x, art, o, W, H); break;
    case 'shop': shop(x, art, o, W, H); break;
    case 'neon': neon(x, art, o, W, H); break;
    case 'tshirt': tshirt(x, art, o, W, H); break;
    case 'mug': mug(x, art, o, W, H); break;
    case 'sticker': sticker(x, art, o, W, H); break;
    case 'photo': onPhoto(x, art, o, W, H, photo?.image ?? null); break;
  }
  x.restore();
}

/** Prepares a design: the white around an opaque picture taken out when asked, and the empty margin trimmed. */
export function prepareArt(source: CanvasImageSource, width: number, height: number, dropWhite: boolean): { art: Art; opaque: boolean } {
  const k = Math.min(1, 1400 / Math.max(width, height)), w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  let opaque = true;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { opaque = false; break; }
  if (opaque && dropWhite) {
    // Near-white becomes clear, with a short ramp so edges stay smooth.
    for (let i = 0; i < d.length; i += 4) { const m = Math.min(d[i], d[i + 1], d[i + 2]); if (m > 225) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (250 - m) / 25)); }
    x.putImageData(img, 0, 0);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) if (d[(y * w + px) * 4 + 3] > 12) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { art: c, opaque };
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx(out).drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { art: out, opaque };
}
