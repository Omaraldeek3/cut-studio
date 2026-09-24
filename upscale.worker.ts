import type * as Ort from 'onnxruntime-web';
import { JpegStream, PngStream, RowResampler, RowUpsampler, tileInput, tilePlan } from './upscale-core';

/* Runs Real-ESRGAN on the visitor's own machine. ONNX Runtime is loaded as a
   plain file from /vendor/ort, next to its WebAssembly, and uses the GPU
   through WebGPU when the browser offers it, the processor otherwise. The
   picture is cut into tiles with a margin of context around each; finished
   rows are resampled to the size asked for and handed to the encoder band by
   band, so the full-size result never has to exist in memory at once. */

export type UpscaleModel = 'general' | 'general-wdn' | 'graphics';
const FILES: Record<UpscaleModel, string> = { general: 'general-x4v3', 'general-wdn': 'general-wdn-x4v3', graphics: 'animevideo-x4v3' };
const SIZE = 192, PAD = 12, FACTOR = 4, SIDE = SIZE + PAD * 2, OUT = SIDE * FACTOR;

type Source = { width: number; height: number; data: Uint8ClampedArray; alpha: boolean };
export type WorkerRequest =
  | { type: 'source'; width: number; height: number; data: Uint8ClampedArray }
  | { type: 'model'; model: UpscaleModel; gpu: boolean }
  | { type: 'probe'; x: number; y: number }
  | { type: 'run'; width: number; height: number; format: 'jpeg' | 'png'; quality: number; dpi: number; previewWidth: number };

let ort: typeof Ort | null = null;
let session: Ort.InferenceSession | null = null;
let loaded = '';
let backend: 'webgpu' | 'wasm' = 'wasm';
let source: Source | null = null;

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

