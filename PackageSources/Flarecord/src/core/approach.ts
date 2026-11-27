/**
 * The approach flown to a landing: how far the aircraft was from the glidepath and the centreline,
 * and the height from which the approach was stable. Measured after the landing from the recorded
 * samples. It reports figures; it does not grade them.
 *
 * Height is above the runway: altitude minus the altitude at touchdown. Radio height is not used
 * on the approach because it follows the terrain under the aircraft.
 *
 * Deviation is worked out from position, not read from an ILS receiver, so it is there on every
 * runway whatever is tuned:
 *   vertical  the angle off a glidepath that passes 50 ft over the landing threshold, at the
 *             runway's own ILS angle when the navdata has one, otherwise 3.0 degrees.
 *             One dot is 0.35 degrees, as on an ILS (full scale 0.7 degrees).
 *   lateral   the angle off the centreline seen from a point 1,000 ft beyond the far end of the
 *             runway, where a localizer aerial stands. Full scale (two dots) is 350 ft either side
 *             at the threshold, the way a localizer is set up, kept between 1.5 and 3 degrees.
 */
import { runwayRelative } from './geo.ts';
import type { ApproachSummary, ApproachTrace, ConditionKey, ConditionResult, RunwayEnd, Sample } from './types.ts';

export const CONDITIONS: ConditionKey[] = ['config', 'speed', 'sink', 'glidepath', 'localizer', 'bank'];

export const STABLE = {
  /** Speed may be this much above or below the speed flown at 50 ft, kt. */
  speedAboveKt: 10,
  speedBelowKt: 5,
  /** Greatest sink rate, fpm. */
  sinkFpm: 1000,
  /** Greatest glidepath and lateral deviation, dots. */
  dots: 1,
  /** Greatest bank, degrees. */
  bankDeg: 7,
  /** A condition left for less than this long still counts as met, seconds. */
  graceS: 2,
  /** Conditions are judged down to this height above the runway, feet. */
  floorFt: 100,
  /** The search for the stable height stops here, feet. */
  topFt: 3000,
  /** Deviation maxima are taken from this height down to the floor, feet. */
  deviationFromFt: 1000,
};

const FT_PER_M = 3.280839895;
const DEG = Math.PI / 180;
export const DEFAULT_PATH_DEG = 3;
export const GS_DOT_DEG = 0.35;
const THRESHOLD_CROSSING_FT = 50;
const LOC_HALF_WIDTH_AT_THRESHOLD_M = 350 / FT_PER_M;
const LOC_AERIAL_PAST_END_M = 1000 / FT_PER_M;
/** A recording that covers less than this height is not analysed, feet. */
const MIN_TOP_FT = 300;
/** Climbing back by this much, going back in time, ends the final descent (a go-around before it), feet. */
const CLIMB_BREAK_FT = 100;
const TRACE_STEP_S = 2;
const TRACE_MAX_POINTS = 200;

/** The glidepath angle used for a runway end. */
export function pathAngle(rw: RunwayEnd): { deg: number; ils: boolean } {
  const g = rw.gsDeg;
  return g !== undefined && g >= 2 && g <= 6 ? { deg: g, ils: true } : { deg: DEFAULT_PATH_DEG, ils: false };
}

/** Glidepath deviation in dots, above positive. alongM is distance past the threshold (negative before it). */
export function glidepathDots(alongM: number, heightFt: number, pathDeg: number): number {
  // The path meets the runway where it has come down the 50 ft it had over the threshold.
  const originM = THRESHOLD_CROSSING_FT / FT_PER_M / Math.tan(pathDeg * DEG);
  const run = originM - alongM;
  if (run <= 1) return 0;
  const angle = Math.atan2(heightFt / FT_PER_M, run) / DEG;
  return (angle - pathDeg) / GS_DOT_DEG;
}

/** Lateral deviation in dots, right positive. */
export function localizerDots(rw: RunwayEnd, alongM: number, crossM: number): number {
  const aerialM = rw.lengthM + LOC_AERIAL_PAST_END_M;
  const full = Math.max(1.5, Math.min(3, Math.atan2(LOC_HALF_WIDTH_AT_THRESHOLD_M, aerialM) / DEG));
  const run = aerialM - alongM;
  if (run <= 1) return 0;
  return ((Math.atan2(crossM, run) / DEG) / full) * 2;
}

