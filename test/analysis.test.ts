import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LandingDetector } from '../PackageSources/LandingAnalyzer/src/core/LandingDetector.ts';
import { runwayRelative, windComponents, matchRunway } from '../PackageSources/LandingAnalyzer/src/core/geo.ts';
import { LandingLog, MemoryStore } from '../PackageSources/LandingAnalyzer/src/storage/LandingLog.ts';
import type { LandingRecord } from '../PackageSources/LandingAnalyzer/src/core/types.ts';
import { DEFAULT_SETTINGS, Units, group, parseSettings, runwayMarkings } from '../PackageSources/LandingAnalyzer/src/core/units.ts';
import { dispersionStrip, runwayView } from '../PackageSources/LandingAnalyzer/src/ui/components/runwaySvg.ts';
import { RUNWAY, simulate, type Scenario } from './simulate.ts';

async function run(sc: Partial<Scenario> = {}): Promise<LandingRecord[]> {
  const out: LandingRecord[] = [];
  const det = new LandingDetector({
    findRunways: async () => [RUNWAY, { ...RUNWAY, designation: '09', headingTrue: 90, thresholdLon: RUNWAY.thresholdLon - 0.035 }],
    onLanding: (r) => out.push(r),
    aircraftName: () => 'Test Jet',
  });
  for (const s of simulate(sc)) det.push(s);
  await new Promise((r) => setTimeout(r, 0));
  return out;
}

test('geometry: right-of-centreline is positive, along-track increases down the runway', () => {
  const p = runwayRelative(RUNWAY, 40.0001, -100.002); // a bit north (right of 270) and west (down the runway)
  assert.ok(p.along > 160 && p.along < 180, `along ${p.along}`);
  assert.ok(p.cross > 10 && p.cross < 12, `cross ${p.cross}`);
  const w = windComponents(300, 10, 270);
  assert.ok(w.head > 8.6 && w.cross > 4.9);
  assert.equal(matchRunway([RUNWAY], 40, -100.002, 90), null, 'opposite direction must not match');
});

test('a good landing is detected, measured and scored well', async () => {
  const [rec] = await run();
  assert.ok(rec, 'landing recorded');
  const s = rec.summary;
  console.log(JSON.stringify({ vs: s.touchdownVsFpm, g: s.peakG, flare: s.flare, geo: s.geometry && { d: s.geometry.distFromThresholdM, cl: s.geometry.centerlineOffsetM }, score: s.score.total, grade: s.score.grade }));
  assert.ok(s.touchdownVsFpm <= -100 && s.touchdownVsFpm >= -220, `vs ${s.touchdownVsFpm}`);
  assert.equal(s.bounces, 0);
  assert.equal(s.geometry?.runway.designation, '27');
  assert.ok(Math.abs((s.geometry?.centerlineOffsetM ?? 99) - 0.8) < 0.3);
  assert.ok(s.flare.method === 'pitch', `flare method ${s.flare.method}`);
  assert.ok((s.flare.flareHeightFt ?? 0) > 15 && (s.flare.flareHeightFt ?? 0) <= 32, `flare ft ${s.flare.flareHeightFt}`);
  assert.ok(s.score.total >= 85, `score ${s.score.total}`);
  assert.ok(rec.trace && rec.trace.t.length > 100 && rec.trace.t[0] <= -29);
});

test('no flare and a hard arrival is graded Hard', async () => {
  const [rec] = await run({ flareAt: 0, touchdownSink: 716 });
  const s = rec.summary;
  assert.equal(s.flare.method, 'none');
  assert.equal(s.score.grade, 'Hard');
  assert.ok(s.score.total < 60, `score ${s.score.total}`);
});

test('bounce is counted and costs points', async () => {
  const [good] = await run();
  const [bounced] = await run({ bounceS: 1.2 });
  assert.equal(bounced.summary.bounces, 1);
  assert.ok(bounced.summary.score.total < good.summary.score.total);
});

test('long float is measured', async () => {
  const [rec] = await run({ floatS: 7 });
  assert.ok(rec.summary.flare.floatTimeS > 6, `float ${rec.summary.flare.floatTimeS}`);
});