async function runtime() {
  if (ort) return ort;
  const base = new URL('/vendor/ort/', self.location.origin).href;
  ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${base}ort.webgpu.bundle.min.mjs`)) as typeof Ort;
  ort.env.wasm.wasmPaths = base;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  ort.env.logLevel = 'error';
  return ort;
}

async function loadModel(model: UpscaleModel, gpu: boolean) {
  const o = await runtime();
  const key = `${model}:${gpu}`;
  if (session && loaded === key) return;
  await session?.release();
  session = null;
  const response = await fetch(`/models/realesrgan/${FILES[model]}.onnx`);
  if (!response.ok) throw new Error('The AI model could not be downloaded. Check the connection and try again.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (gpu && 'gpu' in navigator) {
    try {
      session = await o.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      backend = 'webgpu';
    } catch {
      session = null;
    }
  }
  if (!session) {
    session = await o.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    backend = 'wasm';
  }
  loaded = key;
}

/** One tile through the model: planar RGB in, planar RGB at 4x out. */
async function infer(input: Float32Array): Promise<Float32Array> {
  if (!ort || !session) throw new Error('The model is not loaded.');
  const tensor = new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]);
  const result = await session.run({ input: tensor });
  const output = result.output;
  const data = (await output.getData()) as Float32Array;
  output.dispose();
  return data;
}

const clamp = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

async function probe(x: number, y: number) {
  if (!source) throw new Error('No image loaded.');
  const { width, height, data } = source;
  const tile = {
    x: Math.max(0, Math.min(Math.max(0, width - SIZE), Math.round(x - SIZE / 2))),
    y: Math.max(0, Math.min(Math.max(0, height - SIZE), Math.round(y - SIZE / 2))),
    width: Math.min(SIZE, width), height: Math.min(SIZE, height),
  };
  const started = performance.now();
  const out = await infer(tileInput(data, width, height, tile, SIZE, PAD));
  const seconds = (performance.now() - started) / 1000;
  const w = tile.width * FACTOR, h = tile.height * FACTOR, plane = OUT * OUT;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
    const s = (PAD * FACTOR + oy) * OUT + PAD * FACTOR + ox, d = (oy * w + ox) * 4;
    rgba[d] = clamp(out[s]); rgba[d + 1] = clamp(out[plane + s]); rgba[d + 2] = clamp(out[2 * plane + s]); rgba[d + 3] = 255;
  }
  post({ type: 'probe', tile, width: w, height: h, data: rgba, seconds, backend }, [rgba.buffer]);
}

async function run(request: Extract<WorkerRequest, { type: 'run' }>) {
  if (!source) throw new Error('No image loaded.');
  const { width, height, data, alpha } = source;
  const W4 = width * FACTOR, H4 = height * FACTOR;
  const outW = request.width, outH = request.height;
  const channels = request.format === 'png' && alpha ? 4 : 3;
  const jpeg = request.format === 'jpeg' ? new JpegStream(outW, outH, request.quality, request.dpi) : null;
  const png = request.format === 'png' ? new PngStream(outW, outH, channels as 3 | 4, request.dpi) : null;

  // Output rows are gathered into blocks before they reach the encoder.
  const stride = outW * channels, blockRows = 64;
  let block = new Uint8Array(stride * blockRows), blockFill = 0;
  const pending: Promise<void>[] = [];
  const flushBlock = () => {
    if (!blockFill) return;
    const rows = block.subarray(0, blockFill * stride);
    if (jpeg) jpeg.addRows(rows, blockFill);
    else pending.push(png!.addRows(rows.slice(), blockFill));
    block = new Uint8Array(stride * blockRows);
    blockFill = 0;
  };
  const deliver = (row: Uint8Array) => {
    block.set(row, blockFill * stride);
    if (++blockFill === blockRows) flushBlock();
  };
  // Up to 4x the model's rows are shrunk to size; past 4x they are enlarged.
  const resize = outW === W4 && outH === H4 ? null
    : outW <= W4 ? new RowResampler(W4, H4, outW, outH, channels, row => deliver(row))
    : new RowUpsampler(W4, H4, outW, outH, channels, row => deliver(row));

  const previewWidth = Math.min(request.previewWidth, W4), previewHeight = Math.max(1, Math.round((H4 * previewWidth) / W4));
  const preview = new Uint8ClampedArray(previewWidth * previewHeight * 4);
  const previewResize = new RowResampler(W4, H4, previewWidth, previewHeight, channels, (row, index) => {
    for (let x = 0; x < previewWidth; x++) {
      const d = (index * previewWidth + x) * 4, s = x * channels;
      preview[d] = row[s]; preview[d + 1] = row[s + 1]; preview[d + 2] = row[s + 2]; preview[d + 3] = channels === 4 ? row[s + 3] : 255;
    }
  });

  const plan = tilePlan(width, height, SIZE);
  const total = plan.reduce((n, row) => n + row.length, 0);
  let done = 0;
  const started = performance.now();
  const plane = OUT * OUT;

  for (const row of plan) {
    const bandRows = row[0].height * FACTOR;
    const band = new Uint8Array(W4 * bandRows * channels);
    for (const tile of row) {
      const out = await infer(tileInput(data, width, height, tile, SIZE, PAD));
      const w = tile.width * FACTOR;
      for (let oy = 0; oy < bandRows; oy++) {
        const s0 = (PAD * FACTOR + oy) * OUT + PAD * FACTOR, d0 = (oy * W4 + tile.x * FACTOR) * channels;
        for (let ox = 0; ox < w; ox++) {
          const s = s0 + ox, d = d0 + ox * channels;
          band[d] = clamp(out[s]); band[d + 1] = clamp(out[plane + s]); band[d + 2] = clamp(out[2 * plane + s]);
        }
      }
      done++;
      post({ type: 'progress', done, total, elapsed: (performance.now() - started) / 1000, backend });
    }
    if (channels === 4) {
      // Transparency is enlarged smoothly from the source; the model sees RGB only.
      for (let oy = 0; oy < bandRows; oy++) {
        const v = Math.min(height - 1, Math.max(0, (row[0].y * FACTOR + oy + 0.5) / FACTOR - 0.5));
        const y0 = Math.floor(v), y1 = Math.min(height - 1, y0 + 1), fy = v - y0;
        for (let X = 0; X < W4; X++) {
          const u = Math.min(width - 1, Math.max(0, (X + 0.5) / FACTOR - 0.5));
          const x0 = Math.floor(u), x1 = Math.min(width - 1, x0 + 1), fx = u - x0;
          const a = (data[(y0 * width + x0) * 4 + 3] * (1 - fx) + data[(y0 * width + x1) * 4 + 3] * fx) * (1 - fy)
            + (data[(y1 * width + x0) * 4 + 3] * (1 - fx) + data[(y1 * width + x1) * 4 + 3] * fx) * fy;
          band[(oy * W4 + X) * 4 + 3] = Math.round(a);
        }
      }
    }
    for (let r = 0; r < bandRows; r++) {
      const line = band.subarray(r * W4 * channels, (r + 1) * W4 * channels);
      if (resize) resize.push(line); else deliver(line);
      previewResize.push(line);
    }
    const snapshot = preview.slice();
    post({ type: 'preview', width: previewWidth, height: previewHeight, data: snapshot }, [snapshot.buffer]);
  }
  resize?.finish();
  previewResize.finish();
  flushBlock();
  await Promise.all(pending);
  const blob = jpeg ? jpeg.finish() : await png!.finish();
  post({ type: 'done', blob, width: outW, height: outH, seconds: (performance.now() - started) / 1000, backend });
}

// Requests run one after another, so a run never starts before the model it
// needs has finished loading.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handle(event.data));
};

async function handle(request: WorkerRequest) {
  try {
    if (request.type === 'source') {
      let alpha = false;
      for (let i = 3; i < request.data.length; i += 4) if (request.data[i] < 255) { alpha = true; break; }
      source = { width: request.width, height: request.height, data: request.data, alpha };
      post({ type: 'source', alpha });
    } else if (request.type === 'model') {
      await loadModel(request.model, request.gpu);
      post({ type: 'model', backend });
    } else if (request.type === 'probe') {
      await probe(request.x, request.y);
    } else if (request.type === 'run') {
      await run(request);
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}
