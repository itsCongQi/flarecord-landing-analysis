// Runs the compiled storage module itself against a stand-in for the simulator: the Comm Bus and
// the file functions it imports are implemented here over a Map, and the real FileBridge and
// MirroredStore talk to it. Skipped when the module has not been built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FileBridge, REQ_EVENT, RES_EVENT } from '../PackageSources/Flarecord/src/storage/FileBridge.ts';
import { LandingLog, MemoryStore } from '../PackageSources/Flarecord/src/storage/LandingLog.ts';
import { MirroredStore } from '../PackageSources/Flarecord/src/storage/MirroredStore.ts';

const WASM = new URL('../PackageSources/Flarecord/modules/flarecord_storage.wasm', import.meta.url);

async function loadModule(disk = new Map<string, Uint8Array>()) {
  let inst: WebAssembly.Instance;
  const mem = () => new Uint8Array((inst.exports.memory as WebAssembly.Memory).buffer);
  const table = () => inst.exports.__indirect_function_table as WebAssembly.Table;
  const cstr = (p: number) => {
    const m = mem();
    let e = p;
    while (m[e] !== 0) e++;
    return Buffer.from(m.subarray(p, e)).toString('utf8');
  };
  const handlers = new Map<string, number>();
  const jsListeners: ((data: string) => void)[] = [];
  const files = new Map<bigint, { path: string; err: number; open: boolean }>();
  let next = 1n;
  const later = (fn: () => void) => setTimeout(fn, 0);
  const env = {
    fsCommBusRegister: (name: number, cb: number) => (handlers.set(cstr(name), cb), 1),
    fsCommBusUnregister: (name: number) => (handlers.delete(cstr(name)) ? 1 : 0),
    fsCommBusCall: (name: number, buf: number, size: number) => {
      assert.equal(cstr(name), RES_EVENT);
      const data = Buffer.from(mem().subarray(buf, buf + size)).toString('utf8');
      later(() => jsListeners.forEach((fn) => fn(data)));
      return 1;
    },
    fsIOOpen: (path: number, flags: number, cb: number, user: number) => {
      const p = cstr(path);
      const id = next++;
      const writing = (flags & 2) !== 0;
      const f = { path: p, err: 0, open: true };
      if (!p.startsWith('/work/')) f.err = 3;
      else if (writing) disk.set(p, new Uint8Array(0));
      else if (!disk.has(p)) f.err = 2;
      if (f.err) f.open = false;
      files.set(id, f);
      later(() => table().get(cb)(id, user));
      return id;
    },
    fsIOIsOpened: (id: bigint) => (files.get(id)?.open ? 1 : 0),
    fsIOClose: (id: bigint) => {
      const f = files.get(id);
      if (f) f.open = false;
      return 0;
    },
    fsIOHasError: (id: bigint) => (files.get(id)?.err ? 1 : 0),
    fsIOGetLastError: (id: bigint) => files.get(id)?.err ?? 0,
    fsIOGetFileSize: (id: bigint) => BigInt(disk.get(files.get(id)!.path)?.length ?? 0),
    fsIORead: (id: bigint, out: number, off: number, n: number, cb: number, user: number) => {
      const data = disk.get(files.get(id)!.path)!;
      const len = n < 0 ? data.length : Math.min(n, data.length);
      later(() => {
        mem().set(data.subarray(0, len), out);
        table().get(cb)(id, out, off, len, user);
      });
      return 0;
    },
    fsIOWrite: (id: bigint, buf: number, off: number, n: number, cb: number, user: number) => {
      disk.set(files.get(id)!.path, mem().slice(buf, buf + n));
      later(() => table().get(cb)(id, buf, off, n, user));
      return 0;
    },
  };
  const wasi = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, commit_pages: () => 0 };
  inst = (await WebAssembly.instantiate(readFileSync(WASM), { env, wasi_snapshot_preview1: wasi })).instance;
  (inst.exports.__wasm_call_ctors as () => void)();
  (inst.exports.module_init as () => void)();
  const bus = {
    on: (_e: string, fn: (d: string) => void) => void jsListeners.push(fn),
    send: (event: string, data: string) => {
      const cb = handlers.get(event);
      if (cb === undefined) return;
      const bytes = Buffer.from(data + '\0', 'utf8');
      const p = (inst.exports.malloc as (n: number) => number)(bytes.length);
      mem().set(bytes, p);
      table().get(cb)(p, bytes.length, 0);
      (inst.exports.free as (p: number) => void)(p);
    },
  };
  return { bus, disk, text: (path: string) => (disk.has(path) ? Buffer.from(disk.get(path)!).toString('utf8') : null) };
}

test('compiled storage module: ping, write, read back, missing and rejected keys', { skip: !existsSync(WASM) }, async () => {
  const m = await loadModule();
  const b = new FileBridge(m.bus, 500);
  assert.equal(await b.ping(), '1.0');
  const value = JSON.stringify({ text: 'line one\nline two', unicode: 'Zürich 北京', n: [1, 2, 3] });
  assert.equal(await b.write('index.0', value), true);
  assert.equal(m.text('/work/index.0.json'), value);
  assert.deepEqual(await b.read('index.0'), { status: 'OK', value });
  assert.deepEqual(await b.read('trace.nothing'), { status: 'MISSING' });
  // Clearing a key leaves an empty file, which reads back as missing.
  assert.equal(await b.write('index.0', ''), true);
  assert.deepEqual(await b.read('index.0'), { status: 'MISSING' });
  // Keys that could leave the work folder are refused and nothing is written.
  for (const bad of ['../secret', 'a/b', '..', '.hidden', 'a..b', 'x'.repeat(200), '']) assert.equal(await b.write(bad, 'x'), false, bad);
  assert.deepEqual(Array.from(m.disk.keys()), ['/work/index.0.json']);
  // A large value survives the round trip unchanged.
  const big = 'x'.repeat(300000) + 'end';
  assert.equal(await b.write('trace.big', big), true);
  assert.deepEqual(await b.read('trace.big'), { status: 'OK', value: big });
});

test('compiled storage module: a log is mirrored to files and rebuilt from them', { skip: !existsSync(WASM) }, async () => {
  const m = await loadModule();
  const inner = new MemoryStore();
  const store = new MirroredStore(inner, new FileBridge(m.bus, 500));
  await store.start(1, 0);
  assert.equal(store.moduleVersion, '1.0');
  const log = new LandingLog(store);
  const summary: any = { id: 'abc1', recordedAt: 5, aircraft: 'Test', touchAndGo: false };
  log.add({ summary, trace: { t: [0], agl: [0] } as any });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(JSON.parse(m.text('/work/index.0.json')!), [summary]);
  assert.ok(m.text('/work/trace.abc1.json'));

  const fresh = new MemoryStore();
  const again = new MirroredStore(fresh, new FileBridge((await loadModule(m.disk)).bus, 500));
  assert.equal(await again.start(1, 0), true);
  assert.deepEqual(new LandingLog(again).list().map((s) => s.id), ['abc1']);
  assert.ok(new LandingLog(again).getTrace('abc1'));
});
