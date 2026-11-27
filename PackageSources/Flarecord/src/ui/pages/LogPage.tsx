import type { LandingSummary, TakeoffSummary } from '../../core/types';
import { esc, fmtAgo, fmtWhen, sided, where } from '../format';
import { PageBase, emptyState, kindSwitch, type Kind } from './PageBase';

/**
 * Log: every recorded landing as a table, and every takeoff as another, with a switch between
 * them. A row opens that landing or takeoff; figures across them are on Summary.
 */
export class LogPage extends PageBase {
  public readonly tabName = 'Log';
  protected readonly pageClass = 'la-log';
  private filter = '';
  private kind: Kind = 'landings';

  protected draw(el: HTMLDivElement): void {
    const log = this.props.svc.log;
    const u = this.units;
    const all = log.list();
    const takeoffs = this.props.svc.takeoffs;
    const sw = kindSwitch(this.kind, all.length, takeoffs.list().length);
    const onKind = () =>
      this.on(el, '[data-kind]', (b) => {
        this.kind = b.getAttribute('data-kind') === 'takeoffs' ? 'takeoffs' : 'landings';
        this.redraw();
      });
    if (!all.length && !takeoffs.list().length) {
      el.innerHTML = `<div class="la-head"><div class="la-head-main"><div class="la-title">Log</div><div class="la-sub">Every takeoff and landing, newest first</div></div></div>${emptyState('Each landing and each takeoff will be listed here and kept between sessions.')}`;
      return;
    }
    if (this.kind === 'takeoffs') {
      this.drawTakeoffs(el, sw);
      onKind();
      return;
    }
    if (!all.length) {
      el.innerHTML = `<div class="la-head"><div class="la-head-main"><div class="la-title">Landing log</div><div class="la-sub">Every landing, newest first</div></div><div class="la-head-actions">${sw}</div></div>${emptyState('Each landing will be listed here and kept between sessions.')}`;
      onKind();
      return;
    }
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
        ${num('la-col-n0', s.approach ? (s.approach.stableFt !== null ? `${u.fmtHeight(s.approach.stableFt)}${s.approach.stableAtTop ? '+' : ''}` : `&lt; ${u.fmtHeight(100)}`) : 'n/a')}
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
      <div class="la-head">
        <div class="la-head-main"><div class="la-title">Landing log</div><div class="la-sub">${rows.length} of ${all.length} landing${all.length === 1 ? '' : 's'}${unread ? ` · ${unread} new` : ''} · tap a row to open it</div></div>
        <div class="la-head-actions">
          ${sw}
          <span class="la-label">FILTER</span>
          <input class="la-search" placeholder="Aircraft or airport" value="${esc(this.filter)}"/>
        </div>
      </div>
      <div class="la-panel la-table">
        <div class="la-row la-row-head">
          <span class="la-col la-col-date"><i class="la-new-dot"></i>DATE</span><span class="la-col la-col-rwy">RUNWAY</span><span class="la-col la-col-ac">AIRCRAFT</span>
          ${num('la-col-n0', `STABLE ${u.heightUnit}`)}${num('la-col-n1', `V/S ${u.vsUnit}`)}${num('la-col-n0', 'G')}${num('la-col-n0', `IAS ${u.speedUnit}`)}${num('la-col-n1', `TD POINT ${u.distUnit}`)}${num('la-col-n1', `C/L ${u.distUnit}`)}${num('la-col-n0', `FLARE ${u.heightUnit}`)}${num('la-col-n0', 'BNC')}
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
      this.props.go('Arrival');
    });
    onKind();
  }

  /** The takeoff log: one row a takeoff, opening the Departure page. */
  private drawTakeoffs(el: HTMLDivElement, sw: string): void {
    const log = this.props.svc.takeoffs;
    const u = this.units;
    const all = log.list();
    if (!all.length) {
      el.innerHTML = `<div class="la-head"><div class="la-head-main"><div class="la-title">Takeoff log</div><div class="la-sub">Every takeoff, newest first</div></div><div class="la-head-actions">${sw}</div></div>${emptyState('Each takeoff will be listed here and kept between sessions.', true)}`;
      return;
    }
    const place = (s: TakeoffSummary) => (s.runway ? `${s.runway.airportIdent} ${s.runway.designation}` : 'No runway');
    const rows = this.filter ? all.filter((s) => (s.aircraft + ' ' + place(s)).toLowerCase().includes(this.filter)) : all;
    const now = Date.now();
    const unread = log.unreadList().length;
    const num = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const row = (s: TakeoffSummary) => {
      const cl = s.clMaxM !== null ? sided(u.dist(s.clMaxM), 0) : null;
      const tag = s.kind === 'rejected' ? '<span class="la-tag">REJECTED</span>' : s.touchAndGo ? '<span class="la-tag">T&amp;G</span>' : '';
      const off = s.kind === 'rejected';
      return `<div class="la-row" data-id="${s.id}">
        <span class="la-col la-col-date"><i class="la-new-dot${log.isUnread(s.id) ? ' on' : ''}"></i><span><span class="la-when">${fmtWhen(s.recordedAt)}</span><span class="la-ago">${fmtAgo(s.recordedAt, now)}</span></span></span>
        <span class="la-col la-col-rwy">${s.runway ? place(s) : 'n/a'}</span>
        <span class="la-col la-col-ac">${esc(s.aircraft)}${tag}</span>
        ${num('la-col-n2', s.rotIasKt !== null ? u.fmtSpeed(s.rotIasKt) : off ? '' : 'n/a')}
        ${num('la-col-n2', s.rotRateAvg !== null ? s.rotRateAvg.toFixed(1) : off ? '' : 'n/a')}
        ${num('la-col-n2', off ? '' : `${s.liftoffPitchDeg > 0 ? '+' : ''}${s.liftoffPitchDeg.toFixed(1)}`)}
        ${num('la-col-n2', u.fmtSpeed(off ? (s.maxIasKt ?? s.liftoffIasKt) : s.liftoffIasKt))}
        ${num('la-col-n1', u.fmtDist(s.rollM))}
        ${num('la-col-n2', cl ? `${cl.value}${cl.side ? ' ' + cl.side : ''}` : 'n/a')}
        ${num('la-col-n1', s.remainingM !== null ? u.fmtDist(Math.max(0, s.remainingM)) : 'n/a')}
      </div>`;
    };
    el.innerHTML = `
      <div class="la-head">
        <div class="la-head-main"><div class="la-title">Takeoff log</div><div class="la-sub">${rows.length} of ${all.length} takeoff${all.length === 1 ? '' : 's'}${unread ? ` · ${unread} new` : ''} · tap a row to open it</div></div>
        <div class="la-head-actions">
          ${sw}
          <span class="la-label">FILTER</span>
          <input class="la-search" placeholder="Aircraft or airport" value="${esc(this.filter)}"/>
        </div>
      </div>
      <div class="la-panel la-table">
        <div class="la-row la-row-head">
          <span class="la-col la-col-date"><i class="la-new-dot"></i>DATE</span><span class="la-col la-col-rwy">RUNWAY</span><span class="la-col la-col-ac">AIRCRAFT</span>
          ${num('la-col-n2', `ROT. ${u.speedUnit}`)}${num('la-col-n2', 'RATE °/s')}${num('la-col-n2', 'PITCH')}${num('la-col-n2', `IAS ${u.speedUnit}`)}${num('la-col-n1', `ROLL ${u.distUnit}`)}${num('la-col-n2', `C/L ${u.distUnit}`)}${num('la-col-n1', `AHEAD ${u.distUnit}`)}
        </div>
        ${rows.length ? rows.map(row).join('') : '<div class="la-panel-empty">No takeoffs match the filter.</div>'}
      </div>`;
    el.querySelector<HTMLInputElement>('.la-search')?.addEventListener('change', (e) => {
      this.filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.redraw();
    });
    this.on(el, '.la-row[data-id]', (r) => {
      const s = log.list().find((x) => x.id === r.getAttribute('data-id')) ?? null;
      this.props.svc.selectedTakeoff.set(s);
      this.props.go('Departure');
    });
  }
}
