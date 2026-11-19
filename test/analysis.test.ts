import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LandingDetector, fitSinkRate, groundOffset } from '../PackageSources/Flarecord/src/core/LandingDetector.ts';
import { METHODS, method } from '../PackageSources/Flarecord/src/ui/methods.ts';
import { runwayRelative, windComponents, matchRunway } from '../PackageSources/Flarecord/src/core/geo.ts';
import { LandingLog, MemoryStore } from '../PackageSources/Flarecord/src/storage/LandingLog.ts';
import { FileBridge } from '../PackageSources/Flarecord/src/storage/FileBridge.ts';
import { MirroredStore } from '../PackageSources/Flarecord/src/storage/MirroredStore.ts';
import type { LandingRecord } from '../PackageSources/Flarecord/src/core/types.ts';
import { crossingTime, heightGates, thresholdCrossing, traceAt } from '../PackageSources/Flarecord/src/core/gates.ts';
import { stackSvg, stackTimeAt } from '../PackageSources/Flarecord/src/ui/components/chartSvg.ts';
import { aircraftCounts, filterByAircraft, parseSelection, summarize, toggleAircraft } from '../PackageSources/Flarecord/src/core/summary.ts';
import { DEFAULT_SETTINGS, Units, group, parseSettings, runwayMarkings, usesFaaMarkings } from '../PackageSources/Flarecord/src/core/units.ts';
import { dispersionStrip, rolloutView, runwayView } from '../PackageSources/Flarecord/src/ui/components/runwaySvg.ts';
import { fmtAgo } from '../PackageSources/Flarecord/src/ui/format.ts';
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
  const examples = JSON.parse(readFileSync(new URL('../PackageSources/Flarecord/src/demo/exampleLandings.json', import.meta.url), 'utf8')) as LandingRecord[];
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
  assert.ok(Math.abs(faa.aimingM! - 304.8) < 0.1);
  assert.deepEqual(faa.bars.map((b) => Math.round(b.atM * 3.28084)), [500, 1500, 2000, 2500, 3000]);
  // FAA: nothing within 900 ft of the middle of the runway.
  assert.deepEqual(runwayMarkings(1500, 'ft').bars.map((b) => Math.round(b.atM * 3.28084)), [500, 1500]);
  assert.equal(runwayMarkings(700, 'ft').bars.length, 0);
  const icao = runwayMarkings(3000, 'm');
  assert.equal(icao.aimingM, 400);
  assert.deepEqual(icao.bars.map((b) => b.atM), [150, 300, 600, 750, 900]);
  assert.deepEqual(icao.bars.map((b) => b.count), [3, 3, 2, 1, 1], 'distance coded');
  assert.equal(runwayMarkings(1000, 'm').aimingM, 250);
  assert.deepEqual(runwayMarkings(2000, 'm').bars.map((b) => b.atM), [150, 450, 600], '4 pairs, the one at the aiming point left out');
});

