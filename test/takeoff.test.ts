import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TakeoffDetector } from '../PackageSources/Flarecord/src/core/TakeoffDetector.ts';
import { LandingDetector } from '../PackageSources/Flarecord/src/core/LandingDetector.ts';
import { findRotation } from '../PackageSources/Flarecord/src/core/takeoff.ts';
import { MemoryStore, RecordLog } from '../PackageSources/Flarecord/src/storage/RecordLog.ts';
import { LandingLog, TakeoffLog } from '../PackageSources/Flarecord/src/storage/LandingLog.ts';
import type { Sample, TakeoffRecord } from '../PackageSources/Flarecord/src/core/types.ts';
import { RUNWAY, simulate } from './simulate.ts';
import { simulateTakeoff, type TakeoffScenario } from './simulate-takeoff.ts';

async function record(samples: Sample[], runway = true): Promise<TakeoffRecord[]> {
  const recs: TakeoffRecord[] = [];
  const det = new TakeoffDetector({ findRunways: async () => (runway ? [RUNWAY] : []), onTakeoff: (r) => recs.push(r), aircraftName: () => 'Test jet', now: () => 1_700_000_000_000 });
  for (const s of samples) det.push(s);
  await new Promise((r) => setTimeout(r, 0));
  return recs;
}

async function one(sc: Partial<TakeoffScenario> = {}): Promise<TakeoffRecord> {
  const recs = await record(simulateTakeoff(sc));
  assert.equal(recs.length, 1);
  return recs[0];
}

test('a takeoff is recorded once, with the roll measured from where it began', async () => {
  const { summary: s } = await one();
  assert.equal(s.kind, 'takeoff');
  assert.equal(s.touchAndGo, false);
  assert.equal(s.runway?.designation, '27');
  assert.ok(Math.abs((s.startM as number) - 100) <= 2, `start ${s.startM}`);
  assert.ok(s.rollM > 1000 && s.rollM < 2200, `roll ${s.rollM}`);
  assert.ok(Math.abs((s.remainingM as number) - (3000 - 100 - s.rollM)) <= 2);
  assert.ok(s.rollS > 25 && s.rollS < 50, `roll time ${s.rollS}`);
});

test('rotation speed, rate and liftoff pitch match what was flown', async () => {
  const { summary: s } = await one({ vr: 140, rotRate: 3, liftoffPitch: 8.5 });
  assert.ok(Math.abs((s.rotIasKt as number) - 140) <= 2, `rotation at ${s.rotIasKt}`);
  assert.ok((s.rotRateAvg as number) > 2.2 && (s.rotRateAvg as number) <= 3.05, `average ${s.rotRateAvg}`);
  assert.ok(Math.abs((s.rotRatePeak as number) - 3) <= 0.15, `peak ${s.rotRatePeak}`);
  assert.ok(Math.abs(s.liftoffPitchDeg - 8.5) <= 0.3, `pitch ${s.liftoffPitchDeg}`);
  assert.ok(Math.abs((s.rotToLiftoffS as number) - (8.2 / 3 + 0.4)) <= 0.5, `time ${s.rotToLiftoffS}`);
});

test('a slow rotation reads as a slow rate and a longer time to liftoff', async () => {
  const fast = (await one({ rotRate: 3 })).summary;
  const slow = (await one({ rotRate: 1.5 })).summary;
  assert.ok(Math.abs((slow.rotRatePeak as number) - 1.5) <= 0.15);
  assert.ok((slow.rotToLiftoffS as number) > (fast.rotToLiftoffS as number) + 1.5);
  assert.ok(slow.rollM > fast.rollM);
});

test('an aircraft flown off in its ground attitude has no rotation figures', async () => {
  const { summary: s } = await one({ rotRate: 0, vr: 60 });
  assert.equal(s.rotIasKt, null);
  assert.equal(s.rotRateAvg, null);
  assert.equal(s.kind, 'takeoff');
  assert.ok(Math.abs(s.liftoffIasKt - 60) <= 2);
});

