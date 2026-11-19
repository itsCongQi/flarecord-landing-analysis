/**
 * Height gates: the state of the aircraft at the moment it last descended through a set of
 * heights before touchdown ("at 50 ft: pitch 2.5 deg, V/S -690 fpm ..."), read from the trace.
 */
import type { LandingTrace } from './types.ts';

export interface TracePoint {
  /** Seconds relative to touchdown (negative before). */
  t: number;
  /** Height above ground, ft. */
  agl: number;
  vs: number;
  pitch: number;
  ias: number;
  /** Pitch control input, -1..+1, pull positive. */
  elevator: number;
  g: number;
  /** Centreline offset, m (right positive), when a runway was matched. */
  centerline: number | null;
  /** Distance past the landing threshold, m (negative before it), when a runway was matched. */
  along: number | null;
}

export interface Gate extends TracePoint {
  /** Gate height in the unit it was asked for, or null for the touchdown row. */
  height: number | null;
}

/** Gate heights offered in each height unit. Only those the recording reaches are shown. */
export const GATE_HEIGHTS = { ft: [200, 100, 50, 30, 20, 10], m: [60, 30, 15, 10, 5, 3] } as const;

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lerpOpt(xs: (number | null)[] | undefined, i: number, f: number): number | null {
  if (!xs) return null;
  const a = xs[i];
  const b = xs[Math.min(i + 1, xs.length - 1)];
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return lerp(a, b, f);
}

/** All traced values at time t, interpolated between samples and clamped to the recording. */
export function traceAt(tr: LandingTrace, t: number): TracePoint {
  const n = tr.t.length;
  let i = 0;
  while (i < n - 2 && tr.t[i + 1] <= t) i++;
  const span = tr.t[Math.min(i + 1, n - 1)] - tr.t[i];
  const f = span > 0 ? Math.max(0, Math.min(1, (t - tr.t[i]) / span)) : 0;
  const j = Math.min(i + 1, n - 1);
  return {
    t: lerp(tr.t[i], tr.t[j], f),
    agl: lerp(tr.agl[i], tr.agl[j], f),
    vs: lerp(tr.vs[i], tr.vs[j], f),
    pitch: lerp(tr.pitch[i], tr.pitch[j], f),
    ias: lerp(tr.ias[i], tr.ias[j], f),
    elevator: lerp(tr.elevator[i], tr.elevator[j], f),
    g: lerp(tr.g[i], tr.g[j], f),
    centerline: lerpOpt(tr.centerline, i, f),
    along: lerpOpt(tr.along, i, f),
  };
}

/**
 * The time (seconds to touchdown, negative) the aircraft last descended through a height, or null
 * when the recording starts below it. Walking back from touchdown means a balloon or a float
 * that climbs back through the height does not move the gate: it is the final crossing.
 */
export function crossingTime(tr: LandingTrace, heightFt: number): number | null {
  let td = tr.t.findIndex((t) => t >= 0);
  if (td < 0) td = tr.t.length - 1;
  for (let i = td - 1; i >= 0; i--) {
    if (tr.agl[i] >= heightFt) {
      const a = tr.agl[i];
      const b = tr.agl[i + 1];
      const f = a - b > 1e-9 ? (a - heightFt) / (a - b) : 0;
      return lerp(tr.t[i], tr.t[i + 1], Math.max(0, Math.min(1, f)));
    }
  }
  return null;
}

/** Gates the recording reaches, highest first, then the touchdown itself. */
export function heightGates(tr: LandingTrace, unit: 'ft' | 'm'): Gate[] {
  const out: Gate[] = [];
  for (const h of GATE_HEIGHTS[unit]) {
    const t = crossingTime(tr, unit === 'ft' ? h : h * 3.280839895);
    if (t !== null) out.push({ ...traceAt(tr, t), height: h });
  }
  out.push({ ...traceAt(tr, 0), height: null });
  return out;
}
