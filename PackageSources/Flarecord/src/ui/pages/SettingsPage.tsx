import type { Settings } from '../../core/units';
import { esc } from '../format';
import { METHODS } from '../methods';
import { PageBase } from './PageBase';

type Key = keyof Settings;

const UNIT_ROWS: { key: Key; title: string; note: string; options: [string, string][] }[] = [
  { key: 'dist', title: 'Runway distance', note: "Touchdown point, centreline offset, runway length and the runway view's scale and markings", options: [['ft', 'ft'], ['m', 'm']] },
  { key: 'height', title: 'Height', note: 'Radio altitude and flare height', options: [['ft', 'ft'], ['m', 'm']] },
  { key: 'vs', title: 'Vertical speed', note: 'Sink rate at touchdown and on the graphs', options: [['fpm', 'fpm'], ['mps', 'm/s']] },
  { key: 'speed', title: 'Speed', note: 'Airspeed, ground speed and wind', options: [['kt', 'kt'], ['kmh', 'km/h']] },
];

const DISPLAY_ROWS: typeof UNIT_ROWS = [
  { key: 'index', title: 'Landing index', note: 'A single 0 to 100 summary figure on the Touchdown screen. Off by default.', options: [['false', 'Off'], ['true', 'On']] },
];

/** Settings: display units (feet, fpm and knots by default) and the optional landing index. */
export class SettingsPage extends PageBase {
  public readonly tabName = 'Settings';
  protected readonly pageClass = 'la-settings';

  protected draw(el: HTMLDivElement): void {
    const s = this.props.svc.settings.get();
    const section = (title: string, rows: typeof UNIT_ROWS) => `
      <div class="la-panel la-set">
        <div class="la-set-head la-label">${title}</div>
        ${rows
          .map(
            (r) => `<div class="la-set-row">
              <div class="la-set-text"><div class="la-set-title">${r.title}</div><div class="la-note">${r.note}</div></div>
              <div class="la-seg">${r.options.map(([v, label]) => `<button class="la-seg-btn la-seg-wide${String(s[r.key]) === v ? ' on' : ''}" data-k="${r.key}" data-v="${v}">${label}</button>`).join('')}</div>
            </div>`,
          )
          .join('')}
      </div>`;
    el.innerHTML = `
      <div class="la-head"><div class="la-head-main"><div class="la-title">Settings</div></div></div>
      ${section('UNITS', UNIT_ROWS)}
      ${section('DISPLAY', DISPLAY_ROWS)}
      ${this.files()}
      <div class="la-panel la-set la-methods">
        <div class="la-set-head la-label">METHODOLOGY · how each figure is obtained</div>
        ${METHODS.map((m) => `<div class="la-method-row"><div class="la-set-title">${m.title}</div><div class="la-method-text">${m.text}</div></div>`).join('')}
      </div>
      <div class="la-note la-set-foot">Settings are saved with the logs and apply to every aircraft. Stored landings and takeoffs are kept in fixed units and converted for display, so switching units never changes the data.</div>`;
    this.on(el, '.la-seg-btn', (b) => {
      const key = b.getAttribute('data-k') as Key;
      const v = b.getAttribute('data-v') ?? '';
      // Setting the value redraws every page, this one included.
      this.props.svc.setSettings({ [key]: key === 'index' ? v === 'true' : v } as Partial<Settings>);
    });
  }

  /** Where the data is kept and how to back it up, with the current state of file storage. */
  private files(): string {
    const store = this.props.svc.store;
    const failed = store.failures > 0 ? ` ${store.failures} write${store.failures === 1 ? '' : 's'} to the files failed this session; the simulator's save data still has them.` : '';
    const status =
      store.state === 'active'
        ? `<span class="la-file-ok">Saving to files</span>${store.moduleVersion ? ` · storage module ${esc(store.moduleVersion)}` : ''}.${failed}`
        : store.state === 'starting'
          ? 'Checking the files.'
          : `<span class="la-file-off">File storage is not running.</span> Landings are being kept in the simulator's own save data only, which cannot be backed up by hand. Check that the package's modules folder is installed and restart the simulator.`;
    const row = (title: string, body: string) => `<div class="la-method-row"><div class="la-set-title">${title}</div><div class="la-method-text">${body}</div></div>`;
    return `
      <div class="la-panel la-set la-files">
        <div class="la-set-head la-label">FILES · where your data is and how to back it up</div>
        ${row('Status', status)}
        ${row(
          'Where the data is',
          `Landings, takeoffs, graphs and settings are saved as plain files in the simulator's work folder for this addon. The simulator's own save data holds a second copy, used for fast start-up.
          <div class="la-path">%APPDATA%\\Microsoft Flight Simulator 2024\\WASM\\MSFS2024\\flarecord-landing-monitor\\work</div>
          On the Microsoft Store version the same WASM folder is under
          <div class="la-path">%LOCALAPPDATA%\\Packages\\Microsoft.Limitless_8wekyb3d8bbwe\\LocalState</div>
          Paste a path into the address bar of File Explorer to open it. <b>index.0.json</b> and up hold the landings, 25 per file, and each <b>trace.….json</b> holds the graphs of one landing. Takeoffs are kept the same way in files that begin with <b>to.</b>, and <b>settings.json</b> holds your settings.`,
        )}
        ${row('Back up', 'Close the simulator, then copy the whole <b>work</b> folder somewhere safe. Updating or reinstalling Flarecord does not touch this folder, but removing the simulator can.')}
        ${row(
          'Restore or move to another PC',
          'With the simulator closed, copy the saved files back into the <b>work</b> folder, replacing what is there, and start the simulator. Flarecord merges them with what the simulator still has: landings and takeoffs from both are kept, and settings come from the files.',
        )}
      </div>`;
  }
}
