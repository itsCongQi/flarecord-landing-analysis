import { seriesAt } from '../../core/gates';
import type { ClimbSummary, ClimbTrace, PowerKind, TakeoffSummary, TakeoffTrace } from '../../core/types';
import { group, type Units } from '../../core/units';
import { stackSvg, stackTimeAt, type ChartMarker } from '../components/chartSvg';
import { climbAt, climbHeightAt, climbSvg, takeoffRunwayView } from '../components/takeoffSvg';
import { esc, fmtAgo, fmtWhen, sided } from '../format';
import { helpBtn } from '../methods';
import { PageBase, emptyState, titleHtml } from './PageBase';

const LINE = '#5ab0ff';
const ROTATION = '#e3b341';
const LIFTOFF = '#e8ecf0';
const FT_PER_M = 3.280839895;

/** Speeds listed in the values-by-point table, in each speed unit. The two highest below the rotation are shown. */
const SPEED_GATES = { kt: [40, 60, 80, 100, 120, 140, 160], 'km/h': [80, 120, 160, 200, 240, 280] } as const;
/** Heights listed in the Climb view, in each height unit. Only those the recording reaches are shown. */
const CLIMB_HEIGHTS = { ft: [100, 400, 1000, 1500, 2000, 2500, 3000], m: [30, 120, 300, 450, 600, 750, 900] } as const;
/** How much of the roll the chart shows before liftoff, seconds. 0 = all of it. */
const WINDOWS: [number, string][] = [[0, 'Whole roll'], [20, '20 s'], [10, '10 s']];

