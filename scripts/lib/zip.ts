/**
 * Minimal ZIP reader (stored and deflate entries) using the central directory.
 * Enough for shapefile archives and ODS spreadsheets; no ZIP64 or encryption support.
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly size: number;
  read(): Buffer;
}

export function readZip(buf: Buffer): ZipEntry[] {
  // Find the End Of Central Directory record (signature 0x06054b50) near the end of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    // Bit 11 marks UTF-8 names; otherwise names are in a legacy code page (Big5 for Taiwan sources).
    const name = flags & 0x800 ? rawName.toString('utf8') : new TextDecoder('big5').decode(rawName);
    entries.push({
      name,
      size,
      read() {
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLen + localExtraLen;
        const data = buf.subarray(start, start + compressedSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
        throw new Error(`unsupported compression method ${method} for ${name}`);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Reads the cell text of every row of the first table in an ODS spreadsheet. */
export function readOdsRows(buf: Buffer): string[][] {
  const content = readZip(buf).find((e) => e.name === 'content.xml');
  if (!content) throw new Error('not an ODS file (no content.xml)');
  const xml = content.read().toString('utf8');
  const unescape = (s: string) =>
    s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return [...xml.matchAll(/<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g)].map((row) =>
    [...(row[1] ?? '').matchAll(/<text:p>([\s\S]*?)<\/text:p>/g)].map((m) => unescape(m[1] ?? '').trim()),
  );
}
