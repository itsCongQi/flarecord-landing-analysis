import { EventBus, Subject } from '@microsoft/msfs-sdk';
import { mark } from './boot.ts';
import { LandingDetector } from './core/LandingDetector.ts';
import type { LandingSummary, Sample } from './core/types.ts';
import { parseSettings, type Settings } from './core/units.ts';
import { simCommBus } from './sim/CommBus.ts';
import { RunwayProvider } from './sim/RunwayProvider.ts';
import { SimVarSampler } from './sim/SimVarSampler.ts';
import { DataStoreAdapter } from './storage/DataStoreAdapter.ts';
import { FileBridge } from './storage/FileBridge.ts';
import { LandingLog } from './storage/LandingLog.ts';
import { MirroredStore } from './storage/MirroredStore.ts';

/**
 * Always-on capture service. Started from App.install(), which the EFB calls when it boots with
 * the flight, so recording does not depend on the tablet being open or this app being shown.
 * (Confirmed in practice by other EFB apps that track "in the background, even with the EFB
 * closed"; still to be verified for this addon in the sim, see README, "Open risks".)
 */
const SETTINGS_KEY = LandingLog.PREFIX + 'settings';

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

  /** The DataStore, mirrored to files through the storage module when it is there. */
  readonly store = AnalyzerService.createStore();
  /** Raised when the state of file storage changes, so Settings can show it. */
  readonly fileState = Subject.create<string>(this.store.state);

  // The file side is attached later (see the constructor): nothing about it may stop the app
  // from starting.
  private static createStore(): MirroredStore {
    return new MirroredStore(new DataStoreAdapter(), null);
  }

  readonly log = this.createLog();
  /** Latest live sample, for the Live strip at the top of the app. */
  readonly live = Subject.create<Sample | null>(null);
  /** The landing shown on the Analysis page. */
  readonly selected = Subject.create<LandingSummary | null>(this.log.latest());
  /** Detector phase, for a small status chip ("Armed", "Recording rollout"). */
  readonly phase = Subject.create<string>('idle');

  /** Display units and options, saved next to the log. */
  readonly settings = Subject.create<Settings>(parseSettings(this.store.get(SETTINGS_KEY)));

  /** Connect to the storage module and bring files and DataStore in step, in the background. */
  private startFiles(): void {
    try {
      const bus = simCommBus();
      if (!bus) return;
      this.store.attach(new FileBridge(bus));
      this.fileState.set(this.store.state);
      this.store
        .start()
        .then((changed) => {
          if (changed) {
            const wasEmpty = this.log.list().length === 0;
            this.log.reload();
            this.settings.set(parseSettings(this.store.get(SETTINGS_KEY)));
            const cur = this.selected.get();
            if (wasEmpty || !cur || !this.log.list().some((x) => x.id === cur.id)) this.selected.set(this.log.latest());
          }
          this.fileState.set(this.store.state);
          mark(`file storage ${this.store.state}, ${this.store.startResult}`);
        })
        .catch((e) => mark('file storage failed', e));
    } catch (e) {
      mark('file storage not available', e);
    }
  }

  private readonly detector: LandingDetector;
  private readonly sampler: SimVarSampler;

  /** The persistent log. It starts empty: the pages say so until the first landing. */
  private createLog(): LandingLog {
    return new LandingLog(this.store);
  }

  setSettings(patch: Partial<Settings>): void {
    const next = { ...this.settings.get(), ...patch };
    this.store.set(SETTINGS_KEY, JSON.stringify(next));
    this.settings.set(next);
  }

  /** Small UI preferences kept next to the log (e.g. the Summary's aircraft selection). */
  getPref(key: string): string | null {
    return this.store.get(LandingLog.PREFIX + 'pref.' + key);
  }

  setPref(key: string, value: string | null): void {
    if (value === null) this.store.remove(LandingLog.PREFIX + 'pref.' + key);
    else this.store.set(LandingLog.PREFIX + 'pref.' + key, value);
  }

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
    let shownT = -1;
    this.sampler = new SimVarSampler(
      (s) => {
        this.detector.push(s);
        // Publishing to the UI at 4 Hz is plenty and keeps Coherent DOM work low.
        if (s.t - shownT >= 0.25 || s.t < shownT) {
          shownT = s.t;
          this.live.set(s);
          this.phase.set(this.detector.currentPhase);
        }
      },
      20,
      () => this.detector.wantsFastSampling,
    );
    this.sampler.start();
    // Well after the app has registered, so a problem here can never keep it off the tablet.
    setTimeout(() => this.startFiles(), 3000);
  }
}
