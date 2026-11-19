import type { LandingSummary } from '../../core/types';
import { esc, fmtAgo, fmtWhen, sided, where } from '../format';
import { EXAMPLE_NOTE, PageBase } from './PageBase';

/** Log: every recorded landing as a table. A row opens that landing; figures across landings are on Summary. */
export class LogPage extends PageBase {
  public readonly tabName = 'Log';
  protected readonly pageClass = 'la-log';
  private filter = '';

  protected draw(el: HTMLDivElement): void {
    const log = this.props.svc.log;
    const u = this.units;
    const all = log.list();
    const rows = this.filter ? all.filter((s) => (s.aircraft + ' ' + where(s)).toLowerCase().includes(this.filter)) : all;

    const now = Date.now();
    const unread = log.unreadList().length;
    const num = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const row = (s: LandingSummary) => {
      const g = s.geometry;
      const cl = g ? sided(u.dist(g.centerlineOffsetM), 0) : null;
      return `<div class="la-row" data-id="${s.id}">
        <span class="la-col la-col-date"><i class="la-new-dot${log.isUnread(s.id) ? ' on' : ''}"></i><span><span class="la-when">${fmtWhen(s.recordedAt)}</span><span class="la-ago">${fmtAgo(s.recordedAt, now)}</span></span></span>
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
        <div class="la-head-main"><div class="la-title">Landing log</div><div class="la-sub">${rows.length} of ${all.length} landing${all.length === 1 ? '' : 's'}${unread ? ` · ${unread} new` : ''} · tap a row to open it</div></div>
        <div class="la-head-actions">
          <span class="la-label">FILTER</span>
          <input class="la-search" placeholder="Aircraft or airport" value="${esc(this.filter)}"/>
        </div>
      </div>
      <div class="la-panel la-table">
        <div class="la-row la-row-head">
          <span class="la-col la-col-date"><i class="la-new-dot"></i>DATE</span><span class="la-col la-col-rwy">RUNWAY</span><span class="la-col la-col-ac">AIRCRAFT</span>
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
      this.props.go('Landing');
    });
  }
}
