import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeApproach, glidepathDots, localizerDots, pathAngle } from '../PackageSources/Flarecord/src/core/approach.ts';
import { LandingDetector } from '../PackageSources/Flarecord/src/core/LandingDetector.ts';
import { offsetLatLon } from '../PackageSources/Flarecord/src/core/geo.ts';
import { LandingLog, MemoryStore } from '../PackageSources/Flarecord/src/storage/LandingLog.ts';
import type { LandingRecord, Sample } from '../PackageSources/Flarecord/src/core/types.ts';
import { RUNWAY, simulate } from './simulate.ts';

const FT_PER_M = 3.280839895;
const TAN3 = Math.tan((3 * Math.PI) / 180);
/** Where a 3 degree path that is 50 ft over the threshold meets the runway, metres past the threshold. */
const AIM_M = 50 / FT_PER_M / TAN3;
const FIELD_FT = 430;

interface Flight {
  fromFt: number;
  ias: (h: number) => number;
  flaps: (h: number) => number;
  gear: (h: number) => boolean;
  bank: (h: number) => number;
  /** Metres right of the centreline. */
  cross: (h: number) => number;
  /** Degrees above the 3 degree path. */
  gsErr: (h: number) => number;
  /** Extra sink on top of what the path needs, fpm (positive = sinking faster, reported only). */
  extraSink: (h: number) => number;
  n1: (h: number) => number;
  stepS: number;
}

const CLEAN: Flight = {
  fromFt: 3300,
  ias: () => 135,
  flaps: () => 4,
  gear: () => true,
  bank: () => 0,
  cross: () => 0,
  gsErr: () => 0,
  extraSink: () => 0,
  n1: () => 54,
  stepS: 0.5,
};

/** A straight-in approach to RUNWAY (heading 270) ending in a contact sample; airborne samples oldest first. */
function fly(f: Partial<Flight> = {}, t0 = 5000): { approach: Sample[]; contact: Sample } {
  const p = { ...CLEAN, ...f };
  const out: Sample[] = [];
  let along = AIM_M - p.fromFt / FT_PER_M / TAN3;
  let t = t0;
  const at = (alongM: number, h: number, onGround: boolean): Sample => {
    // Heading 270: along the runway is west, right of it is north.
    const pos = offsetLatLon(RUNWAY.thresholdLat, RUNWAY.thresholdLon, -alongM, p.cross(h));
    const gsKt = p.ias(h);
    return {
      t,
      agl: h,
      alt: FIELD_FT + h,
      vs: onGround ? 0 : -gsKt * 0.514444 * TAN3 * 196.85 - p.extraSink(h),
      ias: gsKt,
      gs: gsKt,
      pitch: 2.5,
      bank: p.bank(h),
      heading: 270,
      track: 270,
      g: 1,
      elevator: 0,
      onGround,
      lat: pos.lat,
      lon: pos.lon,
      windDir: 270,
      windSpd: 0,
      power: p.n1(h),
      powerSpread: 0,
      powerKind: 'n1',
      gearDown: p.gear(h),
      flaps: p.flaps(h),
      aoa: 5,
      wow: onGround ? 3 : 0,
    };
  };
  for (;;) {
    const nominal = (AIM_M - along) * TAN3 * FT_PER_M;
    if (nominal <= 0) break;
    // The path error is an angle seen from the aiming point.
    const h = (AIM_M - along) * Math.tan(((3 + p.gsErr(nominal)) * Math.PI) / 180) * FT_PER_M;
    out.push(at(along, h, false));
    along += p.ias(nominal) * 0.514444 * p.stepS;
    t += p.stepS;
  }
  return { approach: out, contact: at(AIM_M, 0, true) };
}

