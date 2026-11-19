import type { RunwayEnd } from './types.ts';

const EARTH_R_M = 6371008.8;
const DEG = Math.PI / 180;

export function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed smallest difference a - b in degrees, in -180..180. */
export function angleDiff(a: number, b: number): number {
  let d = normDeg(a) - normDeg(b);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Position of (lat, lon) relative to a runway threshold, in metres.
 * Uses a local flat-earth projection, which is accurate to centimetres over a runway's length.
 */
export function runwayRelative(rw: RunwayEnd, lat: number, lon: number): { along: number; cross: number } {
  const dNorth = (lat - rw.thresholdLat) * DEG * EARTH_R_M;
  const dEast = (lon - rw.thresholdLon) * DEG * EARTH_R_M * Math.cos(rw.thresholdLat * DEG);
  const h = rw.headingTrue * DEG;
  // Unit vector along the runway: (east = sin h, north = cos h); right of it: (cos h, -sin h).
  const along = dEast * Math.sin(h) + dNorth * Math.cos(h);
  const cross = dEast * Math.cos(h) - dNorth * Math.sin(h);
  return { along, cross };
}

/** Offset a lat/lon by metres east/north. Used by tests and by the runway-end builder. */
export function offsetLatLon(lat: number, lon: number, eastM: number, northM: number): { lat: number; lon: number } {
  return {
    lat: lat + northM / EARTH_R_M / DEG,
    lon: lon + eastM / (EARTH_R_M * Math.cos(lat * DEG)) / DEG,
  };
}

/** Wind components relative to a heading. Positive headwind = on the nose, positive crosswind = from the right. */
export function windComponents(windFromDeg: number, windKt: number, headingDeg: number): { head: number; cross: number } {
  const rel = angleDiff(windFromDeg, headingDeg) * DEG;
  return { head: windKt * Math.cos(rel), cross: windKt * Math.sin(rel) };
}

/**
 * Pick the runway end the aircraft landed on: heading within 30 deg of the ground track,
 * touchdown between 300 m before the threshold and the runway end, and the smallest
 * centreline offset that is still within 1.5 runway widths.
 */
export function matchRunway(
  candidates: RunwayEnd[],
  lat: number,
  lon: number,
  trackDeg: number,
): RunwayEnd | null {
  let best: RunwayEnd | null = null;
  let bestCross = Infinity;
  for (const rw of candidates) {
    if (Math.abs(angleDiff(rw.headingTrue, trackDeg)) > 30) continue;
    const { along, cross } = runwayRelative(rw, lat, lon);
    if (along < -300 - (rw.displacedM ?? 0) || along > rw.lengthM) continue;
    if (Math.abs(cross) > Math.max(rw.widthM * 1.5, 45)) continue;
    if (Math.abs(cross) < bestCross) {
      bestCross = Math.abs(cross);
      best = rw;
    }
  }
  return best;
}
