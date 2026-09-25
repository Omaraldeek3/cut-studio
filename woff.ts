/** Unpacks a WOFF 1.0 font into the plain TrueType/OpenType bytes HarfBuzz
 *  reads. Each table is zlib-compressed on its own; the browser's
 *  DecompressionStream undoes that. A font that is not WOFF is returned as is. */
export async function woffToSfnt(input: ArrayBuffer | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x774f4646) return Uint8Array.from(bytes);
  const flavor = view.getUint32(4), count = view.getUint16(12);
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 44 + i * 20;
    return { tag: view.getUint32(at), offset: view.getUint32(at + 4), compressed: view.getUint32(at + 8), length: view.getUint32(at + 12), checksum: view.getUint32(at + 16) };
  });
  const data = await Promise.all(tables.map(async table => {
    const raw = bytes.subarray(table.offset, table.offset + table.compressed);
    if (table.compressed === table.length) return raw;
    const stream = new Blob([Uint8Array.from(raw)]).stream().pipeThrough(new DecompressionStream('deflate'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (out.length !== table.length) throw new Error('This font file is damaged.');
    return out;
  }));
  let searchRange = 1, entrySelector = 0;
  while (searchRange * 2 <= count) { searchRange *= 2; entrySelector++; }
  searchRange *= 16;
  let offset = 12 + count * 16;
  const offsets = data.map(d => { const at = offset; offset += (d.length + 3) & ~3; return at; });
  const out = new Uint8Array(offset);
  const o = new DataView(out.buffer);
  o.setUint32(0, flavor); o.setUint16(4, count); o.setUint16(6, searchRange); o.setUint16(8, entrySelector); o.setUint16(10, count * 16 - searchRange);
  tables.forEach((table, i) => {
    const record = 12 + i * 16;
    o.setUint32(record, table.tag); o.setUint32(record + 4, table.checksum); o.setUint32(record + 8, offsets[i]); o.setUint32(record + 12, data[i].length);
    out.set(data[i], offsets[i]);
  });
  return out;
}
