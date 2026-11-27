/** Minimal key/value store. In the sim this is the DataStore (GetStoredData/SetStoredData). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** What every logged record has: an id, and the time it was recorded. */
export interface Logged {
  id: string;
  recordedAt: number;
}

/**
 * A persistent, paged list of records with their graphs, newest first. The landing log and the
 * takeoff log are each one of these, told apart by a namespace in front of their keys.
 *
 * Layout in the store (all keys prefixed so they don't clash with other addons; <ns> is empty
 * for landings and "to." for takeoffs):
 *   FLARECORD.v1.<ns>index.pages  number of index pages
 *   FLARECORD.v1.<ns>index.<n>    JSON array of up to PAGE_SIZE summaries, newest first
 *   FLARECORD.v1.<ns>trace.<id>   JSON trace for one record (loaded on demand for graphs)
 *   FLARECORD.v1.<ns>unread       JSON array of ids of records that have not been opened yet
 *
 * Summaries are about 2 KB each and traces up to about 25 KB (measured by the tests). The SDK does
 * not document a size limit, so no single key is allowed to grow past roughly 70 KB: the index
 * is split into pages, at most MAX_SUMMARIES records are kept, and only the newest MAX_TRACES
 * keep their graphs. Older records stay in the list with their numbers only.
 */
export class RecordLog<S extends Logged, T> {
  static readonly PREFIX = 'FLARECORD.v1.';
  static readonly MAX_SUMMARIES = 500;
  static readonly MAX_TRACES = 60;
  static readonly PAGE_SIZE = 25;
  /** Namespaces of the logs the app keeps: landings, then takeoffs. */
  static readonly NAMESPACES = ['', 'to.'];

  protected readonly store: KeyValueStore;
  protected readonly ns: string;
  protected index: S[] = [];
  private readonly listeners = new Set<() => void>();
  /** Ids of records not opened yet. */
  private unread = new Set<string>();

  constructor(store: KeyValueStore, ns: string) {
    this.store = store;
    this.ns = ns;
    this.index = this.readIndex();
    this.unread = this.readUnread();
  }

  private key(k: string): string {
    return RecordLog.PREFIX + this.ns + k;
  }

  isUnread(id: string): boolean {
    return this.unread.has(id);
  }

  /** Records not opened yet, newest first. */
  unreadList(): S[] {
    return this.index.filter((s) => this.unread.has(s.id));
  }

  /** Mark a record as opened. Does nothing (and notifies nobody) when it already was. */
  markRead(id: string): void {
    if (!this.unread.delete(id)) return;
    this.writeUnread();
    this.listeners.forEach((fn) => fn());
  }

  /** Newest first. */
  list(): readonly S[] {
    return this.index;
  }

  latest(): S | null {
    return this.list()[0] ?? null;
  }

  getTrace(id: string): T | null {
    const raw = this.store.get(this.key('trace.' + id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  add(rec: { summary: S; trace: T | null }): void {
    this.index.unshift(rec.summary);
    this.unread.add(rec.summary.id);
    if (rec.trace) this.store.set(this.key('trace.' + rec.summary.id), JSON.stringify(rec.trace));

    // Prune graphs beyond MAX_TRACES and summaries beyond MAX_SUMMARIES.
    for (let i = RecordLog.MAX_TRACES; i < this.index.length; i++) {
      this.store.remove(this.key('trace.' + this.index[i].id));
    }
    if (this.index.length > RecordLog.MAX_SUMMARIES) this.index.length = RecordLog.MAX_SUMMARIES;
    this.writeUnread();
    this.writeIndex();
  }

  remove(id: string): void {
    this.index = this.index.filter((s) => s.id !== id);
    this.store.remove(this.key('trace.' + id));
    if (this.unread.delete(id)) this.writeUnread();
    this.writeIndex();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Read the log again after the store was changed from outside (files loaded at start). */
  reload(): void {
    this.index = this.readIndex();
    this.unread = this.readUnread();
    this.listeners.forEach((fn) => fn());
  }

  private readIndex(): S[] {
    return RecordLog.readIndexFrom(this.store, this.ns) as S[];
  }

  static readIndexFrom(store: KeyValueStore, ns = ''): Logged[] {
    const pages = Number(store.get(RecordLog.PREFIX + ns + 'index.pages') ?? 0) || 0;
    const out: Logged[] = [];
    for (let p = 0; p < pages; p++) {
      const raw = store.get(RecordLog.PREFIX + ns + 'index.' + p);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) out.push(...parsed);
      } catch {
        // A damaged page loses at most PAGE_SIZE records, not the whole log.
      }
    }
    return out;
  }

  private readUnread(): Set<string> {
    const out = new Set<string>();
    try {
      const parsed = JSON.parse(this.store.get(this.key('unread')) ?? '[]');
      const known = new Set(this.index.map((s) => s.id));
      if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === 'string' && known.has(id)) out.add(id);
    } catch {
      // Damaged list: everything counts as read.
    }
    return out;
  }

  private writeUnread(): void {
    // Drop ids of records that have been pruned from the log.
    const known = new Set(this.index.map((s) => s.id));
    Array.from(this.unread).forEach((id) => {
      if (!known.has(id)) this.unread.delete(id);
    });
    if (this.unread.size === 0) this.store.remove(this.key('unread'));
    else this.store.set(this.key('unread'), JSON.stringify(Array.from(this.unread)));
  }

  private writeIndex(): void {
    RecordLog.writeIndexTo(this.store, this.index, this.ns);
    this.listeners.forEach((fn) => fn());
  }

  static writeIndexTo(store: KeyValueStore, index: readonly Logged[], ns = ''): void {
    const oldPages = Number(store.get(RecordLog.PREFIX + ns + 'index.pages') ?? 0) || 0;
    const pages = Math.ceil(index.length / RecordLog.PAGE_SIZE);
    for (let p = 0; p < pages; p++) {
      const page = index.slice(p * RecordLog.PAGE_SIZE, (p + 1) * RecordLog.PAGE_SIZE);
      store.set(RecordLog.PREFIX + ns + 'index.' + p, JSON.stringify(page));
    }
    for (let p = pages; p < oldPages; p++) store.remove(RecordLog.PREFIX + ns + 'index.' + p);
    store.set(RecordLog.PREFIX + ns + 'index.pages', String(pages));
  }

  /** Keys outside the indexes and the traces that belong to the app's saved state. */
  static readonly EXTRA_KEYS = ['settings', 'unread', 'to.unread', 'pref.summaryAircraft'];

  /**
   * Every key the app has in a store, without the prefix. The store cannot list its keys, so
   * the known ones are walked: the index pages of each log, the traces of the records in them
   * and the extras.
   */
  static keysIn(store: KeyValueStore): string[] {
    const keys: string[] = [];
    const has = (k: string) => store.get(RecordLog.PREFIX + k) !== null;
    for (const ns of RecordLog.NAMESPACES) {
      if (has(ns + 'index.pages')) keys.push(ns + 'index.pages');
      const pages = Number(store.get(RecordLog.PREFIX + ns + 'index.pages') ?? 0) || 0;
      for (let p = 0; p < pages; p++) if (has(ns + 'index.' + p)) keys.push(ns + 'index.' + p);
      for (const s of RecordLog.readIndexFrom(store, ns)) if (has(ns + 'trace.' + s.id)) keys.push(ns + 'trace.' + s.id);
    }
    for (const k of RecordLog.EXTRA_KEYS) if (has(k)) keys.push(k);
    return keys;
  }
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
