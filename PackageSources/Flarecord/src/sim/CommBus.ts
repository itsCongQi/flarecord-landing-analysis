import type { BusLike } from '../storage/FileBridge.ts';

/**
 * The sim's Comm Bus as seen from JavaScript: the JS_LISTENER_COMM_BUS view listener, which is
 * what the sim's own /JS/Services/CommBus.js wraps. Returns null outside the sim.
 *
 * VERIFY IN SIM: that the listener is available to EFB apps. If it is not, the app keeps working
 * on the DataStore alone and Settings says so.
 */
let shared: BusLike | null | undefined;

/** One listener for the whole app, created on first use. */
export function simCommBus(): BusLike | null {
  if (shared === undefined) shared = create();
  return shared;
}

function create(): BusLike | null {
  const register = (window as any).RegisterViewListener;
  if (typeof register !== 'function') return null;
  let ready = false;
  const waiting: [string, string][] = [];
  let listener: any = null;
  const call = (event: string, data: string) => {
    const p = listener.call('COMM_BUS_WASM_CALLBACK', event, data);
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  };
  try {
    listener = register('JS_LISTENER_COMM_BUS', () => {
      ready = true;
      for (const [e, d] of waiting.splice(0)) call(e, d);
    });
  } catch (e) {
    return null;
  }
  if (!listener) return null;
  return {
    send: (event, data) => {
      try {
        if (ready) call(event, data);
        else waiting.push([event, data]);
      } catch (e) {
        // The request times out in the bridge.
      }
    },
    on: (event, fn) => {
      try {
        listener.on(event, fn);
      } catch (e) {
        console.error('Flarecord: Comm Bus listener could not subscribe', e);
      }
    },
  };
}