const near = (a: number | null, b: number, tol: number, what: string) => assert.ok(a !== null && Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

test('deviation in dots: one dot is 0.35 degrees vertically, full scale is 350 ft at the threshold laterally', () => {
  near(glidepathDots(-5000, (AIM_M + 5000) * TAN3 * FT_PER_M, 3), 0, 0.01, 'on the path');
  near(glidepathDots(-5000, (AIM_M + 5000) * Math.tan((3.35 * Math.PI) / 180) * FT_PER_M, 3), 1, 0.01, 'one dot above');
  near(glidepathDots(-5000, (AIM_M + 5000) * Math.tan((2.3 * Math.PI) / 180) * FT_PER_M, 3), -2, 0.01, 'two dots below');
  near(glidepathDots(0, 50, 3), 0, 0.01, '50 ft over the threshold');
  near(localizerDots(RUNWAY, 0, 350 / FT_PER_M), 2, 0.01, 'full scale right at the threshold');
  near(localizerDots(RUNWAY, 0, -175 / FT_PER_M), -1, 0.02, 'one dot left');
  // A very long runway would give a needle narrower than a real localizer: held at 1.5 degrees.
  const long = { ...RUNWAY, lengthM: 5500 };
  near(localizerDots(long, 0, Math.tan((1.5 * Math.PI) / 180) * (5500 + 1000 / FT_PER_M)), 2, 0.01, 'narrowest course');
  assert.deepEqual(pathAngle(RUNWAY), { deg: 3, ils: false });
  assert.deepEqual(pathAngle({ ...RUNWAY, gsDeg: 3.2 }), { deg: 3.2, ils: true });
  assert.deepEqual(pathAngle({ ...RUNWAY, gsDeg: 0 }), { deg: 3, ils: false });
});

test('a steady approach is stable from the top of the recording', () => {
  const { approach, contact } = fly();
  const a = analyzeApproach(approach, contact, RUNWAY)!;
  assert.equal(a.summary.topFt, 3000);
  assert.equal(a.summary.stableFt, 3000);
  assert.equal(a.summary.stableAtTop, true);
  assert.equal(a.summary.last, null);
  assert.ok(a.summary.conditions.every((c) => c.measured && c.top));
  near(a.summary.gsMaxAbove, 0, 0.02, 'glidepath above');
  near(a.summary.gsMaxBelow, 0, 0.02, 'glidepath below');
  near(a.summary.locMaxL, 0, 0.02, 'left');
  near(a.summary.powerAt500, 54, 0.1, 'N1 at 500 ft');
  near(a.summary.thresholdFt, 50, 2, 'height over the threshold');
  assert.equal(a.summary.refIasKt, 135);
});

test('height when stable is set by the condition met last', () => {
  // Speed comes back to within 10 kt at about 2,100 ft, gear at 2,400 ft, landing flap at 1,840 ft.
  const { approach, contact } = fly({
    ias: (h) => (h > 2100 ? 145 + (h - 2100) * 0.05 : 135),
    gear: (h) => h <= 2400,
    flaps: (h) => (h > 2500 ? 1 : h > 1840 ? 3 : 4),
  });
  const s = analyzeApproach(approach, contact, RUNWAY)!.summary;
  near(s.stableFt, 1840, 15, 'stable');
  assert.equal(s.last, 'config');
  assert.equal(s.stableAtTop, false);
  const by = (k: string) => s.conditions.find((c) => c.key === k)!;
  near(by('config').fromFt, 1840, 15, 'configuration');
  near(by('speed').fromFt, 2100, 15, 'speed');
  // At the higher speed the 3 degree path needs just over 1,000 fpm near the top.
  assert.ok((by('sink').fromFt as number) > 2900);
  assert.equal(by('bank').fromFt, 3000);
});

test('a condition left for under two seconds still counts, a longer one does not', () => {
  const brief = fly({ bank: (h) => (h < 805 && h > 795 ? 12 : 0) });
  const sb = analyzeApproach(brief.approach, brief.contact, RUNWAY)!.summary;
  assert.equal(sb.stableAtTop, true, 'about one second of bank is ignored');

  const long = fly({ bank: (h) => (h < 900 && h > 800 ? 12 : 0) });
  const sl = analyzeApproach(long.approach, long.contact, RUNWAY)!.summary;
  near(sl.stableFt, 800, 10, 'stable below the turn');
  assert.equal(sl.last, 'bank');
});

test('deviation maxima are taken between 1,000 ft and 100 ft, each side on its own', () => {
  const { approach, contact } = fly({
    // 2 dots low high up (not counted), 0.5 dot high around 700 ft, 0.3 dot low around 300 ft.
    gsErr: (h) => (h > 2000 ? -0.7 : h < 750 && h > 650 ? 0.175 : h < 350 && h > 250 ? -0.105 : 0),
    cross: (h) => (h > 1500 ? -400 : h < 600 && h > 400 ? 20 : 0),
  });
  const a = analyzeApproach(approach, contact, RUNWAY)!;
  near(a.summary.gsMaxAbove, 0.5, 0.03, 'above');
  near(a.summary.gsMaxBelow, 0.3, 0.03, 'below');
  assert.equal(a.summary.locMaxL, 0);
  assert.ok((a.summary.locMaxR as number) > 0.2 && (a.summary.locMaxR as number) < 0.5, `right ${a.summary.locMaxR}`);
  const by = (k: string) => a.summary.conditions.find((c) => c.key === k)!;
  near(by('glidepath').fromFt, 2000, 15, 'glidepath');
  near(by('localizer').fromFt, 1500, 15, 'localizer');
  assert.equal(a.summary.last, 'localizer');
});

test('not stable at 100 ft reads as no height, and names what was missing', () => {
  const { approach, contact } = fly({ extraSink: (h) => (h > 60 ? 500 : 0) });
  const s = analyzeApproach(approach, contact, RUNWAY)!.summary;
  assert.equal(s.stableFt, null);
  assert.equal(s.last, 'sink');
});

test('without a runway the path conditions are not measured and the rest still are', () => {
  const { approach, contact } = fly({ gear: (h) => h <= 1500 });
  const s = analyzeApproach(approach, contact, null)!.summary;
  assert.equal(s.conditions.find((c) => c.key === 'glidepath')!.measured, false);
  assert.equal(s.conditions.find((c) => c.key === 'localizer')!.measured, false);
  assert.equal(s.gsMaxAbove, null);
  assert.equal(s.thresholdFt, null);
  near(s.stableFt, 1500, 15, 'stable');
});

test('only the final descent counts: an earlier approach and go-around is left out', () => {
  const first = fly({ fromFt: 2500 }, 1000).approach.filter((s) => s.agl > 300);
  // Climb back to nearly 1,900 ft, then the approach that lands from a little higher.
  const lastT = first[first.length - 1].t;
  const climb: Sample[] = [];
  for (let i = 1; i <= 120; i++) climb.push({ ...first[first.length - 1], t: lastT + i * 0.5, agl: 300 + i * 13, alt: FIELD_FT + 300 + i * 13, vs: 1600 });
  const final = fly({ fromFt: 1980 }, lastT + 61);
  const s = analyzeApproach([...first, ...climb, ...final.approach], final.contact, RUNWAY)!.summary;
  assert.ok(s.topFt <= 2000 && s.topFt > 1900, `top ${s.topFt}`);
  assert.equal(s.stableAtTop, true);
});

test('too little approach is not analysed, and older samples without altitude fall back to radio height', () => {
  const short = fly({ fromFt: 250 });
  assert.equal(analyzeApproach(short.approach, short.contact, RUNWAY), null);

  const old = fly({ fromFt: 900 });
  const strip = (s: Sample): Sample => ({ ...s, alt: undefined, gearDown: undefined, flaps: undefined });
  const a = analyzeApproach(old.approach.map(strip), strip(old.contact), RUNWAY)!;
  near(a.summary.topFt, 900, 10, 'top');
  assert.equal(a.summary.conditions.find((c) => c.key === 'config')!.measured, false);
  assert.equal(a.summary.stableAtTop, true);
});

test('the approach trace is one point every two seconds and small enough to store', () => {
  const { approach, contact } = fly({ flaps: (h) => (h > 1840 ? 3 : 4) });
  const tr = analyzeApproach(approach, contact, RUNWAY)!.trace;
  assert.ok(tr.t.length > 100 && tr.t.length < 160, `${tr.t.length} points`);
  assert.ok(tr.h[0] <= 3050 && tr.h[0] > 2900);
  assert.ok(tr.t[1] - tr.t[0] >= 1.9);
  // Bit 0 is the configuration: unmet at the top, met at the bottom.
  assert.equal(tr.met[0] & 1, 0);
  assert.equal(tr.met[tr.met.length - 1] & 1, 1);
  assert.ok(JSON.stringify(tr).length < 12000, `${JSON.stringify(tr).length} bytes`);
});

test('a recorded landing carries its approach, engine power and gear contact', async () => {
  const { approach, contact } = fly({ flaps: (h) => (h > 1200 ? 3 : 4), stepS: 0.25 });
  const got: LandingRecord[] = [];
  const det = new LandingDetector({ findRunways: async () => [RUNWAY], onLanding: (r) => got.push(r), aircraftName: () => 'Test jet' });
  // Parked first, then airborne at altitude: the detector is not told about the take-off.
  for (let i = 0; i < 10; i++) det.push({ ...contact, t: approach[0].t - 30 + i, gs: 0 });
  for (const s of approach) det.push(s);
  // Rollout: left main first, the right main and the nose a little later.
  for (let i = 0; i < 400; i++) {
    const dt = i * 0.05;
    det.push({ ...contact, t: contact.t + dt, gs: Math.max(0, 135 - dt * 8), ias: Math.max(0, 135 - dt * 8), wow: 1 | (dt >= 0.3 ? 2 : 0) | (dt >= 2.5 ? 4 : 0), power: 30 });
  }
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got.length, 1);
  const s = got[0].summary;
  near(s.approach!.stableFt, 1200, 15, 'stable');
  assert.equal(s.approach!.last, 'config');
  assert.equal(s.powerKind, 'n1');
  assert.equal(s.powerAtTd, 30);
  assert.deepEqual(s.gearContact, { left: 0, right: 0.3, nose: 2.5 });
  const tr = got[0].trace!;
  assert.ok(tr.approach && tr.approach.t.length > 50);
  assert.equal(tr.wow!.length, tr.t.length);
  assert.equal(tr.power!.length, tr.t.length);
  // The whole stored record stays well under the store's per-key limit.
  assert.ok(JSON.stringify(tr).length < 40000, `${JSON.stringify(tr).length} bytes`);
  const log = new LandingLog(new MemoryStore());
  log.add(got[0]);
  assert.equal(log.getTrace(s.id)!.approach!.h.length, tr.approach.h.length);
});

test('landings recorded from older samples still work and simply have less approach data', async () => {
  const got: LandingRecord[] = [];
  const det = new LandingDetector({ findRunways: async () => [RUNWAY], onLanding: (r) => got.push(r) });
  for (const s of simulate()) det.push(s);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got.length, 1);
  assert.equal(got[0].summary.gearContact, undefined);
  assert.equal(got[0].trace!.wow, undefined);
  const a = got[0].summary.approach;
  assert.ok(a === undefined || a.topFt <= 700);
});
