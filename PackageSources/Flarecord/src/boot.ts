import { simCommBus } from './sim/CommBus.ts';
import { FileBridge } from './storage/FileBridge.ts';

/**
 * Start-up diary. The sim keeps no log of what an EFB app does, so when the app fails to appear
 * there is nothing to look at. Each stage of start-up is noted here, together with any script
 * error in the view, and the notes are written to boot.json in the work folder through the
 * storage module. This file is imported first so that it runs before the rest of the app.
 */
const lines: string[] = [];
let dirty = false;
let bridge: FileBridge | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;

export function describe(e: unknown): string {
  const err = e as { message?: string; stack?: string } | null;
  return err && (err.stack || err.message) ? String(err.stack || err.message) : String(e);
}

/** Note a stage of start-up, with an error or detail if there is one. */
export function mark(stage: string, detail?: unknown): void {
  try {
    if (lines.length >= 60) return;
    lines.push(`${new Date().toISOString()} ${stage}${detail === undefined ? '' : ' | ' + describe(detail).slice(0, 1500)}`);
    dirty = true;
    if (timer === null) {
      timer = setInterval(flush, 3000);
      setTimeout(flush, 0);
    }
  } catch (e) {
    // The diary must never be the thing that breaks start-up.
  }
}

function flush(): void {
  try {
    // Keep trying for five minutes: the module may be loaded well after the tablet.
    if (++ticks > 100 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (!dirty) return;
    if (!bridge) {
      const bus = simCommBus();
      if (!bus) return;
      bridge = new FileBridge(bus, 2500, 'b');
    }
    if (bridge.pending > 0) return;
    const text = lines.join('\n');
    dirty = false;
    bridge.write('boot', text).then((ok) => {
      if (!ok) dirty = true;
    });
  } catch (e) {
    // See above.
  }
}

try {
  window.addEventListener('error', (ev: any) => mark('script error', `${ev && ev.message} at ${ev && ev.filename}:${ev && ev.lineno}:${ev && ev.colno}${ev && ev.error ? ' | ' + describe(ev.error) : ''}`));
  window.addEventListener('unhandledrejection', (ev: any) => mark('unhandled rejection', ev && ev.reason));
} catch (e) {
  // No window: running outside the sim.
}
mark('script loaded');
