/**
 * TWD97 TM2 (EPSG:3826, Transverse Mercator zone 121) to geographic longitude / latitude on GRS80.
 * Inverse series from Snyder, "Map Projections: A Working Manual" (USGS PP 1395), pp. 63–64.
 * Accuracy is well under a meter inside Taiwan, which is ample for district assignment.
 */

const A = 6_378_137; // GRS80 semi-major axis (m)
const F = 1 / 298.257222101; // GRS80 flattening
const K0 = 0.9999;
const LON0 = (121 * Math.PI) / 180;
const FALSE_EASTING = 250_000;

const E2 = F * (2 - F); // first eccentricity squared
const EP2 = E2 / (1 - E2); // second eccentricity squared

/** Converts TM2 easting / northing (m) to [longitude, latitude] in degrees. */
export function tm2ToLonLat(x: number, y: number): [number, number] {
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const c1 = EP2 * cos1 ** 2;
  const t1 = tan1 ** 2;
  const n1 = A / Math.sqrt(1 - E2 * sin1 ** 2);
  const r1 = (A * (1 - E2)) / (1 - E2 * sin1 ** 2) ** 1.5;
  const d = (x - FALSE_EASTING) / (n1 * K0);

  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon =
    LON0 +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5) / 120) / cos1;

  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}
