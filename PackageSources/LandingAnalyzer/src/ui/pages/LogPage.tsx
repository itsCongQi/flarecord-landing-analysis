import type { LandingSummary } from '../../core/types';
import { group } from '../../core/units';
import { dispersionStrip } from '../components/runwaySvg';
import { esc, fmtWhen, sided, where } from '../format';
import { EXAMPLE_NOTE, PageBase } from './PageBase';

/** Log: every recorded landing as a table, medians, and the touchdown points overlaid on a runway. */
export class LogPage extends PageBase {
  public readonly tabName = 'Log';
  protected readonly pageClass = 'la-log';
  private filter = '';

  protected draw(el: HTMLDivElement): void {
    const log = this.props.svc.log;
    const u = this.units;
    const all = log.list();
    const rows = this.filter ? all.filter((s) => (s.aircraft + ' ' + where(s)).toLowerCase().includes(this.filter)) : all;
    const st = log.stats();
    const strip = dispersionStrip(all.slice(0, 30), u, this.drawingWidth(98));
    const shown = Math.min(30, all.filter((s) => s.geometry).length);

    const stat = (label: string, value: string, unit = '') => `<div class="la-cell"><div class="la-label">${label}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    const num = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const row = (s: LandingSummary) => {
      const g = s.geometry;
      const cl = g ? sided(u.dist(g.centerlineOffsetM), 0) : null;
      return `<div class="la-row" data-id="${s.id}">
        <span class="la-col la-col-date">${fmtWhen(s.recordedAt)}</span>
        <span class="la-col la-col-rwy">${g ? where(s) : 'n/a'}</span>
        <span class="la-col la-col-ac">${esc(s.aircraft)}</span>
        ${num('la-col-n1', u.fmtVs(s.touchdownVsFpm))}
        ${num('la-col-n0', s.peakG.toFixed(2))}
        ${num('la-col-n0', u.fmtSpeed(s.touchdownIasKt))}
        ${num('la-col-n1', g ? u.fmtDist(g.distFromThresholdM) : 'n/a')}
        ${num('la-col-n1', cl ? `${cl.value}${cl.side ? ' ' + cl.side : ''}` : 'n/a')}
        ${num('la-col-n0', s.flare.flareHeightFt !== null ? u.fmtHeight(s.flare.flareHeightFt) : 'n/a')}
        ${num('la-col-n0', String(s.bounces))}
      </div>`;
    };

    el.innerHTML = `
      ${log.showingExamples ? EXAMPLE_NOTE : ''}
      <div class="la-head">
        <div class="la-head-main"><div class="la-title">Landing log</div></div>
        <div class="la-head-actions">
          <span class="la-label">FILTER</span>
          <input class="la-search" placeholder="Aircraft or airport" value="${esc(this.filter)}"/>
        </div>
      </div>
      <div class="la-panel la-cells la-cells-4">
        ${stat('LANDINGS', String(st?.count ?? 0))}
        ${stat('MEDIAN VERTICAL SPEED', st ? u.fmtVs(st.medianVs) : 'n/a', st ? u.vsUnit : '')}
        ${stat('MEDIAN TOUCHDOWN POINT', st && st.medianTdM !== null ? u.fmtDist(st.medianTdM) : 'n/a', st && st.medianTdM !== null ? `${u.distUnit} from threshold` : '')}
        ${stat('MEDIAN CENTRELINE OFFSET', st && st.medianClM !== null ? group(u.dist(st.medianClM)) : 'n/a', st && st.medianClM !== null ? u.distUnit : '')}
      </div>
      ${strip ? `<div class="la-panel la-rw-panel"><div class="la-panel-head"><span class="la-label">TOUCHDOWN DISPERSION · LAST ${shown} LANDING${shown === 1 ? '' : 'S'} WITH A RUNWAY, ALL RUNWAYS OVERLAID</span></div>${strip}</div>` : ''}
      <div class="la-panel la-table">
        <div class="la-row la-row-head">
          <span class="la-col la-col-date">DATE</span><span class="la-col la-col-rwy">RUNWAY</span><span class="la-col la-col-ac">AIRCRAFT</span>
          ${num('la-col-n1', `V/S ${u.vsUnit}`)}${num('la-col-n0', 'G')}${num('la-col-n0', `IAS ${u.speedUnit}`)}${num('la-col-n1', `TD POINT ${u.distUnit}`)}${num('la-col-n1', `C/L ${u.distUnit}`)}${num('la-col-n0', `FLARE ${u.heightUnit}`)}${num('la-col-n0', 'BNC')}
        </div>
        ${rows.length ? rows.map(row).join('') : '<div class="la-panel-empty">No landings match the filter.</div>'}
      </div>`;

    el.querySelector<HTMLInputElement>('.la-search')?.addEventListener('change', (e) => {
      this.filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.redraw();
    });
    this.on(el, '.la-row[data-id]', (r) => {
      const s = log.list().find((x) => x.id === r.getAttribute('data-id')) ?? null;
      this.props.svc.selected.set(s);
      this.props.go('Touchdown');
    });
  }
}
