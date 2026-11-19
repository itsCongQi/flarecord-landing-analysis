import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LandingDetector } from '../PackageSources/LandingAnalyzer/src/core/LandingDetector.ts';
import { runwayRelative, windComponents, matchRunway } from '../PackageSources/LandingAnalyzer/src/core/geo.ts';
import { LandingLog, MemoryStore } from '../PackageSources/LandingAnalyzer/src/storage/LandingLog.ts';
import type { LandingRecord } from '../PackageSources/LandingAnalyzer/src/core/types.ts';
import { crossingTime, heightGates, thresholdCrossing, traceAt } from '../PackageSources/LandingAnalyzer/src/core/gates.ts';
import { stackSvg, stackTimeAt } from '../PackageSources/LandingAnalyzer/src/ui/components/chartSvg.ts';
import { aircraftCounts, filterByAircraft, parseSelection, summarize, toggleAircraft } from '../PackageSources/LandingAnalyzer/src/core/summary.ts';
import { DEFAULT_SETTINGS, Units, group, parseSettings, runwayMarkings } from '../PackageSources/LandingAnalyzer/src/core/units.ts';
import { dispersionStrip, rolloutView, runwayView } from '../PackageSources/LandingAnalyzer/src/ui/components/runwaySvg.ts';
import { fmtAgo } from '../PackageSources/LandingAnalyzer/src/ui/format.ts';
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
  assert.ok(stackSvg({ ...base, cursorT: t50 }).includes('class="la-cursor-value" dominant-baseline="middle">50 ft<'));
  // Taps left of the plot clamp to the start, right of it to the end, the middle is the middle.
  assert.equal(stackTimeAt(tr.t, 0), tr.t[0]);
  assert.equal(stackTimeAt(tr.t, 1), tr.t[tr.t.length - 1]);
  const mid = stackTimeAt(tr.t, (44 + (1080 - 44 - 86) / 2) / 1080);
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
