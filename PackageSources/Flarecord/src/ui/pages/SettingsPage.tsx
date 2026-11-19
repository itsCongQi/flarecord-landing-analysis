import type { Settings } from '../../core/units';
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
      <div class="la-panel la-set la-methods">
        <div class="la-set-head la-label">METHODOLOGY · how each figure is obtained</div>
        ${METHODS.map((m) => `<div class="la-method-row"><div class="la-set-title">${m.title}</div><div class="la-method-text">${m.text}</div></div>`).join('')}
      </div>
      <div class="la-note la-set-foot">Settings are saved with the landing log and apply to every aircraft. Stored landings are kept in fixed units and converted for display, so switching units never changes the data.</div>`;
    this.on(el, '.la-seg-btn', (b) => {
      const key = b.getAttribute('data-k') as Key;
      const v = b.getAttribute('data-v') ?? '';
      // Setting the value redraws every page, this one included.
      this.props.svc.setSettings({ [key]: key === 'index' ? v === 'true' : v } as Partial<Settings>);
    });
  }
}