interface Point {
  s: Sample;
  /** Height above the runway, ft. */
  h: number;
  gs: number | null;
  loc: number | null;
  along: number | null;
  /** Conditions met, one bit each in the order of CONDITIONS. */
  met: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Analyse the approach. `approach` is the recorded airborne samples before contact, oldest first
 * (two a second is plenty); `contact` is the sample at first wheel contact.
 * Null when too little of the approach was recorded to say anything.
 */
export function analyzeApproach(approach: Sample[], contact: Sample, runway: RunwayEnd | null): { summary: ApproachSummary; trace: ApproachTrace } | null {
  const before = approach.filter((s) => s.t < contact.t && !s.onGround);
  if (before.length < 4) return null;
  // Height above the runway. Recordings without altitude fall back to radio height.
  const hasAlt = contact.alt !== undefined && before.every((s) => s.alt !== undefined);
  const height = (s: Sample) => (hasAlt ? (s.alt as number) - (contact.alt as number) : s.agl);

  // The final descent: back from touchdown until the top height, a gap in the recording, or the
  // point where the aircraft had been lower before (it climbed: an earlier approach, a go-around).
  let start = before.length - 1;
  let maxH = height(before[start]);
  for (let i = before.length - 2; i >= 0; i--) {
    const h = height(before[i]);
    if (before[i + 1].t - before[i].t > 6) break;
    if (h < maxH - CLIMB_BREAK_FT) {
      // Everything before the highest point belongs to the climb.
      while (height(before[start]) < maxH - 1e-6) start++;
      break;
    }
    start = i;
    maxH = Math.max(maxH, h);
    if (h >= STABLE.topFt) break;
  }
  const seg = before.slice(start);
  const topFt = Math.min(STABLE.topFt, maxH);
  if (topFt < MIN_TOP_FT) return null;

  const path = runway ? pathAngle(runway) : { deg: DEFAULT_PATH_DEG, ils: false };
  const crossing = (level: number): number | null => {
    // Index of the last sample at or above a height: the final descent through it.
    for (let i = seg.length - 1; i >= 0; i--) if (height(seg[i]) >= level) return i;
    return null;
  };
  const at = (level: number, pick: (s: Sample) => number | null | undefined): number | null => {
    const i = crossing(level);
    if (i === null) return null;
    const a = pick(seg[i]);
    if (a === null || a === undefined) return null;
    const next = i + 1 < seg.length ? seg[i + 1] : contact;
    const b = pick(next);
    const ha = height(seg[i]);
    const hb = i + 1 < seg.length ? height(next) : 0;
    if (b === null || b === undefined || ha - hb < 1e-6) return a;
    return a + (b - a) * Math.max(0, Math.min(1, (ha - level) / (ha - hb)));
  };

  const refIas = at(50, (s) => s.ias) ?? contact.ias;
  const landingFlaps = contact.flaps;
  const hasConfig = contact.gearDown !== undefined && landingFlaps !== undefined;

  const pts: Point[] = seg.map((s) => {
    const h = height(s);
    const rel = runway ? runwayRelative(runway, s.lat, s.lon) : null;
    const gs = rel ? glidepathDots(rel.along, h, path.deg) : null;
    const loc = rel && runway ? localizerDots(runway, rel.along, rel.cross) : null;
    const ok: Record<ConditionKey, boolean> = {
      config: hasConfig && s.gearDown === true && s.flaps === landingFlaps,
      speed: s.ias <= refIas + STABLE.speedAboveKt && s.ias >= refIas - STABLE.speedBelowKt,
      sink: s.vs >= -STABLE.sinkFpm,
      glidepath: gs !== null && Math.abs(gs) <= STABLE.dots,
      localizer: loc !== null && Math.abs(loc) <= STABLE.dots,
      bank: Math.abs(s.bank) <= STABLE.bankDeg,
    };
    let met = 0;
    CONDITIONS.forEach((k, n) => {
      if (ok[k]) met |= 1 << n;
    });
    return { s, h, gs, loc, along: rel ? rel.along : null, met };
  });

  const measured = (k: ConditionKey) => (k === 'config' ? hasConfig : k === 'glidepath' || k === 'localizer' ? runway !== null : true);
  const conditions: ConditionResult[] = CONDITIONS.map((key, n) => {
    if (!measured(key)) return { key, measured: false, fromFt: null, top: false };
    const held = heldFrom(pts, 1 << n, topFt);
    return { key, measured: true, fromFt: held.fromFt === null ? null : Math.round(held.fromFt), top: held.top };
  });

  // Stable from the lowest of the heights the conditions were met from.
  const judged = conditions.filter((c) => c.measured);
  let stableFt: number | null = null;
  let last: ConditionKey | null = null;
  if (judged.length > 0 && judged.every((c) => c.fromFt !== null)) {
    for (const c of judged) {
      if (stableFt === null || (c.fromFt as number) < stableFt) {
        stableFt = c.fromFt;
        last = c.key;
      }
    }
  } else {
    last = judged.find((c) => c.fromFt === null)?.key ?? null;
  }
  const stableAtTop = stableFt !== null && judged.every((c) => c.top);
  if (stableAtTop) last = null;

  let gsAbove: number | null = null;
  let gsBelow: number | null = null;
  let locL: number | null = null;
  let locR: number | null = null;
  for (const p of pts) {
    if (p.h > STABLE.deviationFromFt || p.h < STABLE.floorFt || p.gs === null || p.loc === null) continue;
    gsAbove = Math.max(gsAbove ?? 0, p.gs);
    gsBelow = Math.max(gsBelow ?? 0, -p.gs);
    locR = Math.max(locR ?? 0, p.loc);
    locL = Math.max(locL ?? 0, -p.loc);
  }

  // Height over the threshold: the last sample before it and the one after, by distance.
  let thresholdFt: number | null = null;
  if (runway) {
    const all = pts.map((p) => ({ along: p.along as number, h: p.h }));
    const c = runwayRelative(runway, contact.lat, contact.lon);
    all.push({ along: c.along, h: 0 });
    for (let i = all.length - 2; i >= 0; i--) {
      if (all[i + 1].along < 0) break;
      if (all[i].along < 0) {
        const f = -all[i].along / (all[i + 1].along - all[i].along);
        thresholdFt = Math.round(all[i].h + (all[i + 1].h - all[i].h) * f);
        break;
      }
    }
  }

  const summary: ApproachSummary = {
    topFt: Math.round(topFt),
    stableFt: stableFt === null ? null : Math.round(stableFt),
    stableAtTop,
    last,
    conditions,
    gsMaxAbove: gsAbove === null ? null : round2(gsAbove),
    gsMaxBelow: gsBelow === null ? null : round2(gsBelow),
    locMaxL: locL === null ? null : round2(locL),
    locMaxR: locR === null ? null : round2(locR),
    pathDeg: path.deg,
    ilsPath: path.ils,
    powerAt500: roundOpt(at(500, (s) => s.power)),
    refIasKt: Math.round(refIas),
    thresholdFt,
  };

  // One point every 2 s for the drawing, with the first and the last always kept.
  const tr: ApproachTrace = { t: [], h: [], vs: [], ias: [], bank: [], power: [], gs: [], loc: [], flaps: [], gear: [], dist: [], met: [] };
  // A long approach is thinned further so the stored drawing stays about the same size.
  const step = Math.max(TRACE_STEP_S, (contact.t - pts[0].s.t) / TRACE_MAX_POINTS);
  let nextT = -Infinity;
  pts.forEach((p, i) => {
    if (p.h > STABLE.topFt + 50) return;
    if (p.s.t < nextT && i !== pts.length - 1) return;
    nextT = p.s.t + step - 0.05;
    tr.t.push(round1(p.s.t - contact.t));
    tr.h.push(Math.round(p.h));
    tr.vs.push(Math.round(p.s.vs));
    tr.ias.push(Math.round(p.s.ias));
    tr.bank.push(round1(p.s.bank));
    tr.power.push(roundOpt(p.s.power));
    tr.gs.push(p.gs === null ? null : round2(Math.max(-9.99, Math.min(9.99, p.gs))));
    tr.loc.push(p.loc === null ? null : round2(Math.max(-9.99, Math.min(9.99, p.loc))));
    tr.flaps.push(p.s.flaps ?? 0);
    tr.gear.push(p.s.gearDown ? 1 : 0);
    tr.dist.push(p.along === null ? null : Math.round(-p.along));
    tr.met.push(p.met);
  });
  return { summary, trace: tr };
}

function roundOpt(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : round1(v);
}

/**
 * The height from which a condition stayed met down to the floor. Walks back up the approach from
 * the floor; the first time the condition is found unmet for the grace time or longer ends it.
 */
function heldFrom(pts: Point[], bit: number, topFt: number): { fromFt: number | null; top: boolean } {
  let i = pts.length - 1;
  while (i >= 0 && pts[i].h < STABLE.floorFt) i--;
  /** The highest point so far with the condition met and no long break below it. */
  let held = -1;
  /** Time of the lowest sample of the unmet run being walked through, or null when in a met stretch. */
  let unmetUntil: number | null = null;
  for (; i >= 0 && pts[i].h <= STABLE.topFt; i--) {
    const p = pts[i];
    if (p.met & bit) {
      held = i;
      unmetUntil = null;
      continue;
    }
    if (unmetUntil === null) unmetUntil = p.s.t;
    if (unmetUntil - p.s.t >= STABLE.graceS - 1e-6) return { fromFt: held >= 0 ? Math.min(topFt, pts[held].h) : null, top: false };
  }
  if (held < 0) return { fromFt: null, top: false };
  // The recording ran out inside a short break: the last met point is as far as it is known.
  if (unmetUntil !== null) return { fromFt: Math.min(topFt, pts[held].h), top: false };
  return { fromFt: topFt, top: true };
}

/** Conditions in plain words, for labels. */
export const CONDITION_LABEL: Record<ConditionKey, string> = {
  config: 'Configuration',
  speed: 'Speed',
  sink: 'Sink rate',
  glidepath: 'Glidepath',
  localizer: 'Localizer',
  bank: 'Bank',
};
