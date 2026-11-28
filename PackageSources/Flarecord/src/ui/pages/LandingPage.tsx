import { CONDITION_LABEL, STABLE } from '../../core/approach';
import { heightGates, seriesAt, thresholdCrossing, traceAt, type Gate, type TracePoint } from '../../core/gates';
import type { ApproachSummary, ApproachTrace, LandingSummary, LandingTrace, PowerKind } from '../../core/types';
import { group, type Units } from '../../core/units';
import { approachAt, approachHeightAt, approachSvg, type ApproachPoint } from '../components/approachSvg';
import { chartSvg, stackSvg, stackTimeAt, type ChartMarker } from '../components/chartSvg';
import { rolloutView, runwayView, THRESHOLD } from '../components/runwaySvg';
import { esc, fmtAgo, fmtWhen, sided } from '../format';
import { helpBtn } from '../methods';
import { PageBase, emptyState, titleHtml } from './PageBase';

const LINE = '#5ab0ff';
const FLARE = '#e3b341';
const TD = '#e8ecf0';

/** A row of the values-by-height table: a height gate, the threshold crossing or the touchdown. */
type Row = Gate & { threshold?: boolean };

/** Heights listed in the Approach view, in each height unit. Only those the recording reaches are shown. */
const APPROACH_HEIGHTS = { ft: [3000, 2500, 2000, 1500, 1000, 500, 200, 100], m: [900, 750, 600, 450, 300, 150, 60, 30] } as const;
const FT_PER_M = 3.280839895;

/** A deviation in dots with the side in words: "0.3 above", "0.2 L". */
const dev = (v: number | null, pos: string, neg: string): string => {
  if (v === null) return 'n/a';
  const a = Math.abs(v).toFixed(1);
  return Number(a) === 0 ? a : `${a} ${v > 0 ? pos : neg}`;
};
const powerLabel = (k: PowerKind | null | undefined) => (k === 'rpm' ? 'RPM' : 'N1');
const powerUnit = (k: PowerKind | null | undefined) => (k === 'rpm' ? 'rpm' : '%');
const fmtPower = (v: number | null | undefined, k: PowerKind | null | undefined) => (v === null || v === undefined ? 'n/a' : k === 'rpm' ? group(v) : v.toFixed(1));

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
 *
 * A switch in the header turns the page to the Approach view of the same landing: the height the
 * approach was stable from, the deviation from the glidepath and the centreline, engine power,
 * and the values at set heights from 3,000 ft down. The Touchdown view carries one line of it.
 */
export class LandingPage extends PageBase {
  public readonly tabName = 'Arrival';
  protected readonly pageClass = 'la-landing';
  private windowS = 15;
  /** Cursor time in seconds to touchdown, kept per landing. */
  private cursorT: number | null = null;
  private shownId = '';
  /** Which side of the landing is shown. Kept while stepping through the log. */
  private view: 'touchdown' | 'approach' = 'touchdown';
  /** Cursor on the approach drawing, feet above the runway, kept per landing. */
  private cursorFt: number | null = null;
  /** The second-by-second table is open. */
  private secOpen = false;
  /** Draw the next time from the top of the page (after switching sides). */
  private toTop = false;

  // Opening this page is what makes a landing "read". Redraws while the page is hidden (a landing
  // recorded with the tablet closed selects itself here) do not count.
  public onOpen(): void {
    this.markRead();
    super.onOpen();
  }

  public onResume(): void {
    this.markRead();
    super.onResume();
  }

  private markRead(): void {
    const s = this.props.svc.selected.get();
    if (s) this.props.svc.log.markRead(s.id);
  }