const powerLabel = (k: PowerKind | null | undefined) => (k === 'rpm' ? 'RPM' : 'N1');
const powerUnit = (k: PowerKind | null | undefined) => (k === 'rpm' ? 'rpm' : '%');
const fmtPower = (v: number | null | undefined, k: PowerKind | null | undefined) => (v === null || v === undefined ? 'n/a' : k === 'rpm' ? group(v) : v.toFixed(1));
const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
const cell = (label: string, value: string, unit = '', help = '') =>
  `<div class="la-cell"><div class="la-label">${label}${help ? helpBtn(help) : ''}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
const item = (label: string, value: string) => `<span class="la-read"><span class="la-label">${label}</span><b>${value}</b></span>`;
const col = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;

/** A row of the values-by-point table. */
interface Point {
  label: string;
  /** Seconds from liftoff. */
  t: number;
  cls: string;
}

/**
 * Departure: everything about the selected takeoff on one scrolling page. Previous and Next step
 * through the takeoff log; a row in the Log opens this page.
 *
 *  - The roll over the whole runway seen from above, with where the rotation began and where the
 *    wheels left the ground.
 *  - The values measured: rotation speed and rate, liftoff attitude and speed, ground roll,
 *    runway left, distance from the centreline. Values only, no rating.
 *  - One combined chart on a time axis that has liftoff at zero, and the values at set points.
 *
 * A switch in the header turns the page to the Climb view of the same takeoff: the climb by
 * height above the liftoff point with the gear, flap and thrust changes marked.
 */
export class DeparturePage extends PageBase {
  public readonly tabName = 'Departure';
  protected readonly pageClass = 'la-departure';
  private windowS = 20;
  /** Cursor time in seconds from liftoff, kept per takeoff. */
  private cursorT: number | null = null;
  /** Cursor on the climb drawing, feet above the liftoff point, kept per takeoff. */
  private cursorFt: number | null = null;
  private shownId = '';
  private view: 'roll' | 'climb' = 'roll';
  /** Draw the next time from the top of the page (after switching sides). */
  private toTop = false;

  // Opening this page is what makes a takeoff "read".
  public onOpen(): void {
    this.markRead();
    super.onOpen();
  }

  public onResume(): void {
    this.markRead();
    super.onResume();
  }

  private markRead(): void {
    const s = this.props.svc.selectedTakeoff.get();
    if (s) this.props.svc.takeoffs.markRead(s.id);
  }

  protected draw(el: HTMLDivElement): void {
    const svc = this.props.svc;
    const s = svc.selectedTakeoff.get();
    if (!s) {
      el.innerHTML = `<div class="la-head"><div class="la-head-main"><div class="la-title">Departure</div><div class="la-sub">One takeoff in detail</div></div></div>${emptyState('Your latest takeoff will open here with its roll, rotation and climb.', true)}`;
      return;
    }
    const scroll = this.shownId === s.id && !this.toTop ? el.scrollTop : 0;
    this.toTop = false;
    if (this.shownId !== s.id) {
      this.shownId = s.id;
      this.cursorT = null;
      this.cursorFt = null;
    }
    const u = this.units;
    const list = svc.takeoffs.list();
    const i = list.findIndex((x) => x.id === s.id);
    const older = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const newer = i > 0 ? list[i - 1] : null;
    const tr = svc.takeoffs.getTrace(s.id);
    const rejected = s.kind === 'rejected';
    const cl = s.climb ?? null;
    const view = cl ? this.view : 'roll';

    const sub = [esc(s.aircraft), `${fmtWhen(s.recordedAt, true)} (${fmtAgo(s.recordedAt)})`];
    sub.push(s.windKt < 1 ? 'Wind calm' : `Wind ${('00' + (s.windDirDeg === 0 ? 360 : s.windDirDeg)).slice(-3)}° / ${u.fmtSpeed(s.windKt)} ${u.speedUnit}`);
    if (s.flaps !== null) sub.push(`Flaps ${s.flaps}`);
    if (rejected) sub.push('Rejected takeoff');
    if (s.touchAndGo) sub.push('Touch-and-go');
    if (i >= 0) sub.push(`${list.length - i} of ${list.length}`);

    let t: number[] = [];
    let climbTr: ClimbTrace | null = null;
    let body: string;
    if (view === 'climb' && cl) {
      climbTr = tr?.climb ?? null;
      body = this.climbView(s, cl, climbTr, u);
    } else {
      const rw = takeoffRunwayView(s, tr, u, this.drawingWidth(98));
      const runwayPanel = rw
        ? `<div class="la-panel la-rw-panel">
            <div class="la-panel-head"><span class="la-label">TAKEOFF ROLL${helpBtn('roll')}</span><span class="la-note">${rw.caption}</span></div>
            ${rw.svg}
            <div class="la-legend">
              <span class="la-key"><i class="la-key-solid"></i>On the ground</span>
              ${rejected ? '' : '<span class="la-key"><i class="la-key-dash"></i>In the air</span>'}
              ${s.rotIasKt !== null ? '<span class="la-key"><i class="la-key-flare"></i>Rotation start</span>' : ''}
              <span class="la-legend-note">${rw.note}</span>
            </div>
          </div>`
        : `<div class="la-panel la-rw-panel">
            <div class="la-panel-head"><span class="la-label">TAKEOFF ROLL</span></div>
            <div class="la-panel-empty">${s.runway ? 'The ground track is kept for the 60 most recent takeoffs.' : 'No runway was matched for this takeoff, so the track over the runway and the distance from the centreline are not available. The other values are unaffected.'}</div>
          </div>`;

      let detail = '<div class="la-panel"><div class="la-panel-empty">Graphs and values by point are kept for the 60 most recent takeoffs.</div></div>';
      if (tr) {
        const from = this.windowS ? tr.t.findIndex((x) => x >= -this.windowS) : 0;
        const cut = <T,>(xs: T[]) => xs.slice(Math.max(0, from));
        t = cut(tr.t);
        const cursor = this.cursorT !== null ? Math.max(t[0], Math.min(t[t.length - 1], this.cursorT)) : null;
        const points = this.points(s, tr, u);
        detail = `
        <div class="la-panel la-chart-box">
          <div class="la-panel-head">
            <span class="la-label">${rejected ? 'THE ROLL · seconds from the highest speed' : `ROTATION · seconds from liftoff${helpBtn('rotation')}`}</span>
            <span class="la-head-actions">
              ${s.rotIasKt !== null ? '<span class="la-key"><i class="la-key-flare"></i>Rotation start</span>' : ''}
              <span class="la-key"><i class="la-key-td"></i>${rejected ? 'Highest speed' : 'Liftoff'}</span>
              <div class="la-seg">${WINDOWS.map(([w, label]) => `<button class="la-seg-btn la-seg-small${w === this.windowS ? ' on' : ''}" data-w="${w}">${label}</button>`).join('')}</div>
            </span>
          </div>
          <div class="la-readout">${cursor !== null ? this.readout(s, tr, cursor, u) : '<span class="la-note">Tap the graph to read every value at that moment.</span>'}</div>
          <div class="la-stack-hit">${this.stack(s, tr, t, cut, points, cursor, u)}</div>
        </div>
        <div class="la-panel la-table la-gates">
          <div class="la-set-head la-panel-head"><span class="la-label">VALUES BY POINT</span><span class="la-note">Tap a row to place the cursor on the graph.</span></div>
          ${this.pointTable(s, tr, points, cursor, u)}
        </div>`;
      }
      body = `${cl ? this.climbLine(s, cl, u) : ''}
        ${runwayPanel}
        <div class="la-panel la-cells la-cells-7">${rejected ? this.rejectedCells(s, u) : this.cells(s, u)}</div>
        ${detail}`;
    }

    el.innerHTML = `
      <div class="la-head">
        <div class="la-head-main">
          ${titleHtml(s.runway ? s.runway.airportIdent : null, s.runway ? s.runway.designation : null)}
          <div class="la-sub">${sub.join(' · ')}</div>
        </div>
        <div class="la-head-actions">
          <div class="la-seg la-view-seg">
            <button class="la-seg-btn${view === 'roll' ? ' on' : ''}" data-view="roll">Takeoff</button>
            <button class="la-seg-btn${view === 'climb' ? ' on' : ''}${cl ? '' : ' la-btn-off'}" data-view="climb">Climb</button>
          </div>
          <button class="la-btn${older ? '' : ' la-btn-off'}" data-act="older">Previous</button>
          <button class="la-btn${newer ? '' : ' la-btn-off'}" data-act="newer">Next</button>
          <button class="la-btn" data-act="delete">Delete</button>
        </div>
      </div>
      ${body}`;
    el.scrollTop = scroll;

    const show = (x: TakeoffSummary | null) => {
      if (!x) return;
      svc.selectedTakeoff.set(x);
      svc.takeoffs.markRead(x.id);
    };
    this.on(el, '[data-act="older"]', () => show(older));
    this.on(el, '[data-act="newer"]', () => show(newer));
    // Two taps to delete (no confirm dialogs in the EFB): the first arms, the second deletes.
    let armed = false;
    this.on(el, '[data-act="delete"]', (b) => {
      if (!armed) {
        armed = true;
        b.textContent = 'Tap again to delete';
        return;
      }
      svc.takeoffs.remove(s.id);
      svc.selectedTakeoff.set(svc.takeoffs.latest());
    });
    this.on(el, '[data-view]', (b) => {
      // getAttribute: dataset is not reliable in Coherent.
      const v = b.getAttribute('data-view') === 'climb' && cl ? 'climb' : 'roll';
      if (v === this.view && v === view) return;
      this.view = v;
      this.toTop = true;
      this.redraw();
    });
    this.on(el, '.la-seg-btn[data-w]', (b) => {
      this.windowS = Number(b.getAttribute('data-w'));
      this.redraw();
    });
    this.on(el, '.la-row[data-t]', (r) => {
      const pt = Number(r.getAttribute('data-t'));
      // Show the whole roll when the chosen point is before the window shown.
      if (this.windowS && -pt > this.windowS) this.windowS = 0;
      this.cursorT = pt;
      this.redraw();
    });
    const hit = el.querySelector<HTMLDivElement>('.la-stack-hit');
    hit?.addEventListener('click', (e) => {
      const box = hit.getBoundingClientRect();
      if (box.width <= 0 || t.length === 0) return;
      this.cursorT = Math.round(stackTimeAt(t, ((e as MouseEvent).clientX - box.left) / box.width) * 10) / 10;
      this.redraw();
    });
    this.on(el, '.la-row[data-h]', (r) => {
      this.cursorFt = Number(r.getAttribute('data-h'));
      this.redraw();
    });
    const climbHit = el.querySelector<HTMLDivElement>('.la-approach-hit');
    climbHit?.addEventListener('click', (e) => {
      const box = climbHit.getBoundingClientRect();
      if (box.width <= 0 || !climbTr) return;
      this.cursorFt = Math.round(climbHeightAt(climbTr, ((e as MouseEvent).clientX - box.left) / box.width));
      this.redraw();
    });
  }

  private windCells(s: TakeoffSummary, u: Units): string[] {
    const hw = Math.round(u.speed(s.headwindKt));
    const xw = sided(u.speed(s.crosswindKt), 0);
    return [cell(hw < 0 ? 'TAILWIND' : 'HEADWIND', String(Math.abs(hw)), u.speedUnit), cell('CROSSWIND', xw.value, xw.side ? `${u.speedUnit} from ${xw.side}` : u.speedUnit)];
  }

  private centreCell(s: TakeoffSummary, u: Units): string {
    if (s.clMaxM === null) return cell('CENTRELINE MAX', 'n/a');
    const c = sided(u.dist(s.clMaxM), 0);
    return cell('CENTRELINE MAX', c.value, `${u.distUnit}${c.side ? ' ' + c.side : ''}`);
  }

  private cells(s: TakeoffSummary, u: Units): string {
    const ft = u.s.height === 'ft';
    return [
      cell('ROTATION SPEED', s.rotIasKt !== null ? u.fmtSpeed(s.rotIasKt) : 'n/a', s.rotIasKt !== null ? u.speedUnit : '', 'rotation'),
      cell('ROTATION RATE', s.rotRateAvg !== null ? s.rotRateAvg.toFixed(1) : 'n/a', s.rotRateAvg !== null ? `°/s${s.rotRatePeak !== null ? ` · peak ${s.rotRatePeak.toFixed(1)}` : ''}` : '', 'rotationRate'),
      cell('LIFTOFF PITCH', `${signed(s.liftoffPitchDeg, 1)}°`),
      cell('LIFTOFF IAS / GS', `${u.fmtSpeed(s.liftoffIasKt)} / ${u.fmtSpeed(s.liftoffGsKt)}`, u.speedUnit),
      cell('ROT. TO LIFTOFF', s.rotToLiftoffS !== null ? s.rotToLiftoffS.toFixed(1) : 'n/a', s.rotToLiftoffS !== null ? 's' : ''),
      cell(`IAS AT ${ft ? '35 FT' : '10 M'}`, s.ias35Kt !== null ? u.fmtSpeed(s.ias35Kt) : 'n/a', s.ias35Kt !== null ? u.speedUnit : ''),
      cell(`PITCH AT ${ft ? '35 FT' : '10 M'}`, s.pitch35Deg !== null ? `${signed(s.pitch35Deg, 1)}°` : 'n/a'),
      cell('GROUND ROLL', u.fmtDist(s.rollM), u.distUnit, 'roll'),
      cell('RUNWAY AHEAD', s.remainingM !== null ? u.fmtDist(Math.max(0, s.remainingM)) : 'n/a', s.remainingM !== null ? u.distUnit : ''),
      this.centreCell(s, u),
      cell('ROLL TIME', s.rollS.toFixed(1), 's'),
      cell(`TAKEOFF ${powerLabel(s.powerKind)}`, fmtPower(s.power, s.powerKind), s.power !== null ? powerUnit(s.powerKind) : '', 'power'),
      ...this.windCells(s, u),
    ].join('');
  }

  private rejectedCells(s: TakeoffSummary, u: Units): string {
    return [
      cell('HIGHEST IAS / GS', `${u.fmtSpeed(s.maxIasKt ?? s.liftoffIasKt)} / ${u.fmtSpeed(s.maxGsKt ?? s.liftoffGsKt)}`, u.speedUnit),
      cell('ROLL TO THERE', u.fmtDist(s.rollM), u.distUnit),
      cell('TIME TO THERE', s.rollS.toFixed(1), 's'),
      cell('RUNWAY LEFT', s.remainingM !== null ? u.fmtDist(Math.max(0, s.remainingM)) : 'n/a', s.remainingM !== null ? u.distUnit : '', 'rejected'),
      this.centreCell(s, u),
      ...this.windCells(s, u),
    ].join('');
  }

  /** The rows of the values-by-point table, in time order. */
  private points(s: TakeoffSummary, tr: TakeoffTrace, u: Units): Point[] {
    const out: Point[] = [];
    const gates: readonly number[] = SPEED_GATES[u.s.speed === 'kt' ? 'kt' : 'km/h'];
    const limit = u.speed(s.rotIasKt ?? (s.kind === 'rejected' ? (s.maxIasKt ?? s.liftoffIasKt) : s.liftoffIasKt)) - 5;
    for (const g of gates.filter((v) => v < limit).slice(-2)) {
      for (let i = 1; i < tr.t.length && tr.t[i] <= 0; i++) {
        const a = u.speed(tr.ias[i - 1]);
        const b = u.speed(tr.ias[i]);
        if (a < g && b >= g) {
          out.push({ label: `${g} ${u.speedUnit}`, t: tr.t[i - 1] + ((g - a) / (b - a)) * (tr.t[i] - tr.t[i - 1]), cls: '' });
          break;
        }
      }
    }
    if (s.kind === 'rejected') {
      out.push({ label: 'Highest speed', t: 0, cls: 'la-pt-lo' });
      return out;
    }
    if (s.rotToLiftoffS !== null) out.push({ label: 'Rotation', t: -s.rotToLiftoffS, cls: 'la-pt-rot' });
    out.push({ label: 'Liftoff', t: 0, cls: 'la-pt-lo' });
    if (s.t35S !== null) out.push({ label: u.s.height === 'ft' ? '35 ft' : '10 m', t: s.t35S, cls: '' });
    if (s.climb && s.climb.runwayEndS !== null) out.push({ label: 'Runway end', t: s.climb.runwayEndS, cls: 'la-pt-end' });
    return out.sort((a, b) => a.t - b.t);
  }

  private pointTable(s: TakeoffSummary, tr: TakeoffTrace, points: Point[], cursor: number | null, u: Units): string {
    const hasPower = tr.power.some((v) => v !== null);
    const hasRunway = s.runway !== null;
    const end = tr.t[tr.t.length - 1];
    const c = tr.climb;
    const head =
      `<div class="la-row la-row-head la-gcol-p">` +
      col('la-gcol-h', 'POINT') +
      col('la-gcol', 'TIME s') +
      col('la-gcol', `IAS ${u.speedUnit}`) +
      col('la-gcol', `GS ${u.speedUnit}`) +
      col('la-gcol', 'PITCH deg') +
      (hasPower ? col('la-gcol', `${powerLabel(s.powerKind)} ${powerUnit(s.powerKind)}`) : '') +
      (hasRunway ? col('la-gcol', `C/L ${u.distUnit}`) + col('la-gcol-w', `FROM START ${u.distUnit}`) : '') +
      col('la-gcol', `HEIGHT ${u.heightUnit}`) +
      `</div>`;
    const rows = points.map((p) => {
      // Inside the full-rate recording, or beyond it from the climb.
      const fine = p.t <= end + 1e-6;
      if (!fine && !c) return '';
      const at = (a: (number | null)[], b: (number | null)[] | undefined) => (fine ? seriesAt(tr.t, a, p.t) : b && c ? seriesAt(c.t, b, p.t) : null);
      const ias = at(tr.ias, c?.ias);
      const gs = at(tr.gs, c?.gs);
      const pitch = at(tr.pitch, c?.pitch);
      const power = at(tr.power, c?.power);
      const h = at(tr.agl, c?.h);
      const cross = fine ? seriesAt(tr.t, tr.centerline, p.t) : null;
      const along = fine ? seriesAt(tr.t, tr.along, p.t) : p.cls === 'la-pt-end' && s.runway ? s.runway.lengthM + (s.runway.displacedM ?? 0) : null;
      const side = cross !== null ? sided(u.dist(cross), 0) : null;
      const on = cursor !== null && fine && Math.abs(cursor - p.t) < 0.06;
      return (
        `<div class="la-row la-gcol-p${on ? ' on' : ''} ${p.cls}"${fine ? ` data-t="${p.t.toFixed(2)}"` : ''}>` +
        col('la-gcol-h', p.label) +
        col('la-gcol', Math.abs(p.t) < 0.05 ? '0.0' : signed(p.t, 1)) +
        col('la-gcol', ias !== null ? u.fmtSpeed(ias) : 'n/a') +
        col('la-gcol', gs !== null ? u.fmtSpeed(gs) : 'n/a') +
        col('la-gcol', pitch !== null ? signed(pitch, 1) : 'n/a') +
        (hasPower ? col('la-gcol', fmtPower(power, s.powerKind)) : '') +
        (hasRunway ? col('la-gcol', side ? `${side.value}${side.side ? ' ' + side.side : ''}` : '') + col('la-gcol-w', along !== null ? u.fmtDist(along) : '') : '') +
        col('la-gcol', h !== null ? u.fmtHeight(h) : 'n/a') +
        `</div>`
      );
    });
    return head + rows.join('');
  }

  private stack(s: TakeoffSummary, tr: TakeoffTrace, t: number[], cut: <T>(xs: T[]) => T[], points: Point[], cursor: number | null, u: Units): string {
    const rejected = s.kind === 'rejected';
    const markers: ChartMarker[] = [{ t: 0, label: '', color: LIFTOFF }];
    if (s.rotToLiftoffS !== null && s.rotIasKt !== null) markers.push({ t: -s.rotToLiftoffS, label: `ROTATION ${u.fmtSpeed(s.rotIasKt)} ${u.speedUnit}`, color: ROTATION });
    const power = tr.power.some((v) => v !== null)
      ? [{ label: `${powerLabel(s.powerKind)} · ${powerUnit(s.powerKind)}, engine average`, values: cut(tr.power), color: LINE, format: (v: number) => `${fmtPower(v, s.powerKind)} ${powerUnit(s.powerKind)}` }]
      : [];
    const pitch = { label: 'PITCH · deg', values: cut(tr.pitch), color: LINE, format: (v: number) => `${signed(v, 1)}°` };
    const ias = { label: `INDICATED AIRSPEED · ${u.speedUnit}`, values: cut(tr.ias).map((v) => u.speed(v)), color: LINE, format: (v: number) => `${Math.round(v)} ${u.speedUnit}` };
    return stackSvg({
      t,
      pxWidth: this.drawingWidth(98),
      cursorT: cursor,
      markers,
      zeroLabel: rejected ? 'MAX' : 'LIFTOFF',
      // The points of the table that are not markers already: the speeds and 35 ft.
      gates: points.filter((p) => p.cls === '' && p.t >= t[0] && p.t <= t[t.length - 1]).map((p) => ({ t: p.t, label: p.label })),
      lanes: rejected
        ? [ias, { label: `GROUND SPEED · ${u.speedUnit}`, values: cut(tr.gs).map((v) => u.speed(v)), color: LINE, yMin: 0, format: (v: number) => `${Math.round(v)} ${u.speedUnit}` }, ...power, pitch]
        : [
            pitch,
            { label: 'PITCH RATE · deg/s', values: cut(tr.rate), color: LINE, format: (v: number) => `${signed(v, 1)} °/s` },
            ias,
            { label: 'ELEVATOR INPUT · %, pull positive', values: cut(tr.elevator).map((v) => v * 100), color: LINE, format: (v: number) => `${signed(v, 0)} %` },
            { label: `HEIGHT · ${u.heightUnit}`, values: cut(tr.agl).map((v) => u.height(v)), color: LINE, yMin: 0, format: (v: number) => `${Math.round(v)} ${u.heightUnit}` },
            ...power,
          ],
    });
  }

  private readout(s: TakeoffSummary, tr: TakeoffTrace, t: number, u: Units): string {
    const at = (xs: (number | null)[]) => seriesAt(tr.t, xs, t) ?? 0;
    const power = seriesAt(tr.t, tr.power, t);
    return [
      item('CURSOR', Math.abs(t) < 0.05 ? (s.kind === 'rejected' ? 'MAX' : 'LIFTOFF') : `${signed(t, 1)} s`),
      item('PITCH', `${signed(at(tr.pitch), 1)}°`),
      item('RATE', `${signed(at(tr.rate), 1)} °/s`),
      item('IAS', `${u.fmtSpeed(at(tr.ias))} ${u.speedUnit}`),
      item('GS', `${u.fmtSpeed(at(tr.gs))} ${u.speedUnit}`),
      item('ELEVATOR', `${signed(at(tr.elevator) * 100, 0)} %`),
      item('HEIGHT', `${u.fmtHeight(at(tr.agl))} ${u.heightUnit}`),
      ...(power !== null ? [item(powerLabel(s.powerKind), `${fmtPower(power, s.powerKind)} ${powerUnit(s.powerKind)}`)] : []),
    ].join('');
  }

  /** One line of climb figures on the Takeoff view; tapping it turns the page to the climb. */
  private climbLine(s: TakeoffSummary, c: ClimbSummary, u: Units): string {
    const h = (v: number) => `${u.fmtHeight(v)} ${u.heightUnit}`;
    const items: string[] = [];
    if (c.runwayEndFt !== null) items.push(item('OVER RUNWAY END', h(c.runwayEndFt)));
    if (c.gearUpFt !== null) items.push(item('GEAR UP', h(c.gearUpFt)));
    if (c.thrustRedFt !== null) items.push(item(s.powerKind === 'rpm' ? 'POWER REDUCTION' : 'THRUST REDUCTION', h(c.thrustRedFt)));
    if (c.flapFt !== null) items.push(item('FLAP RETRACTION', h(c.flapFt)));
    if (!items.length) items.push(item('RECORDED TO', h(c.topFt)));
    return `<div class="la-panel la-abar" data-view="climb"><span class="la-label la-abar-title">CLIMB</span>${items.join('')}<span class="la-abar-go">View climb</span></div>`;
  }

  /** The Climb view: the figures, the climb by height with its events, then the values at set heights. */
  private climbView(s: TakeoffSummary, c: ClimbSummary, tr: ClimbTrace | null, u: Units): string {
    const ft = u.s.height === 'ft';
    const kind = s.powerKind;
    const hCell = (label: string, v: number | null, help = '') => cell(label, v !== null ? u.fmtHeight(v) : 'n/a', v !== null ? u.heightUnit : '', help);
    const bank = sided(c.bankMax500, 1);
    const cells = [
      hCell('OVER RUNWAY END', c.runwayEndFt, 'climb'),
      hCell('GEAR UP', c.gearUpFt),
      hCell(kind === 'rpm' ? 'POWER REDUCED' : 'THRUST REDUCED', c.thrustRedFt),
      hCell('FLAP RETRACTION', c.flapFt),
      cell(`BANK TO ${ft ? '500 FT' : '150 M'}`, `${bank.value}°`, bank.side),
      cell(`TIME TO ${ft ? '1,000 FT' : '300 M'}`, c.to1000S !== null ? c.to1000S.toFixed(0) : 'n/a', c.to1000S !== null ? 's' : ''),
      cell('MAX PITCH', `${signed(c.maxPitchDeg, 1)}°`),
    ].join('');
    if (!tr) {
      return `<div class="la-panel la-cells la-cells-7">${cells}</div>
        <div class="la-panel"><div class="la-panel-empty">The climb drawing and its values by height are kept for the 60 most recent takeoffs.</div></div>`;
    }
    const cursor = this.cursorFt !== null ? climbAt(tr, Math.max(0, Math.min(Math.max(...tr.h), this.cursorFt))) : null;
    const svg = climbSvg({ summary: c, trace: tr, powerKind: kind ?? null, units: u, pxWidth: this.drawingWidth(98), cursorFt: cursor ? cursor.h : null });
    const hasPower = tr.power.some((v) => v !== null);
    const head =
      `<div class="la-row la-row-head">` +
      col('la-acol-h', `HEIGHT ${u.heightUnit}`) +
      col('la-acol', 'TIME s') +
      col('la-acol', `V/S ${u.vsUnit}`) +
      col('la-acol', `IAS ${u.speedUnit}`) +
      col('la-acol', `GS ${u.speedUnit}`) +
      col('la-acol', 'PITCH deg') +
      col('la-acol', 'BANK deg') +
      (hasPower ? col('la-acol', `${powerLabel(kind)} ${powerUnit(kind)}`) : '') +
      col('la-acol', 'FLAPS') +
      col('la-acol', 'GEAR') +
      `</div>`;
    const rows: string[] = [];
    for (const hh of CLIMB_HEIGHTS[u.s.height]) {
      const p = climbAt(tr, ft ? hh : hh * FT_PER_M);
      if (!p) continue;
      const b = sided(p.bank, 1);
      const on = cursor !== null && Math.abs(cursor.h - p.h) < 1;
      rows.push(
        `<div class="la-row${on ? ' on' : ''}" data-h="${p.h.toFixed(0)}">` +
          col('la-acol-h', group(hh)) +
          col('la-acol', `+${p.t.toFixed(0)}`) +
          col('la-acol', u.fmtVs(p.vs)) +
          col('la-acol', u.fmtSpeed(p.ias)) +
          col('la-acol', u.fmtSpeed(p.gs)) +
          col('la-acol', signed(p.pitch, 1)) +
          col('la-acol', `${b.value}${b.side ? ' ' + b.side : ''}`) +
          (hasPower ? col('la-acol', fmtPower(p.power, kind)) : '') +
          col('la-acol', String(p.flaps)) +
          col('la-acol', p.gear ? 'Down' : 'Up') +
          `</div>`,
      );
    }
    const cb = cursor ? sided(cursor.bank, 1) : null;
    const readout = cursor
      ? [
          item('HEIGHT', `${u.fmtHeight(cursor.h)} ${u.heightUnit}`),
          item('TIME', `+${cursor.t.toFixed(0)} s`),
          item('V/S', `${u.fmtVs(cursor.vs)} ${u.vsUnit}`),
          item('IAS', `${u.fmtSpeed(cursor.ias)} ${u.speedUnit}`),
          item('PITCH', `${signed(cursor.pitch, 1)}°`),
          item('BANK', `${(cb as { value: string }).value}°${(cb as { side: string }).side ? ' ' + (cb as { side: string }).side : ''}`),
          ...(cursor.power !== null ? [item(powerLabel(kind), `${fmtPower(cursor.power, kind)} ${powerUnit(kind)}`)] : []),
          item('FLAPS', String(cursor.flaps)),
          item('GEAR', cursor.gear ? 'Down' : 'Up'),
        ].join('')
      : '<span class="la-note">Tap the drawing to read every value at that height.</span>';
    const reason = c.topFt >= 2990 ? `Recorded to ${u.fmtHeight(3000)} ${u.heightUnit}` : `Recorded to ${u.fmtHeight(c.topFt)} ${u.heightUnit}`;
    return `<div class="la-panel la-cells la-cells-7">${cells}</div>
      <div class="la-panel la-chart-box">
        <div class="la-panel-head"><span class="la-label">INITIAL CLIMB · by height above the liftoff point${helpBtn('climb')}</span><span class="la-note">${reason}</span></div>
        <div class="la-readout">${readout}</div>
        <div class="la-approach-hit">${svg}</div>
      </div>
      <div class="la-panel la-table la-gates">
        <div class="la-set-head la-panel-head"><span class="la-label">CLIMB BY HEIGHT</span><span class="la-note">First climb through each height. Time is seconds after liftoff. Tap a row to place the cursor on the drawing.</span></div>
        ${head}${rows.join('')}
      </div>`;
  }
}
