/**
 * Minimal Esri Shapefile reader for Polygon shapes (type 5) with DBF attributes.
 *
 * Rings keep the shapefile winding: exterior rings clockwise, holes counterclockwise (with x = lon,
 * y = lat). That is also the convention d3-geo expects for polygons smaller than a hemisphere.
 * Note that RFC 7946 GeoJSON recommends the opposite order.
 */

export type Position = readonly [number, number];
export type Ring = readonly Position[];
/** One polygon: exterior ring first, then holes. */
export type Polygon = readonly Ring[];

export interface ShapeRecord {
  readonly attributes: Readonly<Record<string, string>>;
  /** Polygons of this record; empty for null shapes. */
  readonly polygons: readonly Polygon[];
}

/** Reads DBF records as trimmed strings. `encoding` comes from the .cpg file (default UTF-8). */
export function readDbf(buf: Buffer, encoding = 'utf-8'): Record<string, string>[] {
  const count = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const fields: { name: string; length: number }[] = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0[\s\S]*$/, ''), length: buf[o + 16] ?? 0 });
  }
  const decoder = new TextDecoder(encoding);
  const records: Record<string, string>[] = [];
  for (let i = 0; i < count; i++) {
    let o = headerLength + i * recordLength + 1; // first byte is the deletion flag
    const record: Record<string, string> = {};
    for (const f of fields) {
      record[f.name] = decoder.decode(buf.subarray(o, o + f.length)).trim();
      o += f.length;
    }
    records.push(record);
  }
  return records;
}

/** Signed area by the trapezoid formula; positive for counterclockwise rings, negative for clockwise. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    a += (xj - xi) * (yj + yi);
  }
  return a / 2;
}

/** Ray-casting point-in-ring test. */
export function pointInRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Groups rings into polygons: clockwise rings are exteriors, others are holes of the smallest exterior containing them. */
export function assemblePolygons(rings: readonly Ring[]): Polygon[] {
  const exteriors = rings.filter((r) => signedArea(r) < 0);
  const holes = rings.filter((r) => signedArea(r) >= 0);
  const polygons = exteriors.map((r) => [r] as Ring[]);
  for (const hole of holes) {
    let best = -1;
    let bestArea = Infinity;
    exteriors.forEach((ext, i) => {
      const area = Math.abs(signedArea(ext));
      if (area < bestArea && pointInRing(hole[0]!, ext)) {
        best = i;
        bestArea = area;
      }
    });
    if (best >= 0) polygons[best]!.push(hole);
  }
  return polygons;
}

/** Reads the geometry of every record in a .shp file. Only Polygon (5) and null (0) shapes are supported. */
export function readShp(buf: Buffer): Polygon[][] {
  const shapeType = buf.readInt32LE(32);
  if (shapeType !== 5) throw new Error(`unsupported shape type ${shapeType} (only Polygon = 5)`);
  const out: Polygon[][] = [];
  let offset = 100;
  while (offset < buf.length) {
    const contentLength = buf.readInt32BE(offset + 4) * 2;
    const c = offset + 8;
    const type = buf.readInt32LE(c);
    if (type === 0) {
      out.push([]);
    } else if (type === 5) {
      const numParts = buf.readInt32LE(c + 36);
      const numPoints = buf.readInt32LE(c + 40);
      const partStarts: number[] = [];
      for (let p = 0; p < numParts; p++) partStarts.push(buf.readInt32LE(c + 44 + p * 4));
      const pointsAt = c + 44 + numParts * 4;
      const rings: Ring[] = [];
      for (let p = 0; p < numParts; p++) {
        const end = p + 1 < numParts ? partStarts[p + 1]! : numPoints;
        const ring: Position[] = [];
        for (let k = partStarts[p]!; k < end; k++) ring.push([buf.readDoubleLE(pointsAt + k * 16), buf.readDoubleLE(pointsAt + k * 16 + 8)]);
        rings.push(ring);
      }
      out.push(assemblePolygons(rings));
    } else {
      throw new Error(`unexpected shape type ${type} in record at byte ${offset}`);
    }
    offset = c + contentLength;
  }
  return out;
}

export function readShapefile(shp: Buffer, dbf: Buffer, encoding = 'utf-8'): ShapeRecord[] {
  const geometry = readShp(shp);
  const attributes = readDbf(dbf, encoding);
  if (geometry.length !== attributes.length) throw new Error(`.shp has ${geometry.length} records but .dbf has ${attributes.length}`);
  return attributes.map((a, i) => ({ attributes: a, polygons: geometry[i]! }));
}

/**
 * Reads the first point of every record in a Point (1), PointZ (11) or PointM (21) shapefile.
 * Coordinates are returned in the file's own coordinate system. Null shapes give undefined.
 */
export function readShpPoints(buf: Buffer): (Position | undefined)[] {
  const out: (Position | undefined)[] = [];
  let offset = 100;
  while (offset < buf.length) {
    const contentLength = buf.readInt32BE(offset + 4) * 2;
    const c = offset + 8;
    const type = buf.readInt32LE(c);
    if (type === 0) out.push(undefined);
    else if (type === 1 || type === 11 || type === 21) out.push([buf.readDoubleLE(c + 4), buf.readDoubleLE(c + 12)]);
    else throw new Error(`unexpected shape type ${type} in a point shapefile`);
    offset = c + contentLength;
  }
  return out;
}
