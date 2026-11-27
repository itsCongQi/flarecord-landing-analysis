/**
 * Turns the samples of one takeoff into its record: the roll, the rotation, the liftoff and the
 * climb. Plain functions, so they run under the tests with simulated flights.
 */
import { matchRunway, runwayRelative, windComponents } from './geo.ts';
import type { ClimbSummary, ClimbTrace, RunwayEnd, Sample, TakeoffRecord, TakeoffSummary, TakeoffTrace } from './types.ts';

/** The climb is followed to this height above the liftoff point, feet, or for this long, seconds. */
export const CLIMB_TOP_FT = 3000;
export const CLIMB_MAX_S = 180;
/** The roll and the first seconds in the air are kept at full rate until this long after liftoff, seconds. */
export const FINE_AFTER_S = 10;
/** A rotation is a pitch rate of at least this, degrees per second, that gains at least ROTATION_MIN_DEG by liftoff. */
export const ROTATION_RATE = 1;
export const ROTATION_MIN_DEG = 2;
const TRACE_STEP_S = 0.2;
const TRACE_BEFORE_MAX_S = 120;
const KT_TO_MS = 0.514444;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Pitch rate at sample i, degrees per second: the change over the 0.4 s around it. */
export function pitchRate(s: Sample[], i: number): number {
  let a = i;
  let b = i;
  while (a > 0 && s[i].t - s[a].t < 0.2 - 1e-6) a--;
  while (b < s.length - 1 && s[b].t - s[i].t < 0.2 - 1e-6) b++;
  const dt = s[b].t - s[a].t;
  return dt > 1e-6 ? (s[b].pitch - s[a].pitch) / dt : 0;
}

/**
 * Where the rotation began: the start of the last stretch of pitch rate at or above 1 deg/s that
 * runs up to liftoff (dips shorter than half a second do not end it, and it may stop up to 3 s
 * before liftoff). Null when pitch gained less than 2 degrees over it, as in an aircraft that is
 * flown off in its ground attitude.
 */
