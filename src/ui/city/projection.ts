// Projection of [lon, lat] to City_View world units (city-3d design "Architecture").
// Spherical Mercator centred on 121.6 E, 25.0 N; 1 world unit = 100 m on the Mercator scale used by the Prototype.
// World x grows east, world z grows south (the ground lies in the XZ plane, y is up).

export type LonLat = readonly [number, number];
export type XZ = readonly [number, number];

const EARTH_RADIUS_M = 6_371_000;
const METRES_PER_UNIT = 100;
const SCALE = EARTH_RADIUS_M / METRES_PER_UNIT;
const LON0 = 121.6;
const LAT0 = 25.0;
const RAD = Math.PI / 180;

const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const Y0 = mercY(LAT0);

/** [lon, lat] in degrees → [x, z] in world units. */
export function project(p: LonLat): XZ {
  return [SCALE * (p[0] - LON0) * RAD, -SCALE * (mercY(p[1]) - Y0)];
}

/** Inverse of `project`. */
export function unproject(p: XZ): LonLat {
  const lon = p[0] / SCALE / RAD + LON0;
  const lat = (2 * Math.atan(Math.exp(-p[1] / SCALE + Y0)) - Math.PI / 2) / RAD;
  return [lon, lat];
}