test('centreline deviation during the roll keeps its side and its place', async () => {
  const left = (await one({ lateralM: -4 })).summary;
  assert.ok(Math.abs((left.clMaxM as number) + 4) <= 0.3, `max ${left.clMaxM}`);
  assert.ok(Math.abs((left.clMaxStartM as number) - 700) <= 60, `at ${left.clMaxStartM}`);
  const right = (await one({ lateralM: 3 })).summary;
  assert.ok(Math.abs((right.clMaxM as number) - 3) <= 0.3);
});

test('the climb is followed to 3,000 ft with its events', async () => {
  const { summary: s, trace } = await one();
  const c = s.climb!;
  assert.ok(c.topFt >= 2990 && c.topFt <= 3000, `top ${c.topFt}`);
  assert.ok(Math.abs((c.gearUpFt as number) - 90) <= 15, `gear ${c.gearUpFt}`);
  assert.ok(Math.abs((c.thrustRedFt as number) - 1500) <= 120, `thrust ${c.thrustRedFt}`);
  assert.ok(c.flapFt !== null && c.flapFt > 1500, `flaps ${c.flapFt}`);
  assert.ok(c.runwayEndFt !== null && c.runwayEndFt > 100, `runway end ${c.runwayEndFt}`);
  assert.equal(c.bankMax500, 1.5);
  assert.ok(c.to1000S !== null && c.to1000S > 15 && c.to1000S < 40);
  assert.ok(Math.abs(c.maxPitchDeg - 15) <= 0.6);
  assert.ok(s.t35S !== null && s.t35S > 0.5 && s.t35S < 6);
  const ct = trace!.climb!;
  assert.ok(ct.t.length > 40 && ct.t.length < 200);
  for (let i = 1; i < ct.t.length - 1; i++) assert.ok(ct.t[i] - ct.t[i - 1] >= 0.95, 'one point a second');
});

test('height is zeroed on the wheels, whatever the simulator reads on the ground', async () => {
  const a = (await one()).summary;
  const b = (await one({ aglOffset: 11 })).summary;
  assert.equal(b.t35S, a.t35S);
  assert.equal(b.climb!.gearUpFt, a.climb!.gearUpFt);
});

test('the trace has liftoff at zero and covers the roll', async () => {
  const { trace, summary: s } = await one();
  const tr = trace!;
  const zero = tr.t.indexOf(0);
  assert.ok(zero > 0);
  assert.ok(tr.t[0] <= -s.rollS + 0.3, `starts at ${tr.t[0]}`);
  assert.ok(tr.t[tr.t.length - 1] >= 9.5);
  assert.equal(tr.agl[zero - 1], 0);
  assert.ok(Math.max(...tr.rate) > 2.5);
  assert.ok(JSON.stringify(tr).length < 70_000, `trace is ${JSON.stringify(tr).length} bytes`);
});

test('a rejected takeoff is saved as one, with the speed it reached', async () => {
  const { summary: s, trace } = await one({ rejectAtGs: 90 });
  assert.equal(s.kind, 'rejected');
  assert.ok(Math.abs((s.maxGsKt as number) - 90) <= 2);
  assert.equal(s.climb, undefined);
  assert.equal(s.rotIasKt, null);
  assert.ok((s.remainingM as number) > 1500);
  assert.equal(trace!.climb, undefined);
});

test('a fast taxi and a slow abandoned roll are not recorded', async () => {
  assert.equal((await record(simulateTakeoff({ rejectAtGs: 40 }))).length, 0);
  // Off a runway, even a faster roll is not a rejected takeoff.
  assert.equal((await record(simulateTakeoff({ rejectAtGs: 90 }), false)).length, 0);
});

test('without a runway the roll is still measured, from ground speed', async () => {
  const withRw = (await one()).summary;
  const recs = await record(simulateTakeoff(), false);
  assert.equal(recs.length, 1);
  const s = recs[0].summary;
  assert.equal(s.runway, null);
  assert.equal(s.clMaxM, null);
  assert.ok(Math.abs(s.rollM - withRw.rollM) <= 15, `${s.rollM} against ${withRw.rollM}`);
});