test('runway markings follow the airport, the runway type and its width', () => {
  for (const id of ['KSEA', 'PANC', 'PHNL', 'TJSJ', '1S2']) assert.equal(usesFaaMarkings(id), true, id);
  for (const id of ['EGLL', 'CYVR', 'LOWI', 'RJTT', 'PTKK', 'LF2921']) assert.equal(usesFaaMarkings(id), false, id);
  // The airport decides the rules; the distance unit only decides the scale under the drawing.
  const us = runwayMarkings(3000, 'm', { airportIdent: 'KSEA' });
  assert.equal(us.standard, 'FAA');
  assert.ok(Math.abs(us.aimingM! - 304.8) < 0.1 && us.tickM === 150);
  const eu = runwayMarkings(3000, 'ft', { airportIdent: 'EGLL' });
  assert.equal(eu.standard, 'ICAO');
  assert.equal(eu.aimingM, 400);
  assert.equal(eu.tdzM, 900);
  assert.ok(Math.abs(eu.tickM * 3.280839895 - 500) < 1e-6);
  assert.ok(Math.abs(us.tdzM! * 3.280839895 - 3000) < 1e-6);
  assert.equal(runwayMarkings(1200, 'm', { airportIdent: 'LOWI' }).tdzM, 600, 'never past the middle of the runway');
  // No ILS: aiming point only on a long runway, threshold and centreline on a short one.
  const visual = runwayMarkings(1800, 'm', { airportIdent: 'EDXX', ils: false });
  assert.equal(visual.painted, 'aiming');
  assert.ok(visual.aimingM === 300 && visual.bars.length === 0 && visual.tdzM === null);
  const strip = runwayMarkings(700, 'm', { airportIdent: 'EDXX', ils: false });
  assert.ok(strip.painted === 'basic' && strip.aimingM === null);
  // Unpaved: nothing painted.
  const grass = runwayMarkings(900, 'm', { airportIdent: 'EDXX', hard: false });
  assert.ok(grass.painted === 'none' && grass.thresholdStripes === 0 && grass.aimingM === null && grass.bars.length === 0);
  // Threshold stripes by width, per side.
  assert.deepEqual([18, 23, 30, 45, 60].map((w) => runwayMarkings(3000, 'm', { widthM: w }).thresholdStripes), [2, 3, 4, 6, 8]);
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
  // The test airport is in the US: FAA positions whatever the unit, and the caption says so.
  assert.ok(metres.svg.includes('>1200 m<') && /aiming point \(305 m\)/.test(metres.note), metres.note);
  assert.ok(feet.caption.endsWith('standard FAA markings') && feet.svg.includes('>TDZ 3,000 ft<'), feet.caption);
  assert.ok(/standard, not read from the simulator/.test(feet.method!) && /FAA rules/.test(feet.method!) && /aiming point at 1,000 ft/.test(feet.method!) && /TDZ\) to 3,000 ft/.test(feet.method!), feet.method);
  const grass = runwayView({ ...rec.summary, geometry: { ...rec.summary.geometry!, runway: { ...RUNWAY, hard: false } } }, tr, new Units(DEFAULT_SETTINGS), 1100)!;
  assert.ok(grass.caption.endsWith('unpaved, no markings') && !grass.svg.includes('TDZ') && /past the threshold$/.test(grass.note), grass.note);

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
  const st = log.stats()!;
  assert.deepEqual({ count: st.count, vs: st.medianVs, td: st.medianTdM, cl: st.medianClM }, { count: 3, vs: -200, td: 400, cl: 2 });
  assert.equal(st.medianG, a.summary.peakG);
  assert.equal(st.bounced, 0);
  // Summary helpers: a subset, and the aircraft list most flown first.
  const two = summarize(log.list().slice(0, 2))!;
  assert.deepEqual({ count: two.count, vs: two.medianVs }, { count: 2, vs: -250 });
  assert.equal(summarize([]), null);
  assert.equal(summarize([{ ...a.summary, touchAndGo: true }]), null, 'touch-and-goes are left out');
  const fleet = aircraftCounts([{ ...a.summary, aircraft: 'B' }, { ...a.summary, aircraft: 'A' }, { ...a.summary, aircraft: 'A' }]);
  assert.deepEqual(fleet, [{ aircraft: 'A', count: 2 }, { aircraft: 'B', count: 1 }]);
  // The landing by landing graph: whole-number axis and a dot per landing.
  const svg = stackSvg({ t: [1, 2, 3], sequence: true, cursorT: null, pxWidth: 900, lanes: [{ label: 'VS', values: [-100, null, -300], color: '#fff', format: String }] });
  assert.equal(svg.split('<circle').length - 1, 2);
  assert.ok(!svg.includes('>TD<') && svg.includes('>3<'));
});