test('log persists across instances, prunes graphs, exports CSV', async () => {
  const store = new MemoryStore();
  const log = new LandingLog(store);
  const [rec] = await run();
  for (let i = 0; i < LandingLog.MAX_TRACES + 5; i++) {
    log.add({ ...rec, summary: { ...rec.summary, id: 'L' + i } });
  }
  const reopened = new LandingLog(store);
  assert.equal(reopened.list().length, LandingLog.MAX_TRACES + 5);
  assert.equal(reopened.latest()?.id, `L${LandingLog.MAX_TRACES + 4}`);
  assert.ok(reopened.getTrace(reopened.latest()!.id));
  assert.equal(reopened.getTrace('L0'), null, 'oldest graph pruned');
  const traceLen = store.get(LandingLog.PREFIX + 'trace.' + reopened.latest()!.id)!.length;
  const biggest = Math.max(...[...store.data.values()].map((v) => v.length));
  console.log(`store keys ${store.data.size}, one trace ${traceLen} chars, largest key ${biggest} chars`);
  assert.ok(biggest < 100_000, 'no single key over 100 KB');
  assert.ok(reopened.toCsv().split('\n').length === LandingLog.MAX_TRACES + 6);
});

test('examples show only while the log is empty and are never stored', async () => {
  const examples = JSON.parse(readFileSync(new URL('../PackageSources/LandingAnalyzer/src/demo/exampleLandings.json', import.meta.url), 'utf8')) as LandingRecord[];
  const store = new MemoryStore();
  const log = new LandingLog(store);
  log.setExamples(examples);
  assert.equal(log.showingExamples, true);
  assert.equal(log.list().length, 3);
  assert.ok(log.list().every((s) => s.example));
  assert.ok(log.getTrace('example1'), 'example graphs available');
  assert.equal(log.stats()?.count, 3);
  assert.equal(store.data.size, 0, 'examples are not written to the store');
  const [rec] = await run();
  log.add(rec);
  assert.equal(log.showingExamples, false);
  assert.deepEqual(log.list().map((s) => s.id), [rec.summary.id]);
  assert.equal(log.stats()?.count, 1);
});

test('ground jitter and spawn settling never record a landing', async () => {
  const out: LandingRecord[] = [];
  const det = new LandingDetector({ onLanding: (r) => out.push(r) });
  const base = simulate()[0];
  // Spawn: 1.5 s "airborne" a foot or two up while the aircraft settles, then 60 s parked at the
  // gate with SIM ON GROUND flickering off for single samples and small negative vertical speeds.
  for (let i = 0; i < 20 * 62; i++) {
    const t = 500 + i * 0.05;
    const settling = i < 30;
    const flicker = !settling && i % 37 === 0;
    det.push({ ...base, t, agl: settling ? 2 - i * 0.07 : flicker ? 0.4 : -1, vs: settling ? -69 : -5, ias: 0, gs: 0, onGround: !(settling || flicker) });
  }
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(out.length, 0, 'no landing from ground jitter');
  assert.equal(det.currentPhase, 'idle');
});

test('units: feet, fpm and knots by default; settings survive bad data', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.dist, 'ft');
  assert.equal(DEFAULT_SETTINGS.index, false);
  assert.deepEqual(parseSettings('{not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('{"dist":"m","vs":"furlongs","index":true}'), { ...DEFAULT_SETTINGS, dist: 'm', index: true });
  const ft = new Units(DEFAULT_SETTINGS);
  assert.equal(ft.fmtDist(385), '1,263');
  assert.equal(ft.fmtVs(-192), '-192');
  const si = new Units({ dist: 'm', height: 'm', vs: 'mps', speed: 'kmh', index: false });
  assert.equal(si.fmtDist(385), '385');
  assert.equal(si.fmtVs(-192), '-1.0');
  assert.equal(si.fmtSpeed(100), '185');
  assert.equal(si.fmtHeight(50), '15');
  assert.equal(group(-1234567), '-1,234,567');
});

