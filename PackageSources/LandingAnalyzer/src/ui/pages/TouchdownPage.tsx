import type { LandingSummary } from '../../core/types';
import type { Units } from '../../core/units';
import { runwayView } from '../components/runwaySvg';
import { esc, fmtWhen, sided } from '../format';
import { EXAMPLE_NOTE, PageBase, titleHtml } from './PageBase';

/**
 * Touchdown: where the selected landing touched down on the runway, and the measured values at
 * contact. Values only, no rating; the optional landing index is off unless enabled in Settings.
 */
export class TouchdownPage extends PageBase {
  public readonly tabName = 'Touchdown';
  protected readonly pageClass = 'la-touchdown';

  protected draw(el: HTMLDivElement): void {
    const svc = this.props.svc;
    const s = svc.selected.get();
    if (!s) {
      el.innerHTML = '<div class="la-empty"><div class="la-title">No landings recorded</div><p>Recording arms below 200 ft on approach and runs with the tablet closed.</p></div>';
      return;
    }
    const u = this.units;
    const list = svc.log.list();
    const i = list.findIndex((x) => x.id === s.id);
    const older = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const newer = i > 0 ? list[i - 1] : null;
    const g = s.geometry;

    const sub = [esc(s.aircraft), fmtWhen(s.recordedAt, true)];
    if (s.windKt !== undefined && s.windDirDeg !== undefined) sub.push(s.windKt < 1 ? 'Wind calm' : `Wind ${('00' + (s.windDirDeg === 0 ? 360 : s.windDirDeg)).slice(-3)}° / ${u.fmtSpeed(s.windKt)} ${u.speedUnit}`);
    if (s.touchAndGo) sub.push('Touch-and-go');

    const view = runwayView(s, svc.log.getTrace(s.id), u, this.drawingWidth(98));
    const runwayPanel = view
      ? `<div class="la-panel la-rw-panel">
          <div class="la-panel-head"><span class="la-label">TOUCHDOWN POINT</span><span class="la-note">${view.caption}</span></div>
          ${view.svg}
          <div class="la-legend">
            <span class="la-key"><i class="la-key-dash"></i>Approach track</span>
            <span class="la-key"><i class="la-key-line"></i>Rollout track</span>
            <span class="la-key"><i class="la-key-flare"></i>Flare start</span>
            <span class="la-legend-note">${view.note}</span>
          </div>
        </div>`
      : `<div class="la-panel la-rw-panel">
          <div class="la-panel-head"><span class="la-label">TOUCHDOWN POINT</span></div>
          <div class="la-panel-empty">No runway was matched for this landing, so the touchdown point is not available. The other values are unaffected.</div>
        </div>`;

    el.innerHTML = `
      ${s.example ? EXAMPLE_NOTE : ''}
      <div class="la-head">
        <div class="la-head-main">
          ${titleHtml(g ? g.runway.airportIdent : null, g ? g.runway.designation : null)}
          <div class="la-sub">${sub.join(' · ')}</div>
        </div>
        <div class="la-head-actions">
          ${u.s.index ? `<span class="la-index">INDEX ${s.score.total}</span>` : ''}
          <button class="la-btn${older ? '' : ' la-btn-off'}" data-act="older">Previous</button>
          <button class="la-btn${newer ? '' : ' la-btn-off'}" data-act="newer">Next</button>
          ${s.example ? '' : '<button class="la-btn" data-act="delete">Delete</button>'}
        </div>
      </div>
      ${runwayPanel}
      <div class="la-panel la-cells">${this.cells(s, u)}</div>`;

    this.on(el, '[data-act="older"]', () => older && svc.selected.set(older));
    this.on(el, '[data-act="newer"]', () => newer && svc.selected.set(newer));
    // Two taps to delete (no confirm dialogs in the EFB): the first arms, the second deletes.
    let armed = false;
    this.on(el, '[data-act="delete"]', (b) => {
      if (!armed) {
        armed = true;
        b.textContent = 'Tap again to delete';
        return;
      }
      svc.log.remove(s.id);
      svc.selected.set(svc.log.latest());
    });
  }

  private cells(s: LandingSummary, u: Units): string {
    const cell = (label: string, value: string, unit = '') => `<div class="la-cell"><div class="la-label">${label}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    const bank = sided(s.bankDeg, 1);
    const crab = sided(s.crabDeg, 1);
    const xw = sided(u.speed(s.crosswindKt), 0);
    const f = s.flare;
    const hw = Math.round(u.speed(s.headwindKt));
    return [
      cell('VERTICAL SPEED', u.fmtVs(s.touchdownVsFpm), u.vsUnit),
      cell('PEAK LOAD', s.peakG.toFixed(2), 'g'),
      cell('IAS / GROUND SPEED', `${u.fmtSpeed(s.touchdownIasKt)} / ${u.fmtSpeed(s.touchdownGsKt)}`, u.speedUnit),
      cell('PITCH', `${s.pitchDeg > 0 ? '+' : ''}${s.pitchDeg.toFixed(1)}°`),
      cell('BANK', `${bank.value}°`, bank.side),
      cell('CRAB', `${crab.value}°`, crab.side),
      cell(hw < 0 ? 'TAILWIND' : 'HEADWIND', String(Math.abs(hw)), u.speedUnit),
      cell('CROSSWIND', xw.value, xw.side ? `${u.speedUnit} from ${xw.side}` : u.speedUnit),
      cell('FLARE HEIGHT', f.flareHeightFt !== null ? u.fmtHeight(f.flareHeightFt) : 'n/a', f.flareHeightFt !== null ? u.heightUnit : ''),
      cell('FLARE DURATION', f.flareDurationS !== null ? f.flareDurationS.toFixed(1) : 'n/a', f.flareDurationS !== null ? 's' : ''),
      cell(`FLOAT BELOW ${u.s.height === 'ft' ? '5 FT' : '1.5 M'}`, f.floatTimeS.toFixed(1), 's'),
      cell('BOUNCES', String(s.bounces)),
    ].join('');
  }
}