  protected draw(el: HTMLDivElement): void {
    const svc = this.props.svc;
    const s = svc.selected.get();
    if (!s) {
      el.innerHTML = `<div class="la-head"><div class="la-head-main"><div class="la-title">Arrival</div><div class="la-sub">One landing in detail</div></div></div>${emptyState('Your latest landing will open here with its touchdown point, values and graphs.')}`;
      return;
    }
    // Keep what was scrolled to when a tap redraws the page; start at the top for another landing.
    const scroll = this.shownId === s.id && !this.toTop ? el.scrollTop : 0;
    this.toTop = false;
    if (this.shownId !== s.id) {
      this.shownId = s.id;
      this.cursorT = null;
      this.cursorFt = null;
    }
    const u = this.units;
    const list = svc.log.list();
    const i = list.findIndex((x) => x.id === s.id);
    const older = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const newer = i > 0 ? list[i - 1] : null;
    const g = s.geometry;
    const tr = svc.log.getTrace(s.id);
    const ap = s.approach ?? null;
    const apTr = tr?.approach ?? null;
    // A landing without a recorded approach always shows its touchdown.
    const view = ap ? this.view : 'touchdown';

    const sub = [esc(s.aircraft), `${fmtWhen(s.recordedAt, true)} (${fmtAgo(s.recordedAt)})`];
    if (s.windKt !== undefined && s.windDirDeg !== undefined) sub.push(s.windKt < 1 ? 'Wind calm' : `Wind ${('00' + (s.windDirDeg === 0 ? 360 : s.windDirDeg)).slice(-3)}° / ${u.fmtSpeed(s.windKt)} ${u.speedUnit}`);
    if (s.touchAndGo) sub.push('Touch-and-go');
    if (i >= 0) sub.push(`${list.length - i} of ${list.length}`);

    const rw = runwayView(s, tr, u, this.drawingWidth(98));
    const runwayPanel = rw
      ? `<div class="la-panel la-rw-panel">
          <div class="la-panel-head"><span class="la-label">TOUCHDOWN POINT${helpBtn('position')}</span><span class="la-note">${rw.caption}</span></div>
          ${rw.svg}
          <div class="la-legend">
            <span class="la-key"><i class="la-key-dash"></i>Approach track</span>
            <span class="la-key"><i class="la-key-line"></i>Rollout track</span>
            <span class="la-key"><i class="la-key-flare"></i>Flare start</span>
            ${tr && thresholdCrossing(tr) ? '<span class="la-key"><i class="la-key-thr la-key-thr-solid"></i>Over the threshold</span>' : ''}
            <span class="la-legend-note">${rw.note}</span>
          </div>
          <div class="la-method">${rw.method ?? ''}</div>
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
      // The threshold crossing goes into the table in time order, between the heights around it.
      const thr = thresholdCrossing(tr);
      const rows: Row[] = gates.slice();
      if (thr) {
        const at = rows.findIndex((r) => r.t > thr.t);
        rows.splice(at < 0 ? rows.length - 1 : at, 0, { ...thr, height: null, threshold: true });
      }

      const from = tr.t.findIndex((x) => x >= -this.windowS);
      const to = tr.t.findIndex((x) => x > 3);
      const cut = <T,>(xs: T[]) => xs.slice(Math.max(0, from), to < 0 ? undefined : to);
      t = cut(tr.t);
      const cursor = this.cursorT !== null ? Math.max(t[0], Math.min(t[t.length - 1], this.cursorT)) : null;
      detail = `
      <div class="la-panel la-table la-gates">
        <div class="la-set-head la-panel-head"><span class="la-label">VALUES BY HEIGHT${helpBtn('height')}</span><span class="la-note">Last descent through each height. Tap a row to place the cursor on the graph.</span></div>
        ${this.gateTable(rows, cursor, u, g !== null, tr, s)}
      </div>
      ${this.seconds(s, tr, u)}
      <div class="la-panel la-chart-box">
        <div class="la-panel-head">
          <span class="la-label">APPROACH AND FLARE · seconds to touchdown</span>
          <span class="la-head-actions">
            <span class="la-key"><i class="la-key-gate"></i>Height</span>
            ${thr ? '<span class="la-key"><i class="la-key-thr"></i>Threshold</span>' : ''}
            <span class="la-key"><i class="la-key-flare"></i>Flare start</span>
            <span class="la-key"><i class="la-key-td"></i>Touchdown</span>
            <div class="la-seg">${[30, 15, 8].map((w) => `<button class="la-seg-btn la-seg-small${w === this.windowS ? ' on' : ''}" data-w="${w}">${w} s</button>`).join('')}</div>
          </span>
        </div>
        <div class="la-readout">${cursor !== null ? this.readout(traceAt(tr, cursor), u, seriesAt(tr.t, tr.power, cursor), s.powerKind) : '<span class="la-note">Tap the graph to read every value at that moment.</span>'}</div>
        <div class="la-stack-hit">${this.stack(s, tr, t, cut, gates, thr, cursor, u)}</div>
      </div>
      ${this.rollout(s, tr, u)}`;
    }

    // The approach side of the same landing replaces everything under the title.
    let apT: ApproachTrace | null = null;
    const body =
      view === 'approach' && ap
        ? this.approachView(s, ap, (apT = apTr), u)
        : `${ap ? this.approachLine(s, ap, u) : ''}
      ${runwayPanel}
      <div class="la-panel la-cells la-cells-5">${this.cells(s, u)}</div>
      ${detail}`;

    el.innerHTML = `
      <div class="la-head">
        <div class="la-head-main">
          ${titleHtml(g ? g.runway.airportIdent : null, g ? g.runway.designation : null)}
          <div class="la-sub">${sub.join(' · ')}</div>
        </div>
        <div class="la-head-actions">
          ${u.s.index ? `<span class="la-index">INDEX ${s.score.total}</span>` : ''}
          <div class="la-seg la-view-seg">
            <button class="la-seg-btn${view === 'touchdown' ? ' on' : ''}" data-view="touchdown">Touchdown</button>
            <button class="la-seg-btn${view === 'approach' ? ' on' : ''}${ap ? '' : ' la-btn-off'}" data-view="approach">Approach</button>
          </div>
          <button class="la-btn${older ? '' : ' la-btn-off'}" data-act="older">Previous</button>
          <button class="la-btn${newer ? '' : ' la-btn-off'}" data-act="newer">Next</button>
          <button class="la-btn" data-act="delete">Delete</button>
        </div>
      </div>
      ${body}`;
    el.scrollTop = scroll;

    const show = (x: LandingSummary | null) => {
      if (!x) return;
      svc.selected.set(x);
      svc.log.markRead(x.id);
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
      svc.log.remove(s.id);
      svc.selected.set(svc.log.latest());
    });
    this.on(el, '[data-view]', (b) => {
      // getAttribute: dataset is not reliable in Coherent.
      const v = b.getAttribute('data-view') === 'approach' && ap ? 'approach' : 'touchdown';
      if (v === this.view && v === view) return;
      this.view = v;
      // Each side starts at its top.
      this.toTop = true;
      this.redraw();
    });
    this.on(el, '[data-act="seconds"]', () => {
      this.secOpen = !this.secOpen;
      this.redraw();
    });
    this.on(el, '.la-seg-btn[data-w]', (b) => {
      this.windowS = Number(b.getAttribute('data-w'));
      this.redraw();
    });
    this.on(el, '.la-row[data-h]', (r) => {
      this.cursorFt = Number(r.getAttribute('data-h'));
      this.redraw();
    });
    const apHit = el.querySelector<HTMLDivElement>('.la-approach-hit');
    apHit?.addEventListener('click', (e) => {
      const box = apHit.getBoundingClientRect();
      if (box.width <= 0 || !apT) return;
      this.cursorFt = Math.round(approachHeightAt(apT, ((e as MouseEvent).clientX - box.left) / box.width));
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
    const cell = (label: string, value: string, unit = '', help = '') =>
      `<div class="la-cell"><div class="la-label">${label}${help ? helpBtn(help) : ''}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    // The half-second average has its own tile. When the sim gave no contact value the main
    // figure is that average (or the last reading), and its unit says so.
    const hasAvg = s.avgVsFpm !== undefined && s.avgVsFpm !== null;
    const vsUnit = s.vsSource === 'fit' ? `${u.vsUnit} · 0.5 s avg` : s.vsSource === 'sample' ? `${u.vsUnit} · last reading` : u.vsUnit;
    const bank = sided(s.bankDeg, 1);
    const crab = sided(s.crabDeg, 1);
    const xw = sided(u.speed(s.crosswindKt), 0);
    const f = s.flare;
    const hw = Math.round(u.speed(s.headwindKt));
    return [
      cell('VERTICAL SPEED', u.fmtVs(s.touchdownVsFpm), vsUnit, 'vs'),
      cell('V/S 0.5 S AVG', hasAvg ? u.fmtVs(s.avgVsFpm as number) : 'n/a', hasAvg ? u.vsUnit : '', 'vs'),
      cell('PEAK LOAD', s.peakG.toFixed(2), 'g', 'g'),
      cell('IAS / GS', `${u.fmtSpeed(s.touchdownIasKt)} / ${u.fmtSpeed(s.touchdownGsKt)}`, u.speedUnit),
      cell('PITCH', `${s.pitchDeg > 0 ? '+' : ''}${s.pitchDeg.toFixed(1)}°`),
      cell('BANK', `${bank.value}°`, bank.side),
      cell('CRAB', `${crab.value}°`, crab.side),
      cell(hw < 0 ? 'TAILWIND' : 'HEADWIND', String(Math.abs(hw)), u.speedUnit),
      cell('CROSSWIND', xw.value, xw.side ? `${u.speedUnit} from ${xw.side}` : u.speedUnit),
      cell('BOUNCES', String(s.bounces)),
      f.vsAtFlareFpm !== null ? cell('V/S AT FLARE', u.fmtVs(f.vsAtFlareFpm), u.vsUnit) : cell('V/S AT FLARE', 'n/a'),
      f.pitchChangeDeg !== null ? cell('PITCH CHANGE', `${signed(f.pitchChangeDeg, 1)}°`, f.approachPitchDeg !== null ? `from ${f.approachPitchDeg.toFixed(1)}°` : '') : cell('PITCH CHANGE', 'n/a'),
      cell('FLARE HEIGHT', f.flareHeightFt !== null ? u.fmtHeight(f.flareHeightFt) : 'n/a', f.flareHeightFt !== null ? u.heightUnit : '', 'flare'),
      cell('FLARE DURATION', f.flareDurationS !== null ? f.flareDurationS.toFixed(1) : 'n/a', f.flareDurationS !== null ? 's' : ''),
      cell(`FLOAT BELOW ${u.s.height === 'ft' ? '5 FT' : '1.5 M'}`, f.floatTimeS.toFixed(1), 's'),
    ].join('');
  }

