/**
 * Synthetic takeoff generator, used to exercise the takeoff analysis without the sim. Produces
 * 20 Hz samples for a takeoff along the test runway (heading 270): standing, the roll, the
 * rotation, liftoff and the climb.
 */
import { offsetLatLon } from '../PackageSources/Flarecord/src/core/geo.ts';
import type { Sample } from '../PackageSources/Flarecord/src/core/types.ts';
import { RUNWAY } from './simulate.ts';

export interface TakeoffScenario {
  /** Where the roll begins, metres from the landing threshold. */
  startM: number;
  /** Indicated airspeed at which the pull begins, kt. */
  vr: number;
  /** Pitch rate held during the rotation, degrees per second. 0 = flown off without a rotation. */
  rotRate: number;
  /** Pitch at which the wheels leave the ground, degrees. */
  liftoffPitch: number;
  climbPitch: number;
  /** Abandon the takeoff on reaching this ground speed, kt. 0 = never. */
  rejectAtGs: number;
  /** Largest distance from the centreline during the roll, metres (positive = right). */
  lateralM: number;
  headwind: number;
  /** Height where power is reduced, feet. */
  thrustRedFt: number;
  /** Stop the generated flight at this height, feet. */
  untilFt: number;
  /** Height the simulator reports with the wheels on the ground, feet. */
  aglOffset: number;
}

export const TAKEOFF: TakeoffScenario = { startM: 100, vr: 140, rotRate: 3, liftoffPitch: 8.5, climbPitch: 15, rejectAtGs: 0, lateralM: -2, headwind: 6, thrustRedFt: 1500, untilFt: 3200, aglOffset: 0 };

export function simulateTakeoff(sc: Partial<TakeoffScenario> = {}): Sample[] {
  const s: TakeoffScenario = { ...TAKEOFF, ...sc };
  const out: Sample[] = [];
  const dt = 0.05;
  let t = 500;
  let gs = 0;
  let along = s.startM;
  let pitch = 0.3;
  let rate = 0;
  let h = 0;
  let vs = 0;
  let n1 = 22;
  let rotating = false;
  let airborne = false;
  let rejecting = false;
  let rollT = -5; // 5 s standing before the brakes are released
  for (let i = 0; i < 20 * 400; i++) {
    t += dt;
    rollT += dt;
    const ias = Math.max(0, gs + s.headwind);
    if (rollT >= 0) {
      if (s.rejectAtGs > 0 && gs >= s.rejectAtGs) rejecting = true;
      const target = rejecting ? 22 : h >= s.thrustRedFt ? 83 : rollT < 4 ? 22 + 66 * (rollT / 4) : 88;
      n1 += Math.max(-8 * dt, Math.min(20 * dt, target - n1));
      if (!airborne) {
        gs = Math.max(0, gs + (rejecting ? -6 : 4.4 * ((n1 - 22) / 66) - 0.0045 * gs) * dt);
        if (!rejecting && s.rotRate > 0 && ias >= s.vr) rotating = true;
        if (rotating) {
          rate = Math.min(s.rotRate, rate + 4 * dt);
          pitch += rate * dt;
          if (pitch >= s.liftoffPitch) airborne = true;
        } else if (s.rotRate === 0 && ias >= s.vr) {
          // Flown off in the ground attitude.
          airborne = true;
        }
      } else {
        const want = h >= s.thrustRedFt ? 9 : s.climbPitch;
        rate = Math.max(-1, Math.min(s.rotRate || 1, (want - pitch) * 1.2));
        pitch += rate * dt;
        vs = Math.min(h >= s.thrustRedFt ? 1500 : 2800, vs + 600 * dt);
        h += (vs / 60) * dt;
        gs = Math.min(h >= s.thrustRedFt ? 240 : s.vr + 16, gs + 1.5 * dt);
      }
    }
    along += gs * 0.514444 * dt;
    const rolled = along - s.startM;
    const lateral = s.lateralM * Math.exp(-Math.pow((rolled - 600) / 350, 2));
    const pos = offsetLatLon(RUNWAY.thresholdLat, RUNWAY.thresholdLon, -along, lateral);
    out.push({
      t,
      agl: h + s.aglOffset,
      vs: airborne ? vs : 0,
      ias,
      gs,
      pitch,
      bank: airborne && h < 400 ? 1.5 : 0.2,
      heading: 270,
      track: 270,
      g: 1,
      elevator: rotating && !airborne ? 0.35 : 0.03,
      onGround: !airborne,
      lat: pos.lat,
      lon: pos.lon,
      windDir: 270,
      windSpd: s.headwind,
      alt: 430 + h,
      power: n1,
      powerSpread: 0,
      powerKind: 'n1',
      gearDown: h < 90,
      flaps: gs + s.headwind < 190 ? 1 : 0,
      aoa: 3,
      wow: airborne ? 0 : rotating ? 3 : 7,
    });
    if (h >= s.untilFt) break;
    if (rejecting && gs < 10) break;
  }
  return out;
}