test('a landing rollout is not taken for a takeoff', async () => {
  assert.equal((await record(simulate())).length, 0);
  assert.equal((await record(simulate({ bounceS: 1.2, touchdownSink: 420 }))).length, 0);
});

test('the detector asks for the normal rate only around the roll', () => {
  const det = new TakeoffDetector({ onTakeoff: () => undefined });
  const rates = new Set<number>();
  let atTop = 0;
  for (const s of simulateTakeoff()) {
    det.push(s);
    rates.add(det.wantedRateHz);
    if (s.agl > 1000) atTop = Math.max(atTop, det.wantedRateHz);
  }
  assert.deepEqual(Array.from(rates).sort((a, b) => a - b), [4, 20]);
  assert.equal(atTop, 4);
});

test('a takeoff recorded at the sampling rates the app really uses gives the same figures', async () => {
  const all = simulateTakeoff();
  const full = (await record(all))[0].summary;
  // Feed the detector only the samples its own rate would have taken.
  const recs: TakeoffRecord[] = [];
  const det = new TakeoffDetector({ findRunways: async () => [RUNWAY], onTakeoff: (r) => recs.push(r) });
  let next = 0;
  for (const s of all) {
    if (s.t < next - 1e-6) continue;
    det.push(s);
    next = s.t + 1 / det.wantedRateHz;
  }
  await new Promise((r) => setTimeout(r, 0));
  const thin = recs[0].summary;
  assert.equal(thin.rotIasKt, full.rotIasKt);
  assert.equal(thin.liftoffPitchDeg, full.liftoffPitchDeg);
  assert.ok(Math.abs(thin.rollM - full.rollM) <= 8, `${thin.rollM} against ${full.rollM}`);
  assert.ok(Math.abs((thin.startM as number) - (full.startM as number)) <= 3);
});

test('findRotation ignores a pitch change that stops well before liftoff', () => {
  const s = simulateTakeoff({ rotRate: 0, vr: 60 });
  const li = s.findIndex((x) => !x.onGround);
  // A bump of 3 degrees that is over 6 s before liftoff.
  const bumped = s.map((x) => (s[li].t - x.t > 6 && s[li].t - x.t < 8 ? { ...x, pitch: x.pitch + 3 } : x));
  assert.equal(findRotation(bumped, li), null);
});

test('landings and takeoffs are stored side by side without touching each other', async () => {
  const store = new MemoryStore();
  const landings = new LandingLog(store);
  const takeoffs = new TakeoffLog(store);
  const rec = await one();
  takeoffs.add(rec);
  assert.equal(landings.list().length, 0);
  assert.equal(new TakeoffLog(store).list()[0].id, rec.summary.id);
  assert.ok(new TakeoffLog(store).getTrace(rec.summary.id)!.t.length > 0);
  assert.equal(takeoffs.isUnread(rec.summary.id), true);
  const keys = RecordLog.keysIn(store);
  assert.deepEqual(keys.sort(), ['to.index.0', 'to.index.pages', `to.trace.${rec.summary.id}`, 'to.unread'].sort());
  // Every key is a name the file module accepts.
  for (const k of keys) assert.match(k, /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/);

  // A landing recorded into the same store shows up in its own log only.
  const lrecs: unknown[] = [];
  const det = new LandingDetector({ findRunways: async () => [RUNWAY], onLanding: (r) => { lrecs.push(r); landings.add(r); } });
  for (const s of simulate()) det.push(s);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(lrecs.length, 1);
  assert.equal(new LandingLog(store).list().length, 1);
  assert.equal(new TakeoffLog(store).list().length, 1);
  takeoffs.remove(rec.summary.id);
  assert.equal(new LandingLog(store).list().length, 1);
  assert.equal(RecordLog.keysIn(store).some((k) => k.startsWith('to.trace')), false);
});
