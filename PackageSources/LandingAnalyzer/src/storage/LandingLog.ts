import type { LandingRecord, LandingSummary, LandingTrace } from '../core/types.ts';

/** Minimal key/value store. In the sim this is the DataStore (GetStoredData/SetStoredData). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Persistent landing log.
 *
 * Layout in the store (all keys prefixed so they don't clash with other addons):
 *   LANDAN.v1.index.pages  number of index pages
 *   LANDAN.v1.index.<n>    JSON array of up to PAGE_SIZE LandingSummary, newest first
 *   LANDAN.v1.trace.<id>   JSON LandingTrace for one landing (loaded on demand for graphs)
 *
 * Summaries are about 1.3 KB each and traces about 8 KB (measured by the tests). The SDK does
 * not document a size limit, so no single key is allowed to grow past roughly 70 KB: the index
 * is split into pages, at most MAX_SUMMARIES landings are kept, and only the newest MAX_TRACES
 * keep their graphs. Older landings stay in the list with their numbers only.
 */
export class LandingLog {
  static readonly PREFIX = 'LANDAN.v1.';
  static readonly MAX_SUMMARIES = 500;
  static readonly MAX_TRACES = 60;
  static readonly PAGE_SIZE = 50;

  private readonly store: KeyValueStore;
  private index: LandingSummary[] = [];
  private readonly listeners = new Set<() => void>();
  /** Example landings shown while the log is empty. Kept in memory only, never written. */
  private examples: LandingRecord[] = [];

  constructor(store: KeyValueStore) {
    this.store = store;
    this.index = this.readIndex();
  }

  /** Set the examples to show while no real landing has been logged. */
  setExamples(recs: LandingRecord[]): void {
    this.examples = recs;
  }

  /** True while the list shows examples rather than real landings. */
  get showingExamples(): boolean {
    return this.index.length === 0 && this.examples.length > 0;
  }

  /** Newest first. */
  list(): readonly LandingSummary[] {
    return this.index.length === 0 ? this.examples.map((r) => r.summary) : this.index;
  }

  latest(): LandingSummary | null {
    return this.list()[0] ?? null;
  }

  getTrace(id: string): LandingTrace | null {
    const ex = this.examples.find((r) => r.summary.id === id);
    if (ex) return ex.trace;
    const raw = this.store.get(LandingLog.PREFIX + 'trace.' + id);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LandingTrace;
    } catch {
      return null;
    }
  }

  add(rec: LandingRecord): void {
    this.index.unshift(rec.summary);
    if (rec.trace) this.store.set(LandingLog.PREFIX + 'trace.' + rec.summary.id, JSON.stringify(rec.trace));

    // Prune graphs beyond MAX_TRACES and summaries beyond MAX_SUMMARIES.
    for (let i = LandingLog.MAX_TRACES; i < this.index.length; i++) {
      this.store.remove(LandingLog.PREFIX + 'trace.' + this.index[i].id);
    }
    if (this.index.length > LandingLog.MAX_SUMMARIES) this.index.length = LandingLog.MAX_SUMMARIES;
    this.writeIndex();
  }

  remove(id: string): void {
    this.index = this.index.filter((s) => s.id !== id);
    this.store.remove(LandingLog.PREFIX + 'trace.' + id);
    this.writeIndex();
  }

  /** Medians over the logged landings (touch-and-goes excluded) for the Log page. */
  stats(): { count: number; medianVs: number; medianTdM: number | null; medianClM: number | null } | null {
    const xs = this.list().filter((s) => !s.touchAndGo);
    if (xs.length === 0) return null;
    const geo = xs.filter((s) => s.geometry);
    return {
      count: xs.length,
      medianVs: median(xs.map((s) => s.touchdownVsFpm)),
      medianTdM: geo.length ? median(geo.map((s) => s.geometry!.distFromThresholdM)) : null,
      medianClM: geo.length ? median(geo.map((s) => Math.abs(s.geometry!.centerlineOffsetM))) : null,
    };
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

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private readIndex(): LandingSummary[] {
    const pages = Number(this.store.get(LandingLog.PREFIX + 'index.pages') ?? 0) || 0;
    const out: LandingSummary[] = [];
    for (let p = 0; p < pages; p++) {
      const raw = this.store.get(LandingLog.PREFIX + 'index.' + p);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) out.push(...parsed);
      } catch {
        // A damaged page loses at most PAGE_SIZE landings, not the whole log.
      }
    }
    return out;
  }

  private writeIndex(): void {
    const oldPages = Number(this.store.get(LandingLog.PREFIX + 'index.pages') ?? 0) || 0;
    const pages = Math.ceil(this.index.length / LandingLog.PAGE_SIZE);
    for (let p = 0; p < pages; p++) {
      const page = this.index.slice(p * LandingLog.PAGE_SIZE, (p + 1) * LandingLog.PAGE_SIZE);
      this.store.set(LandingLog.PREFIX + 'index.' + p, JSON.stringify(page));
    }
    for (let p = pages; p < oldPages; p++) this.store.remove(LandingLog.PREFIX + 'index.' + p);
    this.store.set(LandingLog.PREFIX + 'index.pages', String(pages));
    this.listeners.forEach((fn) => fn());
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** In-memory store for tests and for running the UI outside the sim. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}
