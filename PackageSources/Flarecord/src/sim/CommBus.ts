import type { BusLike } from '../storage/FileBridge.ts';

/**
 * The sim's Comm Bus as seen from JavaScript: the JS_LISTENER_COMM_BUS view listener, which is
 * what the sim's own /JS/Services/CommBus.js wraps. Returns null outside the sim.
 *
 * VERIFY IN SIM: that the listener is available to EFB apps. If it is not, the app keeps working
 * on the DataStore alone and Settings says so.
 */
export function simCommBus(): BusLike | null {
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
      if (ready) call(event, data);
      else waiting.push([event, data]);
    },
    on: (event, fn) => listener.on(event, fn),
  };
}
