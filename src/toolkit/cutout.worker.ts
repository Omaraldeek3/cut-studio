import type * as Ort from 'onnxruntime-web';
import { MASK_SIDE as SIDE } from './cutout';

/* Finds the subject of a photo on the visitor's own machine, with IS-Net from
   DIS. ONNX Runtime is loaded as a plain file from /vendor/ort, next to its
   WebAssembly, and uses the GPU through WebGPU when the browser offers it,
   the processor otherwise. The model (90 MB, in five parts) is downloaded once
   and kept in the browser's cache, so later visits start straight away. The
   photo never leaves the worker: in comes a 1024 × 1024 copy, out goes the
   subject's mask at the same size. */

export type CutoutRequest = { type: 'run'; rgba: Uint8ClampedArray; gpu: boolean };
export type CutoutReply =
  | { type: 'progress'; stage: 'download' | 'start' | 'run'; done?: number; total?: number }
  | { type: 'mask'; mask: Uint8Array; backend: 'webgpu' | 'wasm'; ms: number }
  | { type: 'error'; message: string };

const PARTS = 5, SIZE = 90435581, CACHE = 'cut-studio-models-v1';
const part = (i: number) => `/models/isnet/isnet-fp16.onnx.part${i}`;

let ort: typeof Ort | null = null;
let session: Ort.InferenceSession | null = null;
let backend: 'webgpu' | 'wasm' = 'wasm';
let wanted = '';

const post = (message: CutoutReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

async function runtime() {
  if (ort) return ort;
  const base = new URL('/vendor/ort/', self.location.origin).href;
  ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${base}ort.webgpu.bundle.min.mjs`)) as typeof Ort;
  ort.env.wasm.wasmPaths = base;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  ort.env.logLevel = 'error';
  return ort;
}

/** One part, from the browser's cache when it is there. */
async function fetchPart(i: number, cache: Cache | null): Promise<ArrayBuffer> {
  const url = part(i), hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  let response: Response;
  try { response = await fetch(url); } catch { throw new Error('The AI model could not be downloaded. Check the connection and try again.'); }
  if (!response.ok) throw new Error('The AI model could not be downloaded. Check the connection and try again.');
  const body = await response.arrayBuffer();
  try { await cache?.put(url, new Response(body.slice(0))); } catch { /* storage full or private window: download again next time */ }
  return body;
}

async function model(): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { cache = null; }
  const bytes = new Uint8Array(SIZE);
  let done = 0;
  post({ type: 'progress', stage: 'download', done, total: SIZE });
  // Two parts at a time: fast on a good line, gentle on a weak one.
  const order = Array.from({ length: PARTS }, (_, i) => i), offsets = order.map(i => i * 18 * 1024 * 1024);
  for (let i = 0; i < PARTS; i += 2) {
    const got = await Promise.all(order.slice(i, i + 2).map(k => fetchPart(k, cache).then(b => [k, b] as const)));
    for (const [k, b] of got) { bytes.set(new Uint8Array(b), offsets[k]); done += b.byteLength; }
    post({ type: 'progress', stage: 'download', done, total: SIZE });
  }
  if (done !== SIZE) throw new Error('The AI model could not be downloaded. Check the connection and try again.');
  return bytes;
}

async function load(gpu: boolean) {
  const key = String(gpu);
  if (session && wanted === key) return;
  const o = await runtime();
  const bytes = await model();
  post({ type: 'progress', stage: 'start' });
  await session?.release();
  session = null;
  if (gpu && 'gpu' in navigator) {
    try { session = await o.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); backend = 'webgpu'; }
    catch { session = null; }
  }
  if (!session) { session = await o.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); backend = 'wasm'; }
  wanted = key;
}

async function run(rgba: Uint8ClampedArray, gpu: boolean) {
  await load(gpu);
  if (!ort || !session) throw new Error('The model is not loaded.');
  post({ type: 'progress', stage: 'run' });
  // IS-Net takes planar RGB in 0 to 1, less a mean of 0.5.
  const n = SIDE * SIDE, input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { input[i] = rgba[i * 4] / 255 - 0.5; input[n + i] = rgba[i * 4 + 1] / 255 - 0.5; input[2 * n + i] = rgba[i * 4 + 2] / 255 - 0.5; }
  const started = performance.now();
  const tensor = new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]);
  const result = await session.run({ [session.inputNames[0]]: tensor });
  const output = result[session.outputNames[0]];
  const data = (await output.getData()) as Float32Array;
  output.dispose();
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = data[i] <= 0 ? 0 : data[i] >= 1 ? 255 : Math.round(data[i] * 255);
  post({ type: 'mask', mask, backend, ms: Math.round(performance.now() - started) }, [mask.buffer]);
}

self.onmessage = async (event: MessageEvent<CutoutRequest>) => {
  try { await run(event.data.rgba, event.data.gpu); }
  catch (cause) { post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) }); }
};