test('height gates: values at the last descent through each height', async () => {
  const [rec] = await run();
  const tr = rec.trace!;
  const gates = heightGates(tr, 'ft');
  assert.deepEqual(gates.map((g) => g.height), [200, 100, 50, 30, 20, 10, null]);
  const g50 = gates.find((g) => g.height === 50)!;
  assert.ok(Math.abs(g50.agl - 50) < 0.5, `agl at the 50 ft gate ${g50.agl}`);
  assert.ok(g50.t < -5 && g50.t > -12, `time ${g50.t}`);
  assert.ok(Math.abs(g50.vs + 716) < 15 && Math.abs(g50.pitch - 2.5) < 0.2, 'still on the approach at 50 ft');
  const g10 = gates.find((g) => g.height === 10)!;
  assert.ok(g10.vs > g50.vs + 200 && g10.pitch > g50.pitch + 1, 'in the flare at 10 ft');
  assert.ok(g10.along! > g50.along!, 'further down the runway');
  assert.ok(gates.every((g, i) => i === 0 || g.t > gates[i - 1].t), 'in time order');
  assert.equal(gates[gates.length - 1].t, 0);
  // Metres use their own set of heights; a height above the recording is left out.
  assert.deepEqual(heightGates(tr, 'm').map((g) => g.height), [60, 30, 15, 10, 5, 3, null]);
  assert.equal(crossingTime(tr, 5000), null);
  // A balloon back up through a height does not move the gate: it is the final crossing.
  const bump: typeof tr = { ...tr, t: [-4, -3, -2, -1, 0], agl: [60, 40, 55, 30, 0] };
  assert.ok(Math.abs(crossingTime(bump, 50)! - -1.8) < 1e-9);
  // Interpolation between samples and clamping at the ends.
  assert.ok(Math.abs(traceAt(tr, -8.1).agl - (tr.agl[tr.t.indexOf(-8.2)] + tr.agl[tr.t.indexOf(-8)]) / 2) < 0.06);
  assert.equal(traceAt(tr, -999).t, tr.t[0]);
});

test('combined chart: cursor values and tap position', async () => {
  const [rec] = await run();
  const tr = rec.trace!;
  const base = { t: tr.t, pxWidth: 1000, lanes: [{ label: 'RA', values: tr.agl, color: '#fff', yMin: 0, format: (v: number) => `${Math.round(v)} ft` }], gates: [{ t: -8, label: '50 ft' }] };
  const none = stackSvg({ ...base, cursorT: null });
  assert.ok(none.includes('>50 ft<') && !none.includes('la-cursor-value'));
  const t50 = crossingTime(tr, 50)!;
  assert.ok(stackSvg({ ...base, cursorT: t50 }).includes('class="la-cursor-value">50 ft<'));
  // Taps left of the plot clamp to the start, right of it to the end, the middle is the middle.
  assert.equal(stackTimeAt(tr.t, 0), tr.t[0]);
  assert.equal(stackTimeAt(tr.t, 1), tr.t[tr.t.length - 1]);
  const mid = stackTimeAt(tr.t, (44 + (1080 - 44 - 8) / 2) / 1080);
  assert.ok(Math.abs(mid - (tr.t[0] + tr.t[tr.t.length - 1]) / 2) < 1e-6);
});

test('summary aircraft selection: tick on and off, all by default', () => {
  const names = ['A320', 'B738', 'C172'];
  const list = [{ aircraft: 'A320' }, { aircraft: 'B738' }, { aircraft: 'A320' }, { aircraft: 'C172' }];
  assert.equal(filterByAircraft(list, null).length, 4, 'null means every aircraft');
  // Unticking one from "all" keeps the rest.
  const noCessna = toggleAircraft(null, 'C172', names);
  assert.deepEqual(noCessna, ['A320', 'B738']);
  assert.equal(filterByAircraft(list, noCessna).length, 3);
  // Ticking the last one back returns to "all", so aircraft flown later are included too.
  assert.equal(toggleAircraft(noCessna, 'C172', names), null);
  // From nothing ticked, build up a selection.
  assert.deepEqual(toggleAircraft([], 'B738', names), ['B738']);
  assert.equal(filterByAircraft(list, []).length, 0);
  assert.deepEqual(toggleAircraft(['B738'], 'B738', names), []);
  // Stored selections survive bad data.
  assert.equal(parseSelection(null), null);
  assert.equal(parseSelection('{oops'), null);
  assert.equal(parseSelection('[1,2]'), null);
  assert.deepEqual(parseSelection('["A320"]'), ['A320']);
});