test('runway markings follow the unit standard and stop before mid-runway', () => {
  const faa = runwayMarkings(3000, 'ft');
  assert.ok(Math.abs(faa.aimingM - 304.8) < 0.1);
  assert.deepEqual(faa.bars.map((b) => Math.round(b.atM * 3.28084)), [500, 1500, 2000, 2500, 3000]);
  assert.equal(runwayMarkings(700, 'ft').bars.length, 1, 'short runway: only the 500 ft bars');
  const icao = runwayMarkings(3000, 'm');
  assert.equal(icao.aimingM, 400);
  assert.deepEqual(icao.bars.map((b) => b.atM), [150, 300, 600, 750, 900]);
  assert.equal(runwayMarkings(1000, 'm').aimingM, 250);
});

test('trace carries the ground track and the runway view draws it', async () => {
  const [rec] = await run({ lateralM: 2.1 });
  const tr = rec.trace!;
  assert.equal(tr.along!.length, tr.t.length);
  const i0 = tr.t.indexOf(0);
  assert.ok(tr.along![0]! < -1500, `approach starts well before the threshold: ${tr.along![0]}`);
  assert.ok(Math.abs(tr.along![i0]! - rec.summary.geometry!.distFromThresholdM) < 15);
  assert.ok(tr.along![tr.t.length - 1]! > tr.along![i0]!, 'rollout continues down the runway');
  assert.equal(rec.summary.windDirDeg, 280);
  assert.equal(rec.summary.windKt, 8);

  const feet = runwayView(rec.summary, tr, new Units(DEFAULT_SETTINGS), 1100)!;
  const tdFt = group(rec.summary.geometry!.distFromThresholdM * 3.280839895);
  assert.ok(feet.svg.includes(`TOUCHDOWN ${tdFt} ft · 7 ft R`), 'touchdown call-out in feet');
  assert.ok(feet.svg.includes('FLARE') && feet.svg.includes('<polyline'), 'flare line and track drawn');
  assert.ok(feet.svg.includes('>4000 ft<') && feet.caption.startsWith('First 4,000 ft of 9,843 ft · width 148 ft'), feet.caption);
  assert.ok(/aiming point \(1,000 ft\)/.test(feet.note), feet.note);
  const metres = runwayView(rec.summary, tr, new Units({ ...DEFAULT_SETTINGS, dist: 'm' }), 1100)!;
  assert.ok(metres.svg.includes('>1200 m<') && /aiming point \(400 m\)/.test(metres.note), metres.note);

  // A long landing widens the view instead of drawing the marker off the edge.
  const long = { ...rec.summary, geometry: { ...rec.summary.geometry!, distFromThresholdM: 1700 } };
  assert.ok(runwayView(long, null, new Units(DEFAULT_SETTINGS), 1100)!.svg.includes('>7000 ft<'));
  assert.equal(runwayView({ ...rec.summary, geometry: null }, tr, new Units(DEFAULT_SETTINGS), 1100), null);
  assert.ok(dispersionStrip([rec.summary, long], new Units(DEFAULT_SETTINGS), 1100).split('<circle').length === 4);
  assert.equal(dispersionStrip([{ ...rec.summary, geometry: null }], new Units(DEFAULT_SETTINGS), 1100), '');
});

test('displaced threshold: distance is measured from the landing threshold', () => {
  // Landing threshold 300 m in from the pavement start; a touchdown on the displaced part still matches.
  const rw = { ...RUNWAY, lengthM: 2700, displacedM: 300 };
  const short = runwayRelative(rw, 40.0, -100.0 + 0.005); // about 427 m before the threshold
  assert.ok(short.along < -400);
  assert.equal(matchRunway([rw], 40.0, -100.0 + 0.005, 270), rw);
  assert.equal(matchRunway([RUNWAY], 40.0, -100.0 + 0.005, 270), null, 'without displacement that is off the runway');
});

test('log medians', async () => {
  const log = new LandingLog(new MemoryStore());
  const [a] = await run();
  const mk = (id: string, vs: number, td: number, cl: number): LandingRecord => ({ trace: null, summary: { ...a.summary, id, touchdownVsFpm: vs, geometry: { ...a.summary.geometry!, distFromThresholdM: td, centerlineOffsetM: cl } } });
  log.add(mk('a', -100, 300, -4));
  log.add(mk('b', -300, 500, 1));
  log.add(mk('c', -200, 400, 2));
  assert.deepEqual(log.stats(), { count: 3, medianVs: -200, medianTdM: 400, medianClM: 2 });
});
