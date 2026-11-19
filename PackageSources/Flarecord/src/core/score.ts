import type { FlareInfo, ScoreBreakdown, TouchdownGeometry } from './types.ts';

export interface ScoreInput {
  touchdownVsFpm: number; // negative when descending
  peakG: number;
  bankDeg: number;
  pitchDeg: number;
  crabDeg: number;
  crosswindKt: number;
  bounces: number;
  flare: FlareInfo;
  geometry: TouchdownGeometry | null;
}

/** Linear ramp: full points at or below `good`, zero at or above `bad`. */
function ramp(value: number, good: number, bad: number, max: number): number {
  if (value <= good) return max;
  if (value >= bad) return 0;
  return max * (1 - (value - good) / (bad - good));
}

/**
 * Landing score out of 100. Categories that can't be measured (no runway matched) are left out
 * and the rest are scaled up, so a landing at an airport the addon can't find is still scored
 * fairly on what it did measure.
 *
 * Weights (this addon's own design):
 *   Sink rate 25, Peak G 15, Touchdown zone 20, Centreline 15, Alignment 10, Attitude 10, Bounce 5.
 */
export function scoreLanding(x: ScoreInput): ScoreBreakdown {
  const parts: ScoreBreakdown['parts'] = [];
  const sink = Math.abs(Math.min(0, x.touchdownVsFpm));

  parts.push({ key: 'sink', label: 'Sink rate', max: 25, points: ramp(sink, 150, 700, 25), note: `${Math.round(sink)} fpm` });
  parts.push({ key: 'g', label: 'Peak G', max: 15, points: ramp(x.peakG, 1.25, 2.0, 15), note: `${x.peakG.toFixed(2)} g` });

  if (x.geometry) {
    const d = x.geometry.distFromThresholdM;
    // Ideal aiming area 250..550 m; full credit there, nothing short of the threshold or past 1100 m.
    let tdz: number;
    if (d < 0) tdz = 0;
    else if (d < 250) tdz = 20 * (d / 250);
    else if (d <= 550) tdz = 20;
    else tdz = ramp(d, 550, 1100, 20);
    parts.push({ key: 'tdz', label: 'Touchdown zone', max: 20, points: tdz, note: `${Math.round(d)} m from threshold` });

    const off = Math.abs(x.geometry.centerlineOffsetM);
    parts.push({ key: 'cl', label: 'Centreline', max: 15, points: ramp(off, 1.5, 10, 15), note: `${off.toFixed(1)} m ${x.geometry.centerlineOffsetM >= 0 ? 'right' : 'left'}` });
  }

  // Some crab is expected in a crosswind; allow 1 deg plus 1 deg per 7.5 kt, capped at 4 deg.
  const crabAllow = Math.min(4, 1 + Math.abs(x.crosswindKt) / 7.5);
  parts.push({ key: 'align', label: 'Alignment', max: 10, points: ramp(Math.abs(x.crabDeg), crabAllow, crabAllow + 6, 10), note: `${x.crabDeg.toFixed(1)}° crab (±${crabAllow.toFixed(1)}° allowed)` });

  const bankPts = ramp(Math.abs(x.bankDeg), 2, 8, 6);
  const pitchPts = x.pitchDeg >= 0 ? (x.pitchDeg <= 9 ? 4 : ramp(x.pitchDeg, 9, 12, 4)) : ramp(-x.pitchDeg, 0, 2, 4);
  parts.push({ key: 'att', label: 'Attitude', max: 10, points: bankPts + pitchPts, note: `bank ${x.bankDeg.toFixed(1)}°, pitch ${x.pitchDeg.toFixed(1)}°` });

  parts.push({ key: 'bounce', label: 'No bounce', max: 5, points: x.bounces === 0 ? 5 : 0, note: x.bounces === 0 ? 'clean' : `${x.bounces} bounce${x.bounces > 1 ? 's' : ''}` });

  const got = parts.reduce((a, p) => a + p.points, 0);
  const max = parts.reduce((a, p) => a + p.max, 0);
  let total = Math.round((got / max) * 100);
  // A long float is wasted runway: a small deduction on top.
  if (x.flare.floatTimeS > 4) total = Math.max(0, total - Math.min(10, Math.round((x.flare.floatTimeS - 4) * 2)));

  const hard = sink > 600 || x.peakG > 1.8;
  const grade: ScoreBreakdown['grade'] = hard ? 'Hard' : total >= 90 ? 'Excellent' : total >= 75 ? 'Good' : total >= 60 ? 'Acceptable' : 'Firm';
  for (const p of parts) p.points = Math.round(p.points * 10) / 10;
  return { total, parts, grade };
}
