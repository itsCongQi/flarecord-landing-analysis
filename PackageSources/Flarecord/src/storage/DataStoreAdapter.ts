import type { KeyValueStore } from './LandingLog.ts';

// Coherent GT globals provided by the sim's JS runtime (see the SDK's DataStore / common.js).
declare function GetStoredData(key: string): string | null | undefined;
declare function SetStoredData(key: string, value: string): void;
declare function DeleteStoredData(key: string): void;

/**
 * KeyValueStore backed by the sim's DataStore, which persists between sessions as part of the
 * user's save data.
 *
 * Known caveat (devsupport report "DataStore persistence issues"): some users lost values after
 * exiting through the in-game "Quit to desktop" button. We write on every landing, so at worst
 * the last landing of a session is at risk, not the whole log. Verify on a real install.
 */
export class DataStoreAdapter implements KeyValueStore {
  get(key: string): string | null {
    const v = GetStoredData(key);
    return v === undefined || v === '' ? null : v;
  }
  set(key: string, value: string): void {
    SetStoredData(key, value);
  }
  remove(key: string): void {
    if (typeof DeleteStoredData === 'function') DeleteStoredData(key);
    else SetStoredData(key, '');
  }
}
