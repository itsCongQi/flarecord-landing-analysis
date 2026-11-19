/**
 * Generates the example landings the app shows while the user's log is empty.
 * Runs the real detector and scoring over simulated approaches (see simulate.ts), so the example
 * numbers and graphs are exactly what the analysis would produce.
 *
 *   node --experimental-strip-types --no-warnings test/make-examples.ts
 */
import { writeFileSync } from 'node:fs';
import { LandingDetector } from '../PackageSources/Flarecord/src/core/LandingDetector.ts';
import type { LandingRecord } from '../PackageSources/Flarecord/src/core/types.ts';
import { RUNWAY, simulate, type Scenario } from './simulate.ts';

const OUT = new URL('../PackageSources/Flarecord/src/demo/exampleLandings.json', import.meta.url);

// Newest first. recordedAt is spaced a day apart ending on a fixed date, so the file is stable.
const SCENARIOS: { aircraft: string; sc: Partial<Scenario> }[] = [
  { aircraft: 'Example: smooth landing', sc: {} },
  { aircraft: 'Example: bounced landing', sc: { flareAt: 18, touchdownSink: 420, bounceS: 1.2, lateralM: -3.5, crabDeg: 2.5 } },
  { aircraft: 'Example: firm, no flare', sc: { flareAt: 0, touchdownSink: 650, lateralM: 6, windDir: 330, windSpd: 18 } },
];

const END = Date.UTC(2026, 10, 18, 18, 0, 0);

async function main(): Promise<void> {
  const out: LandingRecord[] = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const { aircraft, sc } = SCENARIOS[i];
    const recs: LandingRecord[] = [];
    const det = new LandingDetector({
      findRunways: async () => [{ ...RUNWAY, airportIdent: 'DEMO' }],
      onLanding: (r) => recs.push(r),
      aircraftName: () => aircraft,
      now: () => END - i * 86_400_000,
    });
    for (const s of simulate(sc)) det.push(s);
    await new Promise((r) => setTimeout(r, 0));
    if (recs.length !== 1) throw new Error(`${aircraft}: expected 1 landing, got ${recs.length}`);
    const rec = recs[0];
    rec.summary.id = `example${i + 1}`;
    rec.summary.example = true;
    out.push(rec);
    console.log(`${aircraft}: ${rec.summary.touchdownVsFpm} fpm, ${Math.round(rec.summary.geometry!.distFromThresholdM)} m from threshold`);
  }
  writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`wrote ${OUT.pathname}`);
}

void main();