test('rollout view: top-down strip with left of the centreline drawn above it', async () => {
  const rec = (await run({ lateralM: -6 }))[0];
  const tr = rec.trace!;
  const u = new Units(DEFAULT_SETTINGS);
  const view = rolloutView(rec.summary, tr, u, 1100)!;
  assert.ok(view.svg.includes('>LEFT<') && view.svg.includes('>RIGHT<'));
  assert.ok(/TOUCHDOWN \d+ ft L</.test(view.svg), 'touchdown offset is labelled with its side');
  assert.ok(view.svg.includes('>THR<'));
  // The centreline is at y = 94 in the drawing; a touchdown left of it sits above (smaller y).
  const cy = Number(/<circle cx="[\d.]+" cy="([\d.]+)" r="6.5"/.exec(view.svg)![1]);
  assert.ok(cy < 94, `left plots above the centreline: ${cy}`);
  const r = (await run({ lateralM: 6 }))[0];
  const right = rolloutView(r.summary, r.trace!, u, 1100)!;
  assert.ok(Number(/<circle cx="[\d.]+" cy="([\d.]+)" r="6.5"/.exec(right.svg)![1]) > 94);
  assert.ok(rolloutView(rec.summary, tr, new Units({ ...DEFAULT_SETTINGS, dist: 'm' }), 1100)!.caption.includes('45 m'));
  // Nothing to draw without a matched runway, or for a trace recorded before positions were kept.
  assert.equal(rolloutView({ ...rec.summary, geometry: null }, tr, u, 1100), null);
  assert.equal(rolloutView(rec.summary, { ...tr, along: undefined }, u, 1100), null);
});

test('threshold crossing: height over the threshold, on the runway view and the chart', async () => {
  const rec = (await run())[0];
  const tr = rec.trace!;
  const thr = thresholdCrossing(tr)!;
  assert.ok(thr.t < 0, 'crossed before touchdown');
  assert.ok(Math.abs(thr.along!) < 1, `position is the threshold: ${thr.along}`);
  assert.ok(thr.agl > 5 && thr.agl < 200, `plausible height: ${thr.agl}`);
  // Same moment as reading the trace at that time.
  assert.ok(Math.abs(traceAt(tr, thr.t).agl - thr.agl) < 1e-9);
  const u = new Units(DEFAULT_SETTINGS);
  assert.ok(runwayView(rec.summary, tr, u, 1100)!.svg.includes(`THRESHOLD ${Math.round(thr.agl)} ft RA`));
  assert.ok(!runwayView(rec.summary, null, u, 1100)!.svg.includes('THRESHOLD'));
  const svg = stackSvg({ t: tr.t, pxWidth: 1000, cursorT: null, markers: [{ t: thr.t, label: 'THRESHOLD 50 ft', color: '#fff' }], lanes: [{ label: 'RA', values: tr.agl, color: '#fff', format: String }] });
  assert.ok(svg.includes('>THRESHOLD 50 ft<'));
  // No crossing without positions, or when the recording never was before the threshold.
  assert.equal(thresholdCrossing({ ...tr, along: undefined }), null);
  assert.equal(thresholdCrossing({ ...tr, along: tr.along!.map((a) => (a === null ? null : Math.abs(a) + 1)) }), null);
});

test('unread landings: new until opened, kept across a restart', async () => {
  const store = new MemoryStore();
  const log = new LandingLog(store);
  const [a] = await run();
  const b = { ...a, summary: { ...a.summary, id: 'second' } };
  log.add(a);
  log.add(b);
  assert.deepEqual(log.unreadList().map((s) => s.id), ['second', a.summary.id]);
  let changes = 0;
  log.onChange(() => changes++);
  log.markRead('second');
  log.markRead('second');
  assert.equal(changes, 1, 'marking read notifies once');
  assert.equal(log.isUnread('second'), false);
  assert.equal(new LandingLog(store).isUnread(a.summary.id), true, 'survives a restart');
  log.remove(a.summary.id);
  assert.equal(new LandingLog(store).unreadList().length, 0);
  // Landings logged before the unread list existed count as read.
  store.remove(LandingLog.PREFIX + 'unread');
  assert.equal(new LandingLog(store).isUnread('second'), false);
});

test('relative time: minutes, hours, then whole days', () => {
  const now = 1e12;
  const ago = (min: number) => fmtAgo(now - min * 60000, now);
  assert.equal(ago(0.5), 'just now');
  assert.equal(ago(-10), 'just now');
  assert.equal(ago(1), '1 minute ago');
  assert.equal(ago(59), '59 minutes ago');
  assert.equal(ago(60), '1 hour ago');
  assert.equal(ago(23 * 60 + 59), '23 hours ago');
  assert.equal(ago(24 * 60), '1 day ago');
  assert.equal(ago(24 * 60 * 9.5), '9 days ago');
});

