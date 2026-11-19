import { heightGates, traceAt, type Gate, type TracePoint } from '../../core/gates';
import type { LandingSummary, LandingTrace } from '../../core/types';
import type { Units } from '../../core/units';
import { chartSvg, stackSvg, stackTimeAt, type ChartMarker } from '../components/chartSvg';
import { rolloutView, runwayView } from '../components/runwaySvg';
import { esc, fmtWhen, sided } from '../format';
import { EXAMPLE_NOTE, PageBase, titleHtml } from './PageBase';

const LINE = '#5ab0ff';
const FLARE = '#e3b341';
const TD = '#e8ecf0';

const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

/**
 * Landing: everything about the selected landing on one scrolling page, so there is no second
 * tab to keep in step. Previous and Next step through the log; a row in the Log opens this page.
 *
 *  - Where it touched down: a top-down runway view with the ground track and flare start.
 *  - The values measured at contact. Values only, no rating; the optional landing index is off
 *    unless enabled in Settings.
 *  - Values at set heights (200 ft down to 10 ft, then touchdown), so "at 50 ft, what were the
 *    pitch and the vertical speed" is one row.
 *  - One combined chart: height, vertical speed, pitch, airspeed and elevator input stacked on a
 *    shared time axis. Tapping the chart or a height row places a cursor and reads every value
 *    at that moment.
 *  - The rollout track over a plain top-down runway (left at the top, right at the bottom), to
 *    show the deviation from the centreline, when the runway was identified.
 */
export class LandingPage extends PageBase {
  public readonly tabName = 'Landing';
  protected readonly pageClass = 'la-landing';
  private windowS = 15;
  /** Cursor time in seconds to touchdown, kept per landing. */
  private cursorT: number | null = null;
  private shownId = '';

