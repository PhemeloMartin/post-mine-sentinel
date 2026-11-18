/**
 * Local equirectangular projection for the national "orbital" scene.
 * 1 scene unit ≈ 1° of longitude at the projection latitude; north is −Z in three.js.
 */
export const LON0 = 24.7;
export const LAT0 = -28.6;
const COS0 = Math.cos((LAT0 * Math.PI) / 180);

export function project(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * COS0, -(lat - LAT0)];
}

/** Haversine distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dp = (lat2 - lat1) * toRad;
  const dl = (lon2 - lon1) * toRad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Location generalisation for low-clearance roles (information-security control):
 * snap coordinates to a ~5 km grid so the map cannot be used to find active shafts.
 */
export function generalise(lat: number, lon: number, cellDeg = 0.05): [number, number] {
  return [Math.round(lat / cellDeg) * cellDeg, Math.round(lon / cellDeg) * cellDeg];
}
