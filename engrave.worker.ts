import { adjust, toDots, toGray, type EngraveOptions } from './engrave';

self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number; options: EngraveOptions }>) => {
  try {
    const { data, width, height, options } = event.data;
    const dots = toDots(adjust(toGray(data, width, height), width, height, options), width, height, options);
    (self as unknown as Worker).postMessage({ dots, width, height }, [dots.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: error instanceof Error ? error.message : 'Engraving preparation failed.' });
  }
};
