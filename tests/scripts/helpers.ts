/** Test helpers that build small binary fixtures (ZIP, ODS, shapefile, DBF) in memory. */
import { deflateRawSync } from 'node:zlib';

/** Builds a ZIP archive. Entries are deflated unless `store` is true. Names are flagged as UTF-8. */
export function makeZip(entries: readonly { name: string; data: Buffer | string; store?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const body = e.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const method = e.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Builds a minimal ODS file whose first table has the given rows of cell texts. */
export function makeOds(rows: readonly (readonly string[])[]): Buffer {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = rows
    .map((r) => `<table:table-row>${r.map((c) => `<table:table-cell><text:p>${esc(c)}</text:p></table:table-cell>`).join('')}</table:table-row>`)
    .join('');
  const xml = `<?xml version="1.0"?><office:document-content><office:body><table:table>${body}</table:table></office:body></office:document-content>`;
  return makeZip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet', store: true }, { name: 'content.xml', data: xml }]);
}

/** Builds a DBF file with character fields. */
export function makeDbf(fields: readonly { name: string; length: number }[], records: readonly (readonly string[])[]): Buffer {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0);
  const header = Buffer.alloc(headerLength);
  header[0] = 3;
  header.writeUInt32LE(records.length, 4);
  header.writeUInt16LE(headerLength, 8);
  header.writeUInt16LE(recordLength, 10);
  fields.forEach((f, i) => {
    header.write(f.name, 32 + i * 32, 'latin1');
    header[32 + i * 32 + 11] = 0x43; // 'C'
    header[32 + i * 32 + 16] = f.length;
  });
  header[headerLength - 1] = 0x0d;
  const rows = records.map((r) => {
    const row = Buffer.alloc(recordLength, 0x20);
    let o = 1;
    fields.forEach((f, i) => {
      Buffer.from(r[i] ?? '', 'utf8').copy(row, o, 0, f.length);
      o += f.length;
    });
    return row;
  });
  return Buffer.concat([header, ...rows]);
}

function shpHeader(shapeType: number, fileBytes: number): Buffer {
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE(fileBytes / 2, 24);
  h.writeInt32LE(1000, 28);
  h.writeInt32LE(shapeType, 32);
  return h;
}

/** Builds a Polygon (type 5) .shp where each record is a list of rings of [x, y] points. */
export function makePolygonShp(records: readonly (readonly (readonly [number, number])[][])[]): Buffer {
  const parts = records.map((rings, i) => {
    const points = rings.flat();
    const content = Buffer.alloc(44 + rings.length * 4 + points.length * 16);
    content.writeInt32LE(5, 0);
    content.writeInt32LE(rings.length, 36);
    content.writeInt32LE(points.length, 40);
    let start = 0;
    rings.forEach((r, k) => {
      content.writeInt32LE(start, 44 + k * 4);
      start += r.length;
    });
    points.forEach(([x, y], k) => {
      content.writeDoubleLE(x, 44 + rings.length * 4 + k * 16);
      content.writeDoubleLE(y, 44 + rings.length * 4 + k * 16 + 8);
    });
    const recHeader = Buffer.alloc(8);
    recHeader.writeInt32BE(i + 1, 0);
    recHeader.writeInt32BE(content.length / 2, 4);
    return Buffer.concat([recHeader, content]);
  });
  const body = Buffer.concat(parts);
  return Buffer.concat([shpHeader(5, 100 + body.length), body]);
}

/** Builds a Point (type 1) .shp. */
export function makePointShp(points: readonly (readonly [number, number])[]): Buffer {
  const parts = points.map(([x, y], i) => {
    const content = Buffer.alloc(20);
    content.writeInt32LE(1, 0);
    content.writeDoubleLE(x, 4);
    content.writeDoubleLE(y, 12);
    const recHeader = Buffer.alloc(8);
    recHeader.writeInt32BE(i + 1, 0);
    recHeader.writeInt32BE(10, 4);
    return Buffer.concat([recHeader, content]);
  });
  const body = Buffer.concat(parts);
  return Buffer.concat([shpHeader(1, 100 + body.length), body]);
}

/** Async iterable over lines, for stream-based parsers. */
export async function* linesOf(text: string): AsyncIterable<string> {
  for (const line of text.split('\n')) yield line;
}
