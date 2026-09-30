/* Runs libcdr's cdr2xhtml, compiled to WebAssembly (native/cdr/build.sh), on
   one CorelDRAW file held in memory. The module is a WASI command: it reads
   the file named on its command line and writes the converted pages to
   standard output. This is the small part of WASI it needs, with one read-only
   file and no access to anything else on the computer. */

export const CDR_WASM_URL = '/wasm/cdr2xhtml.wasm';
const INPUT = 'input.cdr';
const MAX_OUTPUT = 64 * 1024 * 1024;

// WASI error numbers.
const SUCCESS = 0, EBADF = 8, EINVAL = 28, ENOENT = 44, ENOTCAPABLE = 76;
// File types.
const CHARACTER_DEVICE = 2, DIRECTORY = 3, REGULAR_FILE = 4;
// File descriptors: 0–2 are the standard streams, 3 the only directory, 4 the file once opened.
const ROOT = 3, FILE = 4;

class Exit extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

export type CdrRun = { code: number; stdout: string; stderr: string };

/** Runs the converter on `input` and returns its exit code and output. */
export function runCdr2xhtml(module: WebAssembly.Module, input: Uint8Array): CdrRun {
  // The module's memory, known once it is instantiated; the calls below only run after that.
  const memory = { buffer: new ArrayBuffer(0) as ArrayBufferLike };
  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const args = ['cdr2xhtml', `/${INPUT}`].map(a => new TextEncoder().encode(`${a}\0`));
  const out: Uint8Array[] = [], err: Uint8Array[] = [];
  let outLength = 0, errLength = 0, position = 0, open = false;

  // Embedded bitmaps come out as data: URIs, often hundreds of megabytes of
  // base64. They are never cutting geometry (cdr-pages removes every image),
  // so their data is dropped as it is written: ="data:…" becomes ="data:".
  const needle = new TextEncoder().encode('="data:');
  let matched = 0, skipping = false;
  const dropEmbedded = (chunk: Uint8Array) => {
    const kept = new Uint8Array(chunk.length);
    let n = 0;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (skipping) { if (b === 0x22) { skipping = false; kept[n++] = b; } continue; }
      kept[n++] = b;
      if (b === needle[matched]) { if (++matched === needle.length) { skipping = true; matched = 0; } }
      else matched = b === needle[0] ? 1 : 0;
    }
    return kept.subarray(0, n);
  };
  const readString = (at: number, length: number) => new TextDecoder().decode(bytes().subarray(at, at + length));
  const iovecs = (at: number, count: number) => Array.from({ length: count }, (_, i) => ({ buf: view().getUint32(at + i * 8, true), len: view().getUint32(at + i * 8 + 4, true) }));
  const fileType = (fd: number) => (fd <= 2 ? CHARACTER_DEVICE : fd === ROOT ? DIRECTORY : fd === FILE && open ? REGULAR_FILE : -1);

  const wasi = {
    args_sizes_get(countAt: number, sizeAt: number) {
      view().setUint32(countAt, args.length, true);
      view().setUint32(sizeAt, args.reduce((s, a) => s + a.length, 0), true);
      return SUCCESS;
    },
    args_get(pointersAt: number, bufferAt: number) {
      for (const [i, a] of args.entries()) { view().setUint32(pointersAt + i * 4, bufferAt, true); bytes().set(a, bufferAt); bufferAt += a.length; }
      return SUCCESS;
    },
    environ_sizes_get(countAt: number, sizeAt: number) { view().setUint32(countAt, 0, true); view().setUint32(sizeAt, 0, true); return SUCCESS; },
    environ_get() { return SUCCESS; },
    clock_time_get(_id: number, _precision: bigint, at: number) { view().setBigUint64(at, BigInt(Math.round(performance.now() * 1e6)), true); return SUCCESS; },
    fd_fdstat_get(fd: number, at: number) {
      const type = fileType(fd);
      if (type < 0) return EBADF;
      bytes().fill(0, at, at + 24);
      view().setUint8(at, type);
      view().setBigUint64(at + 8, BigInt("0xffffffffffffffff"), true);
      view().setBigUint64(at + 16, BigInt("0xffffffffffffffff"), true);
      return SUCCESS;
    },
    fd_fdstat_set_flags(fd: number) { return fileType(fd) < 0 ? EBADF : SUCCESS; },
    fd_prestat_get(fd: number, at: number) {
      if (fd !== ROOT) return EBADF;
      view().setUint8(at, 0);
      view().setUint32(at + 4, 1, true);
      return SUCCESS;
    },
    fd_prestat_dir_name(fd: number, at: number, length: number) {
      if (fd !== ROOT || length < 1) return fd !== ROOT ? EBADF : EINVAL;
      bytes()[at] = 0x2f; // "/"
      return SUCCESS;
    },
    path_open(dir: number, _dirflags: number, pathAt: number, pathLength: number, oflags: number, _rights: bigint, _inherit: bigint, _fdflags: number, fdAt: number) {
      if (dir !== ROOT) return EBADF;
      if (readString(pathAt, pathLength).replace(/^\.?\//, '') !== INPUT) return ENOENT;
      if (oflags & 0b1101) return ENOTCAPABLE; // create, exclusive or truncate
      open = true; position = 0;
      view().setUint32(fdAt, FILE, true);
      return SUCCESS;
    },
    path_filestat_get(dir: number, _flags: number, pathAt: number, pathLength: number, at: number) {
      if (dir !== ROOT) return EBADF;
      const name = readString(pathAt, pathLength).replace(/^\.?\//, '');
      if (name !== INPUT && name !== '' && name !== '.') return ENOENT;
      bytes().fill(0, at, at + 64);
      view().setUint8(at + 16, name === INPUT ? REGULAR_FILE : DIRECTORY);
      view().setBigUint64(at + 24, BigInt(1), true);
      view().setBigUint64(at + 32, BigInt(name === INPUT ? input.length : 0), true);
      return SUCCESS;
    },
    fd_read(fd: number, iovs: number, count: number, readAt: number) {
      if (fd !== FILE || !open) return fd === 0 ? (view().setUint32(readAt, 0, true), SUCCESS) : EBADF;
      let total = 0;
      for (const { buf, len } of iovecs(iovs, count)) {
        const chunk = input.subarray(position, position + len);
        bytes().set(chunk, buf);
        position += chunk.length; total += chunk.length;
        if (chunk.length < len) break;
      }
      view().setUint32(readAt, total, true);
      return SUCCESS;
    },
    fd_seek(fd: number, offset: bigint, whence: number, at: number) {
      if (fd !== FILE || !open) return EBADF;
      const base = whence === 0 ? 0 : whence === 1 ? position : whence === 2 ? input.length : NaN;
      const next = base + Number(offset);
      if (!Number.isFinite(next) || next < 0) return EINVAL;
      position = next;
      view().setBigUint64(at, BigInt(position), true);
      return SUCCESS;
    },
    fd_write(fd: number, iovs: number, count: number, writtenAt: number) {
      if (fd !== 1 && fd !== 2) return EBADF;
      let total = 0;
      for (const { buf, len } of iovecs(iovs, count)) {
        total += len;
        if (fd === 1) {
          const chunk = dropEmbedded(bytes().subarray(buf, buf + len));
          outLength += chunk.length;
          if (outLength > MAX_OUTPUT) throw new Error('Converted CDR exceeds the output size limit.');
          out.push(chunk);
        } else if (errLength < 64 * 1024) { errLength += len; err.push(bytes().slice(buf, buf + len)); }
      }
      view().setUint32(writtenAt, total, true);
      return SUCCESS;
    },
    fd_close(fd: number) {
      if (fd === FILE && open) { open = false; return SUCCESS; }
      return fd <= ROOT ? SUCCESS : EBADF;
    },
    path_unlink_file() { return ENOTCAPABLE; },
    path_remove_directory() { return ENOTCAPABLE; },
    proc_exit(code: number) { throw new Exit(code); },
  };

  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi as unknown as WebAssembly.ModuleImports });
  const exported = instance.exports.memory as WebAssembly.Memory;
  Object.defineProperty(memory, 'buffer', { get: () => exported.buffer });
  let code = 0;
  try { (instance.exports._start as () => void)(); } catch (e) { if (e instanceof Exit) code = e.code; else throw e; }
  const join = (parts: Uint8Array[], length: number) => { const all = new Uint8Array(length); let at = 0; for (const p of parts) { all.set(p, at); at += p.length; } return new TextDecoder().decode(all); };
  return { code, stdout: join(out, outLength), stderr: join(err, errLength) };
}
