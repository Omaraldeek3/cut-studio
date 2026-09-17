import { processImage, traceImage, type ImageOptions, type Raster } from './image';

self.onmessage = (event: MessageEvent<{ raster: Raster; options: ImageOptions; tool: 'trace' | 'engrave'; dither: boolean }>) => {
  try {
    const { raster, options, tool, dither } = event.data;
    if (tool === 'trace') self.postMessage({ vector: traceImage(raster, options) });
    else {
      const result = processImage(raster, options, dither);
      self.postMessage({ raster: result }, { transfer: [result.data.buffer] });
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Image processing failed.' });
  }
};
