import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LandingDetector } from '../PackageSources/LandingAnalyzer/src/core/LandingDetector.ts';
import { runwayRelative, windComponents, matchRunway } from '../PackageSources/LandingAnalyzer/src/core/geo.ts';
import { LandingLog, MemoryStore } from '../PackageSources/LandingAnalyzer/src/storage/LandingLog.ts';
import type { LandingRecord } from '../PackageSources/LandingAnalyzer/src/core/types.ts';
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
