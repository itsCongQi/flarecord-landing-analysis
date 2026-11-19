import type { LandingSummary } from '../core/types.ts';
import type { FileBridge } from './FileBridge.ts';
import { LandingLog, type KeyValueStore } from './LandingLog.ts';

export type FileState = 'starting' | 'active' | 'unavailable';

const REV = 'rev';

/**
 * The app's store: the sim's DataStore for instant, synchronous reads, mirrored to files through
 * the storage module so the data can be seen, backed up and restored by hand.
 *
 * Every write goes to both. A revision number, raised after each burst of writes and kept on both
 * sides, tells at start whether they still agree:
 *
 *   no revision in the files   first run with file storage: everything in the DataStore is written out
 *   same revision              nothing to do
 *   different                  the two are merged. Landings from both sides are kept (matched by id),
 *                              settings and the unread list are taken from the files, and the result
 *                              is written to both. This covers a DataStore that lost data, a backup
 *                              copied back into the folder, and writes that never reached the files.
 *
 * If the module does not answer, the app carries on with the DataStore alone.
 */
export class MirroredStore implements KeyValueStore {
  state: FileState = 'starting';
  /** What happened at start, for the Settings page. */
  startResult: 'pending' | 'in step' | 'first copy' | 'merged' | 'no module' = 'pending';
  moduleVersion: string | null = null;
  private bumpTimer: ReturnType<typeof setTimeout> | null = null;
  /** Keys written while the files were still being checked at start. */
  private readonly early = new Set<string>();

  private readonly inner: KeyValueStore;
  private bridge: FileBridge | null;
  private readonly prefix: string;

  constructor(inner: KeyValueStore, bridge: FileBridge | null, prefix = LandingLog.PREFIX) {
    this.inner = inner;
    this.bridge = bridge;
    this.prefix = prefix;
    if (!bridge) this.unavailable();
  }

  get(key: string): string | null {
    return this.inner.get(key);
  }

  set(key: string, value: string): void {
    this.inner.set(key, value);
    this.mirror(key, value);
  }

  remove(key: string): void {
    this.inner.remove(key);
    this.mirror(key, '');
  }

  /** Requests to the module that failed since the start. */
  get failures(): number {
    return this.bridge?.failures ?? 0;
  }

  private unavailable(): void {
    this.state = 'unavailable';
    this.startResult = 'no module';
  }

  private mirror(key: string, value: string): void {
    if (key.indexOf(this.prefix) !== 0) return;
    const short = key.slice(this.prefix.length);
    // Not in step with the files (yet): remember the key, it is sent once start() has finished.
    if (!this.bridge || this.state !== 'active') {
      if (short !== REV) this.early.add(short);
      return;
    }
    void this.bridge.write(short, value);
    // One revision step per burst of writes (a landing is several keys).
    if (this.bumpTimer === null) {
      this.bumpTimer = setTimeout(() => {
        this.bumpTimer = null;
        this.writeRev(this.rev(this.inner.get(this.prefix + REV)) + 1);
      }, 0);
    }
  }

  private rev(raw: string | null): number {
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  private writeRev(n: number): Promise<boolean> {
    this.inner.set(this.prefix + REV, String(n));
    return (this.bridge as FileBridge).write(REV, String(n));
  }

  /** Give the store its bridge after construction; follow with start(). */
  attach(bridge: FileBridge): void {
    this.bridge = bridge;
    this.state = 'starting';
    this.startResult = 'pending';
  }

  /**
   * Find the module and bring files and DataStore in step. Resolves true when the DataStore was
   * changed, so the caller reloads what it had read from it.
   */
  async start(pingTries = 15, pingGapMs = 1000): Promise<boolean> {
    const bridge = this.bridge;
    if (!bridge) return false;
    // The module is loaded by the sim on its own schedule: keep asking for a while.
    for (let i = 0; i < pingTries && this.moduleVersion === null; i++) {
      this.moduleVersion = await bridge.ping();
      if (this.moduleVersion === null && i < pingTries - 1) await new Promise((r) => setTimeout(r, pingGapMs));
    }
    if (this.moduleVersion === null) {
      this.unavailable();
      return false;
    }

    let changed = false;
    try {
      const fileRev = await bridge.read(REV);
      if (fileRev.status === 'ERR') throw new Error('revision could not be read');
      const storeRev = this.rev(this.inner.get(this.prefix + REV));
      if (fileRev.status === 'MISSING') {
        await this.pushAll(storeRev + 1);
        this.startResult = 'first copy';
      } else if (this.rev(fileRev.value) === storeRev && storeRev > 0) {
        this.startResult = 'in step';
      } else {
        changed = await this.merge();
        await this.pushAll(Math.max(storeRev, this.rev(fileRev.value)) + 1);
        this.startResult = 'merged';
      }
    } catch (e) {
      console.error('Flarecord: file storage could not be checked', e);
      this.unavailable();
      return changed;
    }

    this.state = 'active';
    // Writes made while this ran went to the DataStore only: send them now.
    const early = Array.from(this.early);
    this.early.clear();
    for (const k of early) this.mirror(this.prefix + k, this.inner.get(this.prefix + k) ?? '');
    return changed;
  }

  /** Write every key the DataStore holds to the files, then the revision on both sides. */
  private async pushAll(rev: number): Promise<void> {
    const bridge = this.bridge as FileBridge;
    for (const k of LandingLog.keysIn(this.inner)) {
      if (!(await bridge.write(k, this.inner.get(this.prefix + k) ?? ''))) throw new Error(`could not write ${k}`);
    }
    if (!(await this.writeRev(rev))) throw new Error('could not write the revision');
  }

  /** Bring what the files hold into the DataStore without dropping anything it has. */
  private async merge(): Promise<boolean> {
    const bridge = this.bridge as FileBridge;
    let changed = false;
    const take = async (k: string): Promise<string | null> => {
      const r = await bridge.read(k);
      return r.status === 'OK' ? r.value : null;
    };

    // Landings from the files.
    const fromFiles: LandingSummary[] = [];
    const pages = Number((await take('index.pages')) ?? 0) || 0;
    for (let p = 0; p < pages; p++) {
      try {
        const parsed = JSON.parse((await take('index.' + p)) ?? '[]');
        if (Array.isArray(parsed)) for (const s of parsed) if (s && typeof s.id === 'string') fromFiles.push(s);
      } catch {
        // A damaged file loses its page only.
      }
    }
    const mine = LandingLog.readIndexFrom(this.inner);
    const known = new Set(mine.map((s) => s.id));
    const extra = fromFiles.filter((s) => !known.has(s.id));
    const all = mine.concat(extra).sort((a, b) => b.recordedAt - a.recordedAt);
    if (all.length > LandingLog.MAX_SUMMARIES) all.length = LandingLog.MAX_SUMMARIES;
    if (extra.length > 0) {
      LandingLog.writeIndexTo(this.inner, all);
      changed = true;
    }

    // Graphs the DataStore lacks, for the landings that keep one.
    for (const s of all.slice(0, LandingLog.MAX_TRACES)) {
      const key = this.prefix + 'trace.' + s.id;
      if (this.inner.get(key) !== null) continue;
      const v = await take('trace.' + s.id);
      if (v !== null) {
        this.inner.set(key, v);
        changed = true;
      }
    }

    // Settings, the unread list and preferences: the files decide where they have a value.
    for (const k of LandingLog.EXTRA_KEYS) {
      const v = await take(k);
      if (v !== null && v !== this.inner.get(this.prefix + k)) {
        this.inner.set(this.prefix + k, v);
        changed = true;
      }
    }
    return changed;
  }
}
