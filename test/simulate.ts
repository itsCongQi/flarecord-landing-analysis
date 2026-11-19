/**
 * Synthetic approach-and-landing generator, used to exercise the analysis core without the sim.
 * Produces 20 Hz samples for a straight-in 3 degree approach onto a runway heading 270.
 */
import { offsetLatLon } from '../PackageSources/Flarecord/src/core/geo.ts';
import type { RunwayEnd, Sample } from '../PackageSources/Flarecord/src/core/types.ts';

export const RUNWAY: RunwayEnd = {
  airportIdent: 'KTST',
  designation: '27',
  thresholdLat: 40.0,
  thresholdLon: -100.0,
  headingTrue: 270,
  lengthM: 3000,
  widthM: 45,
};

export interface Scenario {
  /** Height where the pilot starts the flare, ft. 0 = no flare at all. */
  flareAt: number;
  /** Sink rate at touchdown after the flare, fpm (positive number). */
  touchdownSink: number;
  /** Lateral offset from centreline, metres (positive = right). */
  lateralM: number;
  /** Crab angle held at touchdown, degrees. */
  crabDeg: number;
  /** Bounce: seconds airborne after first contact (0 = none). */
  bounceS: number;
  /** Extra float seconds just above the runway before contact. */
  floatS: number;
  windDir: number;
  windSpd: number;
}

export const DEFAULT: Scenario = {
  flareAt: 30,
  touchdownSink: 140,
  lateralM: 0.8,
  crabDeg: 0.5,
  bounceS: 0,
  floatS: 0,
  windDir: 280,
  windSpd: 8,
};

export function simulate(sc: Partial<Scenario> = {}): Sample[] {
  const s: Scenario = { ...DEFAULT, ...sc };
  const out: Sample[] = [];
  const dt = 0.05;
  const gsKt = 135;
  const gsMs = gsKt * 0.514444;
  const approachVs = -Math.tan((3 * Math.PI) / 180) * gsMs * 196.85; // fpm, about -716
  const approachPitch = 2.5;
  const flarePitch = 5.5;

  let t = 1000;
  let agl = 700;
  let vs = approachVs;
  let pitch = approachPitch;
  let elevator = 0.05;
  // Aim to touch down ~400 m past the threshold: work out where along-track we start.
  // Rough: time to descend = agl / |vs| plus flare time.
  let along = 400 - gsMs * (700 / Math.abs(approachVs)) * 60 - gsMs * 3;
  let groundT = 0;
  let onGround = false;
  let phase: 'approach' | 'flare' | 'float' | 'ground' | 'bounce' = 'approach';
  let floatLeft = s.floatS;
  let bounceLeft = s.bounceS;
  let gs = gsKt;
  let g = 1.0;
  let flareStartAgl = s.flareAt;

  for (let i = 0; i < 20 * 120; i++) {
    t += dt;
    if (phase === 'approach') {
      if (s.flareAt > 0 && agl <= s.flareAt) {
        phase = 'flare';
        flareStartAgl = agl;
      }
    }
    if (phase === 'flare') {
      // Sink rate eases from approach value towards touchdown value as height is lost.
      const frac = Math.min(1, Math.max(0, 1 - agl / flareStartAgl));
      vs = approachVs + (approachVs * -1 - s.touchdownSink) * Math.sqrt(frac);
      pitch = approachPitch + (flarePitch - approachPitch) * Math.min(1, frac * 1.6);
      elevator = 0.05 + 0.4 * Math.min(1, frac * 1.6);
      if (agl < 2 && floatLeft > 0) phase = 'float';
    }
    if (phase === 'float') {
      vs = -10;
      floatLeft -= dt;
      if (floatLeft <= 0) {
        phase = 'flare';
        floatLeft = 0;
        vs = -s.touchdownSink;
      }
    }
    if (phase === 'bounce') {
      bounceLeft -= dt;
      agl = Math.max(0, 1.5 * Math.sin((Math.PI * (s.bounceS - bounceLeft)) / s.bounceS));
      vs = 0;
      onGround = false;
      if (bounceLeft <= 0) {
        phase = 'ground';
        agl = 0;
      }
    } else if (phase !== 'ground') {
      agl += (vs / 60) * dt * 3.28084 * 0.3048; // vs is fpm -> ft per step
      if (agl <= 0) {
        agl = 0;
        if (!onGround && out.every((x) => !x.onGround)) {
          // First contact.
          g = 1 + Math.min(1.5, s.touchdownSink / 600);
          onGround = true;
          phase = s.bounceS > 0 ? 'bounce' : 'ground';
          vs = -s.touchdownSink;
        } else {
          onGround = true;
          phase = 'ground';
        }
      }
    }
    if (phase === 'ground') {
      onGround = true;
      vs = 0;
      pitch = Math.max(0, pitch - 1.2 * dt);
      gs = Math.max(0, gs - 4 * dt);
      elevator = Math.max(0, elevator - 0.2 * dt);
      g = g > 1 ? Math.max(1, g - 2 * dt) : 1;
    }
    along += gs * 0.514444 * dt;
    // On the ground the track wanders off the touchdown offset, then settles back towards the centreline.
    if (phase === 'ground') groundT += dt;
    const lateral = s.lateralM * Math.exp(-groundT / 12) + (1.5 + Math.abs(s.lateralM) * 0.5) * Math.sin(groundT * 0.3) * Math.exp(-groundT / 10);
    const pos = offsetLatLon(RUNWAY.thresholdLat, RUNWAY.thresholdLon, -along, lateral); // runway 270: along = west, right = north
    const sample: Sample = {
      t,
      agl,
      vs: phase === 'ground' ? 0 : vs,
      ias: gs - 3,
      gs,
      pitch,
      bank: 0.4,
      heading: (270 + s.crabDeg + 360) % 360,
      track: 270,
      g,
      elevator,
      onGround,
      lat: pos.lat,
      lon: pos.lon,
      windDir: s.windDir,
      windSpd: s.windSpd,
    };
    out.push(sample);
    if (onGround && gs < 25) break;
  }
  return out;
}
