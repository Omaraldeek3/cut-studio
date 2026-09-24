import { vectorize, type VectorizeOptions } from './vectorize';
import type { Raster } from './image';

self.onmessage = (event: MessageEvent<{ raster: Raster; options: VectorizeOptions }>) => {
  try {
    const started = performance.now();
    const result = vectorize(event.data.raster, event.data.options, (stage, fraction) => self.postMessage({ stage, fraction }));
    self.postMessage({ result, elapsed: performance.now() - started });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Vectorizing failed.' });
  }
};