  private stack(s: LandingSummary, tr: LandingTrace, t: number[], cut: <T>(xs: T[]) => T[], gates: Gate[], thr: TracePoint | null, cursor: number | null, u: Units): string {
    const markers: ChartMarker[] = [{ t: 0, label: '', color: TD }];
    if (thr) markers.push({ t: thr.t, label: `THRESHOLD ${u.fmtHeight(thr.agl)} ${u.heightUnit}`, color: THRESHOLD });
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
        ...(tr.power && tr.power.some((v) => v !== null)
          ? [{ label: `${powerLabel(s.powerKind)} · ${powerUnit(s.powerKind)}, engine average`, values: cut(tr.power), color: LINE, format: (v: number) => `${fmtPower(v, s.powerKind)} ${powerUnit(s.powerKind)}` }]
          : []),
      ],
    });
  }

  private readout(p: TracePoint, u: Units, power: number | null = null, kind: PowerKind | null | undefined = null): string {
    const item = (label: string, value: string) => `<span class="la-read"><span class="la-label">${label}</span><b>${value}</b></span>`;
    return [
      item('CURSOR', Math.abs(p.t) < 0.05 ? 'TD' : `${signed(p.t, 1)} s`),
      item('RA', `${u.fmtHeight(p.agl)} ${u.heightUnit}`),
      item('V/S', `${u.fmtVs(p.vs)} ${u.vsUnit}`),
      item('PITCH', `${signed(p.pitch, 1)}°`),
      item('IAS', `${u.fmtSpeed(p.ias)} ${u.speedUnit}`),
      item('ELEVATOR', `${signed(p.elevator * 100, 0)} %`),
      item('LOAD', `${p.g.toFixed(2)} g`),
      ...(power !== null ? [item(powerLabel(kind), `${fmtPower(power, kind)} ${powerUnit(kind)}`)] : []),
    ].join('');
  }

  private gateTable(gates: Row[], cursor: number | null, u: Units, hasRunway: boolean, tr: LandingTrace, s: LandingSummary): string {
    const hasPower = !!tr.power && tr.power.some((v) => v !== null);
    const pw = hasPower ? ' la-gcol-p' : '';
    const col = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const head =
      `<div class="la-row la-row-head${pw}">` +
      col('la-gcol-h', `HEIGHT ${u.heightUnit}`) +
      col('la-gcol', 'TIME s') +
      col('la-gcol', `V/S ${u.vsUnit}`) +
      col('la-gcol', 'PITCH deg') +
      col('la-gcol', `IAS ${u.speedUnit}`) +
      col('la-gcol', 'ELEVATOR %') +
      (hasPower ? col('la-gcol', `${powerLabel(s.powerKind)} ${powerUnit(s.powerKind)}`) : '') +
      (hasRunway ? col('la-gcol', `C/L ${u.distUnit}`) + col('la-gcol-w', `FROM THRESHOLD ${u.distUnit}`) : '') +
      `</div>`;
    const rows = gates.map((g) => {
      const cl = g.centerline !== null ? sided(u.dist(g.centerline), 0) : null;
      const on = cursor !== null && Math.abs(cursor - g.t) < 0.06;
      return (
        `<div class="la-row${pw}${on ? ' on' : ''}${g.threshold ? ' la-row-thr' : ''}" data-t="${g.t.toFixed(2)}">` +
        col('la-gcol-h', g.threshold ? `Threshold · ${u.fmtHeight(g.agl)}` : g.height !== null ? String(g.height) : 'Touchdown') +
        col('la-gcol', g.height !== null || g.threshold ? g.t.toFixed(1) : '0.0') +
        col('la-gcol', u.fmtVs(g.vs)) +
        col('la-gcol', signed(g.pitch, 1)) +
        col('la-gcol', u.fmtSpeed(g.ias)) +
        col('la-gcol', signed(g.elevator * 100, 0)) +
        (hasPower ? col('la-gcol', fmtPower(g.height === null && !g.threshold && s.powerAtTd !== undefined ? s.powerAtTd : seriesAt(tr.t, tr.power, g.t), s.powerKind)) : '') +
        (hasRunway ? col('la-gcol', cl ? `${cl.value}${cl.side ? ' ' + cl.side : ''}` : 'n/a') + col('la-gcol-w', g.along !== null ? u.fmtDist(g.along) : 'n/a') : '') +
        `</div>`
      );
    });
    return head + rows.join('');
  }

  /** One line of approach figures on the Touchdown view; tapping it turns the page to the approach. */
  private approachLine(s: LandingSummary, a: ApproachSummary, u: Units): string {
    const item = (label: string, value: string) => `<span class="la-read"><span class="la-label">${label}</span><b>${value}</b></span>`;
    const path = a.ilsPath ? 'G/S' : 'PATH';
    const items = [item('STABLE FROM', this.stableText(a, u))];
    if (a.gsMaxAbove !== null && a.gsMaxBelow !== null) items.push(item(path, `${a.gsMaxAbove.toFixed(1)} above · ${a.gsMaxBelow.toFixed(1)} below`));
    if (a.locMaxL !== null && a.locMaxR !== null) items.push(item('LOC', this.locMax(a)));
    if (a.powerAt500 !== null) items.push(item(`${powerLabel(s.powerKind)} AT ${u.s.height === 'ft' ? '500 FT' : '150 M'}`, `${fmtPower(a.powerAt500, s.powerKind)} ${powerUnit(s.powerKind)}`));
    return `<div class="la-panel la-abar" data-view="approach"><span class="la-label la-abar-title">APPROACH</span>${items.join('')}<span class="la-abar-go">View approach</span></div>`;
  }

  private stableText(a: ApproachSummary, u: Units): string {
    return a.stableFt === null ? `below ${u.fmtHeight(100)} ${u.heightUnit}` : `${u.fmtHeight(a.stableFt)}${a.stableAtTop ? '+' : ''} ${u.heightUnit}`;
  }

  /** The larger of the two lateral maxima with its side, e.g. "0.2 L". */
  private locMax(a: ApproachSummary): string {
    const l = a.locMaxL ?? 0;
    const r = a.locMaxR ?? 0;
    return dev(r >= l ? r : -l, 'R', 'L');
  }

  /**
   * The Approach view: the figures, then which condition was met from what height with the
   * deviations and engine power on the same height axis, then the values at set heights.
   */
  private approachView(s: LandingSummary, a: ApproachSummary, tr: ApproachTrace | null, u: Units): string {
    const cell = (label: string, value: string, unit = '', help = '') =>
      `<div class="la-cell"><div class="la-label">${label}${help ? helpBtn(help) : ''}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    const path = a.ilsPath ? 'G/S' : 'PATH';
    const kind = s.powerKind;
    const loc = this.locMax(a).split(' ');
    const cells = [
      cell('STABLE FROM', a.stableFt === null ? `&lt; ${u.fmtHeight(100)}` : `${u.fmtHeight(a.stableFt)}${a.stableAtTop ? '+' : ''}`, u.heightUnit, 'stable'),
      cell(`${path} ABOVE`, a.gsMaxAbove !== null ? a.gsMaxAbove.toFixed(1) : 'n/a', a.gsMaxAbove !== null ? 'dot' : '', 'deviation'),
      cell(`${path} BELOW`, a.gsMaxBelow !== null ? a.gsMaxBelow.toFixed(1) : 'n/a', a.gsMaxBelow !== null ? 'dot' : ''),
      cell('LOC MAX', a.locMaxL !== null ? loc[0] : 'n/a', a.locMaxL !== null ? `dot${loc[1] ? ' ' + loc[1] : ''}` : ''),
      cell(`${powerLabel(kind)} AT ${u.s.height === 'ft' ? '500 FT' : '150 M'}`, fmtPower(a.powerAt500, kind), a.powerAt500 !== null ? powerUnit(kind) : '', 'power'),
      cell(`${powerLabel(kind)} AT TD`, fmtPower(s.powerAtTd, kind), s.powerAtTd !== null && s.powerAtTd !== undefined ? powerUnit(kind) : ''),
      cell('THRESHOLD', a.thresholdFt !== null ? u.fmtHeight(a.thresholdFt) : 'n/a', a.thresholdFt !== null ? u.heightUnit : ''),
    ].join('');
    if (!tr) {
      return `<div class="la-panel la-cells la-cells-7">${cells}</div>
        <div class="la-panel"><div class="la-panel-empty">The approach drawing and its values by height are kept for the 60 most recent landings.</div></div>`;
    }

    const note = a.stableFt === null ? `Not stable at ${u.fmtHeight(100)} ${u.heightUnit}${a.last ? `: ${CONDITION_LABEL[a.last].toLowerCase()}` : ''}` : a.last ? `Last to be met: ${CONDITION_LABEL[a.last].toLowerCase()}` : 'Every condition met from the top of the recording';
    const ref = a.gsMaxAbove === null ? 'No runway matched, so the path is not measured' : a.ilsPath ? `ILS ${s.geometry ? s.geometry.runway.designation : ''}, ${a.pathDeg.toFixed(2)}° path` : `${a.pathDeg.toFixed(1)}° reference path`;
    const cursor = this.cursorFt !== null ? approachAt(tr, Math.max(0, Math.min(Math.max(...tr.h), this.cursorFt))) : null;
    const svg = approachSvg({ summary: a, trace: tr, powerKind: kind ?? null, units: u, pxWidth: this.drawingWidth(98), cursorFt: cursor ? cursor.h : null });

    const heights = APPROACH_HEIGHTS[u.s.height];
    const col = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const hasPath = a.gsMaxAbove !== null;
    const hasPower = tr.power.some((v) => v !== null);
    const nm = u.s.dist === 'ft';
    const head =
      `<div class="la-row la-row-head">` +
      col('la-acol-h', `HEIGHT ${u.heightUnit}`) +
      col('la-acol', 'TIME s') +
      col('la-acol', `V/S ${u.vsUnit}`) +
      col('la-acol', `IAS ${u.speedUnit}`) +
      (hasPower ? col('la-acol', `${powerLabel(kind)} ${powerUnit(kind)}`) : '') +
      (hasPath ? col('la-acol-w', `${path} dot`) + col('la-acol', 'LOC dot') : '') +
      col('la-acol', 'FLAPS') +
      col('la-acol', 'GEAR') +
      col('la-acol', 'BANK deg') +
      (hasPath ? col('la-acol-w', `TO THRESHOLD ${nm ? 'NM' : 'km'}`) : '') +
      `</div>`;
    const reached: { h: number; p: ApproachPoint }[] = [];
    for (const h of heights) {
      const p = approachAt(tr, u.s.height === 'ft' ? h : h * FT_PER_M);
      if (p) reached.push({ h, p });
    }
    const rows = reached.map(({ h, p }) => {
        const bank = sided(p.bank, 1);
        const on = cursor !== null && Math.abs(cursor.h - p.h) < 1;
        return (
          `<div class="la-row${on ? ' on' : ''}" data-h="${p.h.toFixed(0)}">` +
          col('la-acol-h', group(h)) +
          col('la-acol', p.t.toFixed(0)) +
          col('la-acol', u.fmtVs(p.vs)) +
          col('la-acol', u.fmtSpeed(p.ias)) +
          (hasPower ? col('la-acol', fmtPower(p.power, kind)) : '') +
          (hasPath ? col('la-acol-w', dev(p.gs, 'above', 'below')) + col('la-acol', dev(p.loc, 'R', 'L')) : '') +
          col('la-acol', String(p.flaps)) +
          col('la-acol', p.gear ? 'Down' : 'Up') +
          col('la-acol', `${bank.value}${bank.side ? ' ' + bank.side : ''}`) +
          (hasPath ? col('la-acol-w', p.dist !== null ? (p.dist / (nm ? 1852 : 1000)).toFixed(1) : 'n/a') : '') +
          `</div>`
        );
      });

    const item = (label: string, value: string) => `<span class="la-read"><span class="la-label">${label}</span><b>${value}</b></span>`;
    const readout = cursor
      ? [
          item('HEIGHT', `${u.fmtHeight(cursor.h)} ${u.heightUnit}`),
          item('V/S', `${u.fmtVs(cursor.vs)} ${u.vsUnit}`),
          item('IAS', `${u.fmtSpeed(cursor.ias)} ${u.speedUnit}`),
          ...(cursor.power !== null ? [item(powerLabel(kind), `${fmtPower(cursor.power, kind)} ${powerUnit(kind)}`)] : []),
          ...(hasPath ? [item(path, dev(cursor.gs, 'above', 'below')), item('LOC', dev(cursor.loc, 'R', 'L'))] : []),
          item('FLAPS', String(cursor.flaps)),
          item('GEAR', cursor.gear ? 'Down' : 'Up'),
        ].join('')
      : '<span class="la-note">Tap the drawing to read every value at that height.</span>';

    return `<div class="la-panel la-cells la-cells-7">${cells}</div>
      <div class="la-panel la-chart-box">
        <div class="la-panel-head"><span class="la-label">STABILITY · by height above the runway${helpBtn('stable')}</span><span class="la-note">${note} · ${ref}</span></div>
        <div class="la-readout">${readout}</div>
        <div class="la-approach-hit">${svg}</div>
        <div class="la-legend la-approach-legend">
          <span class="la-key"><i class="la-key-bar"></i>Condition met</span>
          <span class="la-key"><i class="la-key-bar la-key-bar-off"></i>Not met</span>
          ${hasPath ? '<span class="la-key"><i class="la-key-band"></i>Within ${STABLE.dots} dots</span>' : ''}
          ${a.stableFt !== null ? '<span class="la-key"><i class="la-key-stable"></i>Stable from here down</span>' : ''}
        </div>
      </div>
      <div class="la-panel la-table la-gates">
        <div class="la-set-head la-panel-head"><span class="la-label">APPROACH BY HEIGHT</span><span class="la-note">Final descent through each height above the runway. Tap a row to place the cursor on the drawing.</span></div>
        ${head}${rows.join('')}
      </div>`;
  }

  /**
   * The seconds either side of touchdown as a table, one row a second, closed until tapped. Shown
   * for landings recorded with wheel contact and engine power.
   */
  private seconds(s: LandingSummary, tr: LandingTrace, u: Units): string {
    if (!tr.wow || !tr.bank || !tr.aoa || !tr.gs) return '';
    const gc = s.gearContact;
    const order = gc
      ? ([['Left main', gc.left], ['Right main', gc.right], ['Nose', gc.nose]] as [string, number | null][])
          .filter((x): x is [string, number] => x[1] !== null)
          .sort((p, q) => p[1] - q[1])
          .map(([name, at], i) => `${i === 0 ? name : name.toLowerCase()} ${at === 0 ? '0.0' : '+' + at.toFixed(1)} s`)
          .join(' · ')
      : '';
    const headRow = `<div class="la-exp" data-act="seconds"><i class="la-exp-mark${this.secOpen ? ' on' : ''}"></i><span class="la-label">AROUND TOUCHDOWN · second by second</span><span class="la-note">${order ? order + ' · ' : ''}tap to ${this.secOpen ? 'close' : 'open'}</span></div>`;
    if (!this.secOpen) return `<div class="la-panel la-table la-sec">${headRow}</div>`;

    const col = (cls: string, text: string) => `<span class="la-col ${cls}">${text}</span>`;
    const hasPower = !!tr.power && tr.power.some((v) => v !== null);
    const head =
      `<div class="la-row la-row-head">` +
      col('la-scol-h', 'SEC') +
      col('la-scol', `RA ${u.heightUnit}`) +
      col('la-scol', `V/S ${u.vsUnit}`) +
      col('la-scol', 'PITCH deg') +
      col('la-scol', 'ROLL deg') +
      col('la-scol', 'AOA deg') +
      col('la-scol', `IAS ${u.speedUnit}`) +
      col('la-scol', `GS ${u.speedUnit}`) +
      (hasPower ? col('la-scol', `${powerLabel(s.powerKind)} ${powerUnit(s.powerKind)}`) : '') +
      col('la-scol', 'LOAD g') +
      col('la-scol-w', 'GEAR ON GROUND') +
      `</div>`;
    const t0 = tr.t[0];
    const t1 = tr.t[tr.t.length - 1];
    const rows: string[] = [];
    for (let sec = -5; sec <= 5; sec++) {
      if (sec < t0 - 0.05 || sec > t1 + 0.05) continue;
      const p = traceAt(tr, sec);
      const td = sec === 0;
      // The highest load within half a second either side, so the touchdown peak is not stepped over.
      let load = 0;
      let wow = 0;
      tr.t.forEach((x, i) => {
        if (Math.abs(x - sec) <= 0.5) load = Math.max(load, tr.g[i]);
        if (x <= sec + 1e-6) wow = tr.wow![i];
      });
      if (td) {
        // The contact instant itself: the peak load, and the wheels that touched within a tenth of a second.
        load = s.peakG;
        if (gc) wow = (gc.left !== null && gc.left <= 0.1 ? 1 : 0) | (gc.right !== null && gc.right <= 0.1 ? 2 : 0) | (gc.nose !== null && gc.nose <= 0.1 ? 4 : 0);
      }
      const roll = sided(seriesAt(tr.t, tr.bank, sec) ?? 0, 1);
      const gear = `${wow & 1 ? 'L' : '·'} ${wow & 2 ? 'R' : '·'} ${wow & 4 ? 'N' : '·'}`;
      rows.push(
        `<div class="la-row${td ? ' la-row-td' : ''}">` +
          col('la-scol-h', td ? 'TD' : signed(sec, 0)) +
          col('la-scol', u.fmtHeight(p.agl)) +
          col('la-scol', u.fmtVs(td ? s.touchdownVsFpm : p.vs)) +
          col('la-scol', signed(td ? s.pitchDeg : p.pitch, 1)) +
          col('la-scol', `${roll.value}${roll.side ? ' ' + roll.side : ''}`) +
          col('la-scol', (seriesAt(tr.t, tr.aoa, sec) ?? 0).toFixed(1)) +
          col('la-scol', u.fmtSpeed(td ? s.touchdownIasKt : p.ias)) +
          col('la-scol', u.fmtSpeed(td ? s.touchdownGsKt : (seriesAt(tr.t, tr.gs, sec) ?? 0))) +
          (hasPower ? col('la-scol', fmtPower(td && s.powerAtTd !== undefined ? s.powerAtTd : seriesAt(tr.t, tr.power, sec), s.powerKind)) : '') +
          col('la-scol', load.toFixed(2)) +
          col(`la-scol-w${wow ? '' : ' la-dim'}`, gear) +
          `</div>`,
      );
    }
    return `<div class="la-panel la-table la-sec">${headRow}${head}${rows.join('')}</div>`;
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
