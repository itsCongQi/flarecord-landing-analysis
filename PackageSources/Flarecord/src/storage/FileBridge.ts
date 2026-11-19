/**
 * Talks to the Flarecord storage module (a small WASM module in this package) over the sim's
 * Comm Bus. The module reads and writes one file per key in its work folder, which is the only
 * place an addon may write files.
 *
 * Wire format, kept free of JSON so the module needs no parser:
 *   request  FLARECORD_FS_REQ   "<id>\n<op>\n<key>\n<value>"     op: P ping, R read, W write
 *   reply    FLARECORD_FS_RES   "<id>\n<status>\n<value>"        status: OK, MISSING, ERR
 * Writing an empty value clears the file, and an empty file reads back as MISSING.
 *
 * Requests go out one at a time, so two writes to the same key can never overtake each other. A
 * write still waiting in the queue is replaced by a newer write to the same key.
 */
export interface BusLike {
  send(event: string, data: string): void;
  on(event: string, fn: (data: string) => void): void;
}

export const REQ_EVENT = 'FLARECORD_FS_REQ';
export const RES_EVENT = 'FLARECORD_FS_RES';

export type ReadResult = { status: 'OK'; value: string } | { status: 'MISSING' } | { status: 'ERR' };

interface Job {
  op: 'P' | 'R' | 'W';
  key: string;
  value: string;
  done: ((status: string, value: string) => void)[];
}

export class FileBridge {
  private readonly queue: Job[] = [];
  private current: { id: string; job: Job; timer: ReturnType<typeof setTimeout> } | null = null;
  private nextId = 1;
  /** Requests that got no answer or an error since the start. */
  failures = 0;

  private readonly bus: BusLike;
  private readonly timeoutMs: number;
  /** Marks this bridge's requests, so two bridges on one bus do not take each other's answers. */
  private readonly tag: string;

  constructor(bus: BusLike, timeoutMs = 5000, tag = 'm') {
    this.bus = bus;
    this.timeoutMs = timeoutMs;
    this.tag = tag;
    bus.on(RES_EVENT, (data) => this.onReply(String(data)));
  }

  /** The module's version string, or null when it does not answer. */
  ping(): Promise<string | null> {
    return this.push('P', '', '').then((r) => (r.status === 'OK' ? r.value : null));
  }

  read(key: string): Promise<ReadResult> {
    return this.push('R', key, '').then((r) => (r.status === 'OK' ? { status: 'OK', value: r.value } : r.status === 'MISSING' ? { status: 'MISSING' } : { status: 'ERR' }));
  }

  /** Resolves true when the module confirms the write. An empty value clears the file. */
  write(key: string, value: string): Promise<boolean> {
    return this.push('W', key, value).then((r) => r.status === 'OK');
  }

  /** Requests waiting or in flight. */
  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  private push(op: Job['op'], key: string, value: string): Promise<{ status: string; value: string }> {
    return new Promise((resolve) => {
      const done = (status: string, v: string) => resolve({ status, value: v });
      if (op === 'W') {
        const waiting = this.queue.find((j) => j.op === 'W' && j.key === key);
        if (waiting) {
          waiting.value = value;
          waiting.done.push(done);
          return;
        }
      }
      this.queue.push({ op, key, value, done: [done] });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    const job = this.queue.shift() as Job;
    const id = `${this.tag}${this.nextId++}`;
    const timer = setTimeout(() => this.finish(id, 'ERR', ''), this.timeoutMs);
    this.current = { id, job, timer };
    try {
      this.bus.send(REQ_EVENT, `${id}\n${job.op}\n${job.key}\n${job.value}`);
    } catch (e) {
      this.finish(id, 'ERR', '');
    }
  }

  private onReply(raw: string): void {
    // The module sends a C string: drop a terminating zero if it came through.
    const data = raw.replace(/\0+$/, '');
    const a = data.indexOf('\n');
    const b = a < 0 ? -1 : data.indexOf('\n', a + 1);
    if (b < 0) return;
    this.finish(data.slice(0, a), data.slice(a + 1, b), data.slice(b + 1));
  }

  private finish(id: string, status: string, value: string): void {
    const cur = this.current;
    // A late answer to a request that already timed out is ignored.
    if (!cur || cur.id !== id) return;
    clearTimeout(cur.timer);
    this.current = null;
    if (status !== 'OK' && status !== 'MISSING') this.failures++;
    for (const fn of cur.job.done) fn(status, value);
    this.pump();
  }
}