export function findRotation(s: Sample[], li: number): number | null {
  const tl = s[li].t;
  let end = -1;
  for (let i = li; i >= 0 && tl - s[i].t <= 3; i--) {
    if (pitchRate(s, i) >= ROTATION_RATE) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let start = end;
  for (let i = end - 1; i >= 0 && tl - s[i].t <= 15; i--) {
    if (pitchRate(s, i) >= ROTATION_RATE) start = i;
    else if (s[start].t - s[i].t > 0.5) break;
  }
  return s[li].pitch - s[start].pitch >= ROTATION_MIN_DEG ? start : null;
}

function median(xs: number[]): number {
  const v = xs.slice().sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 0;
}

export interface TakeoffInput {
  /** Every sample from the start of the roll to FINE_AFTER_S after liftoff (or to the end of a rejected takeoff). */
  fine: Sample[];
  /** Index in `fine` of the first sample in the air. -1 for a rejected takeoff. */
  liftoff: number;
  /** The climb at about one sample a second, from liftoff. */
  climb: Sample[];
  runways: RunwayEnd[];
  touchAndGo: boolean;
  aircraft: string;
  now: number;
}

export function buildTakeoff(inp: TakeoffInput): TakeoffRecord {
  const { fine } = inp;
  const rejected = inp.liftoff < 0;
  // The reference moment: liftoff, or the highest ground speed of a rejected takeoff.
  let ri = inp.liftoff;
  if (rejected) {
    ri = 0;
    for (let i = 1; i < fine.length; i++) if (fine[i].gs > fine[ri].gs) ri = i;
  }
  const ref = fine[ri];
  const last = fine[fine.length - 1];
  const runway = matchRunway(inp.runways, ref.lat, ref.lon, ref.track);
  const displaced = runway ? (runway.displacedM ?? 0) : 0;
  const rel = (s: Sample) => (runway ? runwayRelative(runway, s.lat, s.lon) : null);
  /** Distance from the start of the pavement, metres. */
  const fromStart = (s: Sample) => {
    const r = rel(s);
    return r ? r.along + displaced : null;
  };

  // Ground roll: along the runway when there is one, else the ground speed added up.
  let rollM = 0;
  const a0 = rel(fine[0]);
  const a1 = rel(ref);
  if (a0 && a1) rollM = a1.along - a0.along;
  else for (let i = 1; i <= ri; i++) rollM += ((fine[i].gs + fine[i - 1].gs) / 2) * KT_TO_MS * (fine[i].t - fine[i - 1].t);

  // Furthest from the centreline with the wheels on the ground.
  let far: Sample | null = null;
  let farCross = 0;
  if (runway) {
    const until = rejected ? fine.length - 1 : ri;
    for (let i = 0; i <= until; i++) {
      const c = runwayRelative(runway, fine[i].lat, fine[i].lon).cross;
      if (far === null || Math.abs(c) > Math.abs(farCross)) {
        far = fine[i];
        farCross = c;
      }
    }
  }

  // What the height reads with the wheels on the runway, so 0 ft is the ground in any aircraft.
  const offset = median(fine.slice(0, Math.max(1, rejected ? fine.length : ri)).filter((s) => s.onGround).map((s) => s.agl));
  const agl = (s: Sample) => s.agl - offset;
  /** Height above the liftoff point: by altitude, so rising or falling terrain plays no part. */
  const height = (s: Sample) => (s.alt !== undefined && ref.alt !== undefined ? s.alt - ref.alt : agl(s));

  const rot = rejected ? null : findRotation(fine, ri);
  let peak = 0;
  if (rot !== null) for (let i = rot; i <= ri; i++) peak = Math.max(peak, pitchRate(fine, i));

  let i35 = -1;
  if (!rejected) for (let i = ri; i < fine.length; i++) if (agl(fine[i]) >= 35) { i35 = i; break; }
  let s35: Sample | null = i35 >= 0 ? fine[i35] : null;
  if (!rejected && !s35) s35 = inp.climb.find((s) => agl(s) >= 35) ?? null;

  // Power over the last 3 s of the roll.
  const pw = fine.filter((s, i) => i <= ri && ref.t - s.t <= 3 && s.power !== null && s.power !== undefined).map((s) => s.power as number);
  const power = pw.length ? pw.reduce((a, b) => a + b, 0) / pw.length : null;
  const wind = windComponents(ref.windDir, ref.windSpd, ref.heading);
  const endRel = rel(last);

  const summary: TakeoffSummary = {
    id: `${inp.now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    recordedAt: inp.now,
    aircraft: inp.aircraft,
    kind: rejected ? 'rejected' : 'takeoff',
    touchAndGo: inp.touchAndGo,
    runway,
    startM: a0 ? Math.round(a0.along + displaced) : null,
    rollM: Math.round(rollM),
    rollS: round1(ref.t - fine[0].t),
    remainingM: runway ? Math.round(runway.lengthM - (rejected ? (endRel as { along: number }).along : (a1 as { along: number }).along)) : null,
    clMaxM: far ? round1(farCross) : null,
    clMaxStartM: far ? Math.round(fromStart(far) as number) : null,
    clMaxIasKt: far ? Math.round(far.ias) : null,
    liftoffClM: a1 ? round1(a1.cross) : null,
    rotIasKt: rot !== null ? Math.round(fine[rot].ias) : null,
    rotRateAvg: rot !== null && ref.t > fine[rot].t ? round1((ref.pitch - fine[rot].pitch) / (ref.t - fine[rot].t)) : null,
    rotRatePeak: rot !== null ? round1(peak) : null,
    rotToLiftoffS: rot !== null ? round1(ref.t - fine[rot].t) : null,
    liftoffPitchDeg: round1(ref.pitch),
    liftoffIasKt: Math.round(ref.ias),
    liftoffGsKt: Math.round(ref.gs),
    t35S: s35 ? round1(s35.t - ref.t) : null,
    ias35Kt: s35 ? Math.round(s35.ias) : null,
    pitch35Deg: s35 ? round1(s35.pitch) : null,
    headwindKt: round1(wind.head),
    crosswindKt: round1(wind.cross),
    windDirDeg: Math.round(ref.windDir),
    windKt: Math.round(ref.windSpd),
    flaps: ref.flaps ?? null,
    power: power === null ? null : round1(power),
    powerKind: ref.powerKind ?? null,
  };
  if (rejected) {
    summary.maxGsKt = Math.round(ref.gs);
    summary.maxIasKt = Math.round(Math.max(...fine.map((s) => s.ias)));
  }

  const trace = fineTrace(fine, ref.t, offset, runway, displaced);
  if (!rejected) {
    const c = analyzeClimb(fine, ri, inp.climb, height, runway, power);
    summary.climb = c.summary;
    trace.climb = c.trace;
  }
  return { summary, trace };
}

function analyzeClimb(fine: Sample[], li: number, climb: Sample[], height: (s: Sample) => number, runway: RunwayEnd | null, takeoffPower: number | null): { summary: ClimbSummary; trace: ClimbTrace } {
  const lo = fine[li];
  // Everything in the air in time order: the full-rate seconds, then the climb samples after them.
  const fineAir = fine.slice(li);
  const air = fineAir.concat(climb.filter((s) => s.t > fineAir[fineAir.length - 1].t));

  let runwayEndFt: number | null = null;
  let runwayEndS: number | null = null;
  if (runway) {
    for (let i = 1; i < air.length; i++) {
      const b = runwayRelative(runway, air[i].lat, air[i].lon).along;
      if (b < runway.lengthM) continue;
      const a = runwayRelative(runway, air[i - 1].lat, air[i - 1].lon).along;
      const f = b - a > 1e-6 ? Math.max(0, Math.min(1, (runway.lengthM - a) / (b - a))) : 1;
      runwayEndFt = Math.round(height(air[i - 1]) + (height(air[i]) - height(air[i - 1])) * f);
      runwayEndS = round1(air[i - 1].t + (air[i].t - air[i - 1].t) * f - lo.t);
      break;
    }
  }

  const gearUp = lo.gearDown === true ? air.find((s) => s.gearDown === false) : undefined;
  const flap = lo.flaps !== undefined ? air.find((s) => s.flaps !== undefined && s.flaps < (lo.flaps as number)) : undefined;

  // Thrust reduction: power clearly below its takeoff value and staying there for 3 s.
  let thrust: Sample | null = null;
  if (takeoffPower !== null) {
    const below = lo.powerKind === 'rpm' ? takeoffPower * 0.96 : takeoffPower - 3;
    for (let i = 0; i < air.length && !thrust; i++) {
      const p = air[i].power;
      if (p === null || p === undefined || p >= below) continue;
      let held = true;
      let j = i;
      for (; j < air.length && air[j].t - air[i].t <= 3; j++) {
        const q = air[j].power;
        if (q === null || q === undefined || q >= below) held = false;
      }
      // Counted only when the recording runs on for those 3 s.
      if (held && air[Math.min(j, air.length - 1)].t - air[i].t >= 3 - 1e-6) thrust = air[i];
    }
  }

  let bank = 0;
  let maxPitch = lo.pitch;
  let to1000: number | null = null;
  let top = 0;
  for (let i = 0; i < air.length; i++) {
    const h = height(air[i]);
    top = Math.max(top, h);
    if (h < 500 && Math.abs(air[i].bank) > Math.abs(bank)) bank = air[i].bank;
    maxPitch = Math.max(maxPitch, air[i].pitch);
    if (to1000 === null && h >= 1000 && i > 0) {
      const h0 = height(air[i - 1]);
      const f = h - h0 > 1e-6 ? (1000 - h0) / (h - h0) : 1;
      to1000 = round1(air[i - 1].t + (air[i].t - air[i - 1].t) * f - lo.t);
    }
  }

  // One point a second for the drawing.
  const tr: ClimbTrace = { t: [], h: [], vs: [], ias: [], gs: [], pitch: [], bank: [], power: [], flaps: [], gear: [] };
  let next = lo.t;
  for (const s of air) {
    if (s.t < next - 1e-3 && s !== air[air.length - 1]) continue;
    next = s.t + 1;
    tr.t.push(round1(s.t - lo.t));
    tr.h.push(Math.round(Math.max(0, height(s))));
    tr.vs.push(Math.round(s.vs));
    tr.ias.push(Math.round(s.ias));
    tr.gs.push(Math.round(s.gs));
    tr.pitch.push(round1(s.pitch));
    tr.bank.push(round1(s.bank));
    tr.power.push(s.power === null || s.power === undefined ? null : round1(s.power));
    tr.flaps.push(s.flaps ?? 0);
    tr.gear.push(s.gearDown === false ? 0 : 1);
  }

  return {
    summary: {
      topFt: Math.round(Math.min(CLIMB_TOP_FT, top)),
      runwayEndFt,
      runwayEndS,
      gearUpFt: gearUp ? Math.round(Math.max(0, height(gearUp))) : null,
      flapFt: flap ? Math.round(Math.max(0, height(flap))) : null,
      thrustRedFt: thrust ? Math.round(Math.max(0, height(thrust))) : null,
      bankMax500: round1(bank),
      to1000S: to1000,
      maxPitchDeg: round1(maxPitch),
    },
    trace: tr,
  };
}

/** The roll and the first seconds in the air on a fixed 5 Hz grid, t relative to the reference moment. */
function fineTrace(fine: Sample[], refT: number, offset: number, runway: RunwayEnd | null, displaced: number): TakeoffTrace {
  const tr: TakeoffTrace = { t: [], agl: [], pitch: [], rate: [], ias: [], gs: [], elevator: [], power: [], centerline: [], along: [] };
  const endT = fine[fine.length - 1].t;
  // Whole steps from the reference moment, so t = 0 is exactly on the grid.
  const first = Math.ceil((Math.max(fine[0].t, refT - TRACE_BEFORE_MAX_S) - refT) / TRACE_STEP_S - 1e-6);
  let j = 0;
  for (let k = first; refT + k * TRACE_STEP_S <= endT + 1e-6; k++) {
    const t = refT + k * TRACE_STEP_S;
    while (j < fine.length - 1 && fine[j + 1].t <= t + 1e-6) j++;
    const s = fine[j];
    tr.t.push(round1(k * TRACE_STEP_S));
    tr.agl.push(round1(Math.max(0, s.agl - offset)));
    tr.pitch.push(round1(s.pitch));
    tr.rate.push(round2(pitchRate(fine, j)));
    tr.ias.push(Math.round(s.ias));
    tr.gs.push(Math.round(s.gs));
    tr.elevator.push(round2(s.elevator));
    tr.power.push(s.power === null || s.power === undefined ? null : round1(s.power));
    const r = runway ? runwayRelative(runway, s.lat, s.lon) : null;
    tr.centerline.push(r ? round1(r.cross) : null);
    tr.along.push(r ? Math.round(r.along + displaced) : null);
  }
  return tr;
}
