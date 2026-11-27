import { summarize, type LandingStats } from '../core/summary.ts';
import type { LandingSummary, LandingTrace, TakeoffSummary, TakeoffTrace } from '../core/types.ts';
import { MemoryStore, RecordLog, type KeyValueStore } from './RecordLog.ts';

export { MemoryStore, type KeyValueStore };

/** The persistent landing log. See RecordLog for how it is stored. */
export class LandingLog extends RecordLog<LandingSummary, LandingTrace> {
  /** Prefix used before the app was named Flarecord. Its data is moved over on first start. */
  static readonly LEGACY_PREFIX = 'LANDAN.v1.';

  constructor(store: KeyValueStore) {
    // The earlier log has to be in place before the index is read.
    LandingLog.migrateLegacy(store);
    super(store, '');
  }

  /** Medians over the logged landings (touch-and-goes excluded). */
  stats(): LandingStats | null {
    return summarize(this.list());
  }

  /** CSV of every summary, for copying out of the sim. */
  toCsv(): string {
    const head = 'date,aircraft,airport,runway,vs_fpm,peak_g,ias_kt,pitch,bank,crab,headwind,crosswind,bounces,flare_ft,float_s,threshold_m,centerline_m,score,grade';
    const rows = this.index.map((s) =>
      [
        new Date(s.recordedAt).toISOString(),
        JSON.stringify(s.aircraft),
        s.geometry?.runway.airportIdent ?? '',
        s.geometry?.runway.designation ?? '',
        s.touchdownVsFpm,
        s.peakG,
        s.touchdownIasKt,
        s.pitchDeg,
        s.bankDeg,
        s.crabDeg,
        s.headwindKt,
        s.crosswindKt,
        s.bounces,
        s.flare.flareHeightFt?.toFixed(0) ?? '',
        s.flare.floatTimeS.toFixed(1),
        s.geometry?.distFromThresholdM.toFixed(0) ?? '',
        s.geometry?.centerlineOffsetM.toFixed(1) ?? '',
        s.score.total,
        s.score.grade,
      ].join(','),
    );
    return [head, ...rows].join('\n');
  }

  /**
   * Move a log saved under the old key prefix to the current one, once. The store cannot list its
   * keys, so the known ones are walked: index pages, the traces of the landings in them, the
   * unread list, the settings and the stored preferences. Old keys are removed only after
   * everything has been copied.
   */
  private static migrateLegacy(store: KeyValueStore): void {
    const from = LandingLog.LEGACY_PREFIX;
    const to = LandingLog.PREFIX;
    try {
      const rawPages = store.get(from + 'index.pages');
      const keys = ['settings', 'unread', 'pref.summaryAircraft'];
      if (store.get(to + 'index.pages') !== null) return;
      if (rawPages !== null) {
        keys.push('index.pages');
        const pages = Number(rawPages) || 0;
        for (let p = 0; p < pages; p++) {
          keys.push('index.' + p);
          try {
            const parsed = JSON.parse(store.get(from + 'index.' + p) ?? '[]');
            if (Array.isArray(parsed)) for (const s of parsed) if (s && typeof s.id === 'string') keys.push('trace.' + s.id);
          } catch {
            // A damaged page is copied as it is; its traces cannot be found.
          }
        }
      }
      const found = keys.filter((k) => store.get(from + k) !== null);
      for (const k of found) if (store.get(to + k) === null) store.set(to + k, store.get(from + k)!);
      for (const k of found) store.remove(from + k);
    } catch (e) {
      console.error('Flarecord: could not move the earlier log', e);
    }
  }

}

/** The persistent takeoff log, kept beside the landing log under its own keys. */
export class TakeoffLog extends RecordLog<TakeoffSummary, TakeoffTrace> {
  constructor(store: KeyValueStore) {
    super(store, 'to.');
  }
}
