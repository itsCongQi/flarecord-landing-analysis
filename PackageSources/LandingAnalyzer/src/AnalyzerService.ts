import { EventBus, Subject } from '@microsoft/msfs-sdk';
import { LandingDetector } from './core/LandingDetector.ts';
import type { LandingSummary, Sample } from './core/types.ts';
import { RunwayProvider } from './sim/RunwayProvider.ts';
import { SimVarSampler } from './sim/SimVarSampler.ts';
import { DataStoreAdapter } from './storage/DataStoreAdapter.ts';
import { LandingLog } from './storage/LandingLog.ts';

/**
 * Always-on capture service. Started from App.install(), which the EFB calls when it boots with
 * the flight, so recording does not depend on the tablet being open or this app being shown.
 * (Confirmed in practice by other EFB apps that track "in the background, even with the EFB
 * closed"; still to be verified for this addon in the sim, see README, "Open risks".)
 */
export class AnalyzerService {
  private static _instance: AnalyzerService | null = null;

  static get instance(): AnalyzerService {
    if (!this._instance) throw new Error('AnalyzerService not started');
    return this._instance;
  }

  static start(bus: EventBus): AnalyzerService {
    if (!this._instance) this._instance = new AnalyzerService(bus);
    return this._instance;
  }

  readonly log = new LandingLog(new DataStoreAdapter());
  /** Latest live sample, for the Live strip at the top of the app. */
  readonly live = Subject.create<Sample | null>(null);
  /** The landing shown on the Analysis page. */
  readonly selected = Subject.create<LandingSummary | null>(this.log.latest());
  /** Detector phase, for a small status chip ("Armed", "Recording rollout"). */
  readonly phase = Subject.create<string>('idle');

  private readonly detector: LandingDetector;
  private readonly sampler: SimVarSampler;

  private constructor(bus: EventBus) {
    const runways = new RunwayProvider(bus);
    this.detector = new LandingDetector({
      findRunways: (lat, lon) => runways.findRunways(lat, lon),
      simTouchdownVs: SimVarSampler.simTouchdownVs,
      aircraftName: SimVarSampler.aircraftTitle,
      onLanding: (rec) => {
        this.log.add(rec);
        this.selected.set(rec.summary);
      },
    });
    let n = 0;
    this.sampler = new SimVarSampler((s) => {
      this.detector.push(s);
      // Publishing to the UI at 4 Hz is plenty and keeps Coherent DOM work low.
      if (++n % 5 === 0) {
        this.live.set(s);
        this.phase.set(this.detector.currentPhase);
      }
    });
    this.sampler.start();
  }
}