test('a log saved under the earlier name is moved over on first start', async () => {
  const store = new MemoryStore();
  const [a] = await run();
  const old = LandingLog.LEGACY_PREFIX;
  store.set(old + 'index.pages', '1');
  store.set(old + 'index.0', JSON.stringify([a.summary]));
  store.set(old + 'trace.' + a.summary.id, JSON.stringify(a.trace));
  store.set(old + 'unread', JSON.stringify([a.summary.id]));
  store.set(old + 'settings', '{"dist":"m"}');
  store.set(old + 'pref.summaryAircraft', '["Test Jet"]');
  const log = new LandingLog(store);
  assert.equal(log.list().length, 1);
  assert.equal(log.getTrace(a.summary.id)!.t.length, a.trace!.t.length);
  assert.equal(log.isUnread(a.summary.id), true);
  assert.equal(store.get(LandingLog.PREFIX + 'settings'), '{"dist":"m"}');
  assert.equal(store.get(LandingLog.PREFIX + 'pref.summaryAircraft'), '["Test Jet"]');
  assert.equal(Array.from(store.data.keys()).filter((k) => k.startsWith(old)).length, 0, 'old keys are removed');
  // A second start changes nothing, and a log already under the new name is never overwritten.
  store.set(old + 'index.pages', '0');
  assert.equal(new LandingLog(store).list().length, 1);
});

test('touchdown rate: sim value first, half-second fit as the cross-check and the fallback', async () => {
  // A steady 3 ft/s descent sampled at 20 Hz fits to -180 fpm whatever the height offset.
  const mk = (off: number) => Array.from({ length: 21 }, (_, i) => ({ t: i * 0.05, agl: off + Math.max(0, 3 * (1 - i * 0.05)), onGround: i === 20 }) as any);
  assert.ok(Math.abs(fitSinkRate(mk(0), 20)! + 180) < 0.5);
  assert.ok(Math.abs(fitSinkRate(mk(4), 20)! + 180) < 0.5);
  assert.equal(fitSinkRate(mk(0).slice(18), 2), null, 'too few samples to fit');

  // Without a sim value the fit is the headline figure and says so.
  const [noSim] = await run();
  assert.equal(noSim.summary.vsSource, 'fit');
  assert.equal(noSim.summary.touchdownVsFpm, noSim.summary.avgVsFpm);

  // With a sim value that one leads and the fit is kept next to it.
  const out: LandingRecord[] = [];
  const det = new LandingDetector({ onLanding: (r) => out.push(r), simTouchdownVs: () => -265 });
  for (const s of simulate()) det.push(s);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(out[0].summary.vsSource, 'sim');
  assert.equal(out[0].summary.touchdownVsFpm, -265);
  assert.equal(out[0].summary.avgVsFpm, noSim.summary.avgVsFpm);
});

test('height is zeroed per aircraft from the rollout', async () => {
  const [plain] = await run();
  // The same landing in an aircraft whose height reads 3.2 ft with the wheels on the ground.
  const out: LandingRecord[] = [];
  const det = new LandingDetector({ onLanding: (r) => out.push(r) });
  for (const s of simulate()) det.push({ ...s, agl: s.agl + 3.2 });
  await new Promise((r) => setTimeout(r, 0));
  const s = out[0].summary;
  assert.equal(s.aglOffsetFt, 3.2);
  assert.equal(plain.summary.aglOffsetFt, 0);
  assert.ok(Math.abs(s.flare.flareHeightFt! - plain.summary.flare.flareHeightFt!) < 0.01);
  assert.ok(Math.abs(s.flare.floatTimeS - plain.summary.flare.floatTimeS) < 0.01);
  assert.deepEqual(out[0].trace!.agl, plain.trace!.agl);
  // Too little rollout to judge: the reading taken while parked is used, then the contact sample.
  const few = [{ t: 0, agl: 2.5, onGround: true }, { t: 0.5, agl: 2.4, onGround: true }] as any;
  assert.equal(groundOffset(few, 0, 2.2), 2.2);
  assert.equal(groundOffset(few, 0, null), 2.5);
});

