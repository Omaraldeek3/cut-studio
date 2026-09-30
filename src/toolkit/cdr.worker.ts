import { CDR_WASM_URL, runCdr2xhtml } from './cdr-wasm';

/* Converts a CorelDRAW file in its own thread, so a large or broken file
   cannot freeze the page, and the page can stop it after a time limit. */

let converter: Promise<WebAssembly.Module> | null = null;

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer }>) => {
  try {
    converter ??= WebAssembly.compileStreaming(fetch(CDR_WASM_URL));
    const run = runCdr2xhtml(await converter, new Uint8Array(event.data.bytes));
    // Exit code 1 is cdr2xhtml's "unsupported, encrypted or unreadable".
    if (run.code !== 0) self.postMessage({ failed: run.stderr.includes('Unsupported') ? 'unsupported' : 'parse' });
    else self.postMessage({ xhtml: run.stdout });
  } catch (error) {
    converter = null;
    self.postMessage({ failed: error instanceof Error && /size limit/.test(error.message) ? 'size' : 'crash' });
  }
};