  protected draw(el: HTMLDivElement): void {
    const svc = this.props.svc;
    const s = svc.selected.get();
    if (!s) {
      el.innerHTML = '<div class="la-empty"><div class="la-title">No landings recorded</div><p>Recording arms below 200 ft on approach and runs with the tablet closed.</p></div>';
      return;
    }
    // Keep what was scrolled to when a tap redraws the page; start at the top for another landing.
    const scroll = this.shownId === s.id ? el.scrollTop : 0;
    if (this.shownId !== s.id) {
      this.shownId = s.id;
      this.cursorT = null;
    }
    const u = this.units;
    const list = svc.log.list();
    const i = list.findIndex((x) => x.id === s.id);
    const older = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const newer = i > 0 ? list[i - 1] : null;
    const g = s.geometry;
    const tr = svc.log.getTrace(s.id);

    const sub = [esc(s.aircraft), fmtWhen(s.recordedAt, true)];
    if (s.windKt !== undefined && s.windDirDeg !== undefined) sub.push(s.windKt < 1 ? 'Wind calm' : `Wind ${('00' + (s.windDirDeg === 0 ? 360 : s.windDirDeg)).slice(-3)}° / ${u.fmtSpeed(s.windKt)} ${u.speedUnit}`);
    if (s.touchAndGo) sub.push('Touch-and-go');
    if (i >= 0) sub.push(`${list.length - i} of ${list.length}`);

    const view = runwayView(s, tr, u, this.drawingWidth(98));
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

    let t: number[] = [];
    let detail = '<div class="la-panel"><div class="la-panel-empty">Graphs and values by height are kept for the 60 most recent landings.</div></div>';
    if (tr) {
      const gates = heightGates(tr, u.s.height);
      // The trace's sample at contact is already on the ground: the touchdown row shows the values
      // measured at contact instead.
      const tdRow = gates[gates.length - 1];
      tdRow.vs = s.touchdownVsFpm;
      tdRow.pitch = s.pitchDeg;
      tdRow.ias = s.touchdownIasKt;

      const from = tr.t.findIndex((x) => x >= -this.windowS);
      const to = tr.t.findIndex((x) => x > 3);
      const cut = <T,>(xs: T[]) => xs.slice(Math.max(0, from), to < 0 ? undefined : to);
      t = cut(tr.t);
      const cursor = this.cursorT !== null ? Math.max(t[0], Math.min(t[t.length - 1], this.cursorT)) : null;
      detail = `
      <div class="la-panel la-table la-gates">
        <div class="la-set-head la-panel-head"><span class="la-label">VALUES BY HEIGHT</span><span class="la-note">Last descent through each height. Tap a row to place the cursor on the graph.</span></div>
        ${this.gateTable(gates, cursor, u, g !== null)}
      </div>
      <div class="la-panel la-chart-box">
        <div class="la-panel-head">
          <span class="la-label">APPROACH AND FLARE · seconds to touchdown</span>
          <span class="la-head-actions">
            <span class="la-key"><i class="la-key-gate"></i>Height</span>
            <span class="la-key"><i class="la-key-flare"></i>Flare start</span>
            <span class="la-key"><i class="la-key-td"></i>Touchdown</span>
            <div class="la-seg">${[30, 15, 8].map((w) => `<button class="la-seg-btn la-seg-small${w === this.windowS ? ' on' : ''}" data-w="${w}">${w} s</button>`).join('')}</div>
          </span>
        </div>
        <div class="la-readout">${cursor !== null ? this.readout(traceAt(tr, cursor), u) : '<span class="la-note">Tap the graph to read every value at that moment.</span>'}</div>
        <div class="la-stack-hit">${this.stack(s, tr, t, cut, gates, cursor, u)}</div>
      </div>
      ${this.rollout(s, tr, u)}`;
    }

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
      <div class="la-panel la-cells la-cells-7">${this.cells(s, u)}</div>
      ${detail}`;
    el.scrollTop = scroll;

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
    this.on(el, '.la-seg-btn', (b) => {
      // getAttribute: dataset is not reliable in Coherent.
      this.windowS = Number(b.getAttribute('data-w'));
      this.redraw();
    });
    this.on(el, '.la-row[data-t]', (r) => {
      const gt = Number(r.getAttribute('data-t'));
      // Widen the window when the chosen height is outside the one shown.
      if (-gt > this.windowS) this.windowS = -gt > 15 ? 30 : 15;
      this.cursorT = gt;
      this.redraw();
    });
    const hit = el.querySelector<HTMLDivElement>('.la-stack-hit');
    hit?.addEventListener('click', (e) => {
      const box = hit.getBoundingClientRect();
      if (box.width <= 0 || t.length === 0) return;
      this.cursorT = Math.round(stackTimeAt(t, ((e as MouseEvent).clientX - box.left) / box.width) * 10) / 10;
      this.redraw();
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
      cell('IAS / GS', `${u.fmtSpeed(s.touchdownIasKt)} / ${u.fmtSpeed(s.touchdownGsKt)}`, u.speedUnit),
      cell('PITCH', `${s.pitchDeg > 0 ? '+' : ''}${s.pitchDeg.toFixed(1)}°`),
      cell('BANK', `${bank.value}°`, bank.side),
      cell('CRAB', `${crab.value}°`, crab.side),
      cell(hw < 0 ? 'TAILWIND' : 'HEADWIND', String(Math.abs(hw)), u.speedUnit),
      cell('CROSSWIND', xw.value, xw.side ? `${u.speedUnit} from ${xw.side}` : u.speedUnit),
      f.vsAtFlareFpm !== null ? cell('V/S AT FLARE', u.fmtVs(f.vsAtFlareFpm), u.vsUnit) : cell('V/S AT FLARE', 'n/a'),
      f.pitchChangeDeg !== null ? cell('PITCH CHANGE', `${signed(f.pitchChangeDeg, 1)}°`, f.approachPitchDeg !== null ? `from ${f.approachPitchDeg.toFixed(1)}°` : '') : cell('PITCH CHANGE', 'n/a'),
      cell('FLARE HEIGHT', f.flareHeightFt !== null ? u.fmtHeight(f.flareHeightFt) : 'n/a', f.flareHeightFt !== null ? u.heightUnit : ''),
      cell('FLARE DURATION', f.flareDurationS !== null ? f.flareDurationS.toFixed(1) : 'n/a', f.flareDurationS !== null ? 's' : ''),
      cell(`FLOAT BELOW ${u.s.height === 'ft' ? '5 FT' : '1.5 M'}`, f.floatTimeS.toFixed(1), 's'),
      cell('BOUNCES', String(s.bounces)),
    ].join('');
  }

  private stack(s: LandingSummary, tr: LandingTrace, t: number[], cut: <T>(xs: T[]) => T[], gates: Gate[], cursor: number | null, u: Units): string {
    const markers: ChartMarker[] = [{ t: 0, label: '', color: TD }];
    if (s.flare.flareDurationS !== null) markers.push({ t: -s.flare.flareDurationS, label: '', color: FLARE });
    return stackSvg({
      t,
      pxWidth: this.drawingWidth(98),
      cursorT: cursor,
      markers,
      gates: gates.filter((g) => g.height !== null).map((g) => ({ t: g.t, label: `${g.height} ${u.heightUnit}` })),
      lanes: [
        { label: `RADIO ALTITUDE · ${u.heightUnit}`, values: cut(tr.agl).map((v) => u.height(v)), color: LINE, yMin: 0, format: (v) => `${Math.round(v)} ${u.heightUnit}` },
        { label: `VERTICAL SPEED · ${u.vsUnit}`, values: cut(tr.vs).map((v) => u.vs(v)), color: LINE, format: (v) => `${u.s.vs === 'fpm' ? Math.round(v) : v.toFixed(1)} ${u.vsUnit}` },
        { label: 'PITCH · deg', values: cut(tr.pitch), color: LINE, format: (v) => `${signed(v, 1)}°` },
        { label: `INDICATED AIRSPEED · ${u.speedUnit}`, values: cut(tr.ias).map((v) => u.speed(v)), color: LINE, format: (v) => `${Math.round(v)} ${u.speedUnit}` },
        { label: 'ELEVATOR INPUT · %, pull positive', values: cut(tr.elevator).map((v) => v * 100), color: LINE, format: (v) => `${signed(v, 0)} %` },
      ],
    });
  }

  private readout(p: TracePoint, u: Units): string {
    const item = (label: string, value: string) => `<span class="la-read"><span class="la-label">${label}</span><b>${value}</b></span>`;
    return [
      item('CURSOR', Math.abs(p.t) < 0.05 ? 'TD' : `${signed(p.t, 1)} s`),
      item('RA', `${u.fmtHeight(p.agl)} ${u.heightUnit}`),
      item('V/S', `${u.fmtVs(p.vs)} ${u.vsUnit}`),
      item('PITCH', `${signed(p.pitch, 1)}°`),
      item('IAS', `${u.fmtSpeed(p.ias)} ${u.speedUnit}`),
      item('ELEVATOR', `${signed(p.elevator * 100, 0)} %`),
      item('LOAD', `${p.g.toFixed(2)} g`),
    ].join('');
  }

  private gateTable(gates: Gate[], cursor: number | null, u: Units, hasRunway: boolean): string {
    const col = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const head =
      `<div class="la-row la-row-head">` +
      col('la-gcol-h', `HEIGHT ${u.heightUnit}`) +
      col('la-gcol', 'TIME s') +
      col('la-gcol', `V/S ${u.vsUnit}`) +
      col('la-gcol', 'PITCH deg') +
      col('la-gcol', `IAS ${u.speedUnit}`) +
      col('la-gcol', 'ELEVATOR %') +
      (hasRunway ? col('la-gcol', `C/L ${u.distUnit}`) + col('la-gcol-w', `FROM THRESHOLD ${u.distUnit}`) : '') +
      `</div>`;
    const rows = gates.map((g) => {
      const cl = g.centerline !== null ? sided(u.dist(g.centerline), 0) : null;
      const on = cursor !== null && Math.abs(cursor - g.t) < 0.06;
      return (
        `<div class="la-row${on ? ' on' : ''}" data-t="${g.t.toFixed(2)}">` +
        col('la-gcol-h', g.height !== null ? String(g.height) : 'Touchdown') +
        col('la-gcol', g.height !== null ? g.t.toFixed(1) : '0.0') +
        col('la-gcol', u.fmtVs(g.vs)) +
        col('la-gcol', signed(g.pitch, 1)) +
        col('la-gcol', u.fmtSpeed(g.ias)) +
        col('la-gcol', signed(g.elevator * 100, 0)) +
        (hasRunway ? col('la-gcol', cl ? `${cl.value}${cl.side ? ' ' + cl.side : ''}` : 'n/a') + col('la-gcol-w', g.along !== null ? u.fmtDist(g.along) : 'n/a') : '') +
        `</div>`
      );
    });
    return head + rows.join('');
  }

  private rollout(s: LandingSummary, tr: LandingTrace, u: Units): string {
    // Top-down view when the runway and the ground track are known.
    const view = rolloutView(s, tr, u, this.drawingWidth(98));
    if (view) {
      return `<div class="la-panel la-rw-panel">
        <div class="la-panel-head"><span class="la-label">ROLLOUT · track over the runway, seen from above</span><span class="la-note">${view.caption}</span></div>
        ${view.svg}
        <div class="la-legend"><span class="la-key"><i class="la-key-solid"></i>Rollout track</span><span class="la-legend-note">${view.note}</span></div>
      </div>`;
    }
    // Landings recorded before the ground track was stored: the offset over time.
    const r0 = tr.t.findIndex((x) => x >= 0);
    if (r0 < 0 || !tr.centerline.slice(r0).some((v) => v !== null)) return '';
    const svg = chartSvg({
      width: 1080,
      height: 150,
      pxWidth: this.drawingWidth(98),
      t: tr.t.slice(r0),
      unit: u.distUnit,
      series: [{ values: tr.centerline.slice(r0).map((v) => (v === null ? null : u.dist(v))), color: LINE, label: 'CL' }],
      guides: [{ value: 0, label: 'centreline' }],
    });
    return `<div class="la-panel la-chart-box"><div class="la-panel-head"><span class="la-label">ROLLOUT · distance from centreline, ${u.distUnit} (right positive) · seconds after touchdown</span></div>${svg}</div>`;
  }
}