test('fast sampling is requested from arming until shortly after contact', () => {
  const det = new LandingDetector({ onLanding: () => undefined });
  const seen: boolean[] = [];
  const samples = simulate();
  let contactT = -1;
  for (const s of samples) {
    det.push(s);
    if (contactT < 0 && det.currentPhase === 'rollout') contactT = s.t;
    seen.push(det.wantsFastSampling);
  }
  const at = (t: number) => seen[samples.findIndex((s) => s.t >= t)];
  assert.equal(seen[0], false, 'not on the approach above 200 ft');
  assert.equal(at(contactT - 1), true);
  assert.equal(at(contactT + 1), true);
  assert.equal(at(contactT + 5), false);
});

test('every explained figure has a title and a text', () => {
  for (const k of ['vs', 'g', 'crab', 'wind', 'flare', 'pitchChange', 'float', 'bounces', 'height', 'position']) assert.ok(method(k), k);
  for (const m of METHODS) assert.ok(m.title.length > 3 && m.text.length > 40 && !m.text.includes('<'), m.key);
});

// ---- File storage ---------------------------------------------------------------------------

/** Stands in for the WASM module: one "file" per key, answering over a fake Comm Bus. */
function fakeModule(files = new Map<string, string>(), opts: { dead?: boolean } = {}) {
  let handler: (d: string) => void = () => undefined;
  const log: string[] = [];
  const bus = {
    on: (_e: string, fn: (d: string) => void) => void (handler = fn),
    send: (_e: string, data: string) => {
      if (opts.dead) return;
      const [id, op, key] = data.split('\n', 3);
      const value = data.slice(id.length + op.length + key.length + 3);
      log.push(`${op} ${key}`);
      let res = `${id}\nERR\n`;
      if (op === 'P') res = `${id}\nOK\ntest-module`;
      if (op === 'R') res = files.get(key) ? `${id}\nOK\n${files.get(key)}` : `${id}\nMISSING\n`;
      if (op === 'W') {
        files.set(key, value);
        res = `${id}\nOK\n`;
      }
      setTimeout(() => handler(res), 0);
    },
  };
  return { bus, files, log };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('file bridge: requests run one at a time and a queued write is replaced by a newer one', async () => {
  const m = fakeModule();
  const b = new FileBridge(m.bus);
  const done = Promise.all([b.write('a', '1'), b.write('b', '1'), b.write('b', '2'), b.write('b', 'multi\nline'), b.read('b'), b.read('nope')]);
  assert.equal(b.pending, 4, 'three writes to b collapse into one');
  const r = await done;
  assert.deepEqual(r.slice(0, 4), [true, true, true, true]);
  assert.deepEqual(r[4], { status: 'OK', value: 'multi\nline' });
  assert.deepEqual(r[5], { status: 'MISSING' });
  assert.deepEqual(m.log, ['W a', 'W b', 'R b', 'R nope']);
  // No answer: the request fails after the timeout and the queue moves on.
  const dead = new FileBridge(fakeModule(new Map(), { dead: true }).bus, 10);
  assert.equal(await dead.ping(), null);
  assert.equal(await dead.write('a', '1'), false);
  assert.equal(dead.failures, 2);
});

test('file storage: first run copies the log out, later writes are mirrored', async () => {
  const inner = new MemoryStore();
  const recs = await run();
  new LandingLog(inner).add(recs[0]);
  const m = fakeModule();
  const store = new MirroredStore(inner, new FileBridge(m.bus));
  assert.equal(await store.start(1, 0), false, 'nothing came in from the files');
  assert.equal(store.startResult, 'first copy');
  assert.equal(store.state, 'active');
  const id = recs[0].summary.id;
  assert.deepEqual(Array.from(m.files.keys()).sort(), ['index.0', 'index.pages', 'rev', `trace.${id}`, 'unread'].sort());
  assert.equal(m.files.get('index.0'), inner.get(LandingLog.PREFIX + 'index.0'));

  // A setting changed afterwards reaches the file, and the revision moves on both sides.
  const rev = m.files.get('rev');
  store.set(LandingLog.PREFIX + 'settings', '{"dist":"m"}');
  store.set('SOMEONE.ELSE', 'x');
  await settle();
  assert.equal(m.files.get('settings'), '{"dist":"m"}');
  assert.ok(!m.files.has('SOMEONE.ELSE') && !Array.from(m.files.keys()).some((k) => k.includes('SOMEONE')));
  assert.notEqual(m.files.get('rev'), rev);
  assert.equal(m.files.get('rev'), inner.get(LandingLog.PREFIX + 'rev'));

  // Next start: both sides agree, nothing is read or written beyond the revision.
  const again = new MirroredStore(inner, new FileBridge(m.bus));
  m.log.length = 0;
  assert.equal(await again.start(1, 0), false);
  assert.equal(again.startResult, 'in step');
  assert.deepEqual(m.log, ['P ', 'R rev']);
});

test('file storage: a wiped DataStore is rebuilt from the files, and a backup merges in', async () => {
  // Session 1: two landings, mirrored.
  const inner = new MemoryStore();
  const m = fakeModule();
  const s1 = new MirroredStore(inner, new FileBridge(m.bus));
  await s1.start(1, 0);
  const log1 = new LandingLog(s1);
  const [a] = await run();
  const [b] = await run({ touchdownSink: 300 });
  a.summary.recordedAt = 1000;
  b.summary.recordedAt = 2000;
  log1.add(a);
  log1.add(b);
  s1.set(LandingLog.PREFIX + 'settings', '{"dist":"m"}');
  await settle();
  const backup = new Map(m.files);

  // The sim loses its save data: the files bring everything back.
  const wiped = new MemoryStore();
  const s2 = new MirroredStore(wiped, new FileBridge(m.bus));
  assert.equal(await s2.start(1, 0), true);
  assert.equal(s2.startResult, 'merged');
  const log2 = new LandingLog(s2);
  assert.deepEqual(log2.list().map((s) => s.id), [b.summary.id, a.summary.id]);
  assert.ok(log2.getTrace(a.summary.id) && log2.getTrace(b.summary.id));
  assert.equal(wiped.get(LandingLog.PREFIX + 'settings'), '{"dist":"m"}');
  assert.equal(log2.unreadList().length, 2);

  // A third landing is flown, then the older backup is copied back over the folder:
  // the new landing is kept and written out again.
  const [c] = await run({ touchdownSink: 200 });
  c.summary.recordedAt = 3000;
  log2.add(c);
  await settle();
  const restored = fakeModule(new Map(backup));
  const s3 = new MirroredStore(wiped, new FileBridge(restored.bus));
  await s3.start(1, 0);
  assert.equal(s3.startResult, 'merged');
  assert.equal(new LandingLog(s3).list().length, 3);
  assert.equal(JSON.parse(restored.files.get('index.0')!).length, 3);
  assert.ok(restored.files.get(`trace.${c.summary.id}`));
  assert.equal(restored.files.get('rev'), wiped.get(LandingLog.PREFIX + 'rev'));
});

test('file storage: without the module the app runs on the DataStore alone', async () => {
  const inner = new MemoryStore();
  const none = new MirroredStore(inner, null);
  assert.equal(none.state, 'unavailable');
  none.set(LandingLog.PREFIX + 'settings', '{}');
  assert.equal(inner.get(LandingLog.PREFIX + 'settings'), '{}');
  const silent = new MirroredStore(inner, new FileBridge(fakeModule(new Map(), { dead: true }).bus, 5));
  silent.set(LandingLog.PREFIX + 'unread', '[]');
  assert.equal(await silent.start(2, 1), false);
  assert.equal(silent.state, 'unavailable');
  assert.equal(inner.get(LandingLog.PREFIX + 'unread'), '[]');
});

test('file storage: writes made while the files are being checked are sent afterwards', async () => {
  const inner = new MemoryStore();
  const m = fakeModule();
  const store = new MirroredStore(inner, new FileBridge(m.bus));
  const starting = store.start(1, 0);
  store.set(LandingLog.PREFIX + 'settings', '{"vs":"mps"}');
  await starting;
  await settle();
  assert.equal(m.files.get('settings'), '{"vs":"mps"}');
});
