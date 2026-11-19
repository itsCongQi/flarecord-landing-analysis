import { aircraftCounts, summarize } from '../../core/summary';
import type { LandingSummary } from '../../core/types';
import { group } from '../../core/units';
import { stackSvg, stackTimeAt } from '../components/chartSvg';
import { dispersionStrip } from '../components/runwaySvg';
import { esc } from '../format';
import { EXAMPLE_NOTE, PageBase } from './PageBase';

const LINE = '#5ab0ff';
const RANGES: [number, string][] = [[10, 'Last 10'], [30, 'Last 30'], [0, 'All']];
/** Aircraft offered as filter buttons; the rest stay reachable through "All". */
const MAX_AIRCRAFT = 5;

/**
 * Summary: how the logged landings compare with each other. Medians, the touchdown points
 * overlaid on one runway outline, and each landing's key figures in order, filterable by
 * aircraft. Tapping the trend graph opens that landing.
 */
export class SummaryPage extends PageBase {
  public readonly tabName = 'Summary';
  protected readonly pageClass = 'la-summary';
  private range = 30;
  private aircraft = '';

  protected draw(el: HTMLDivElement): void {
    const log = this.props.svc.log;
    const u = this.units;
    const all = log.list();
    const fleet = aircraftCounts(all).slice(0, MAX_AIRCRAFT);
    if (this.aircraft && !all.some((s) => s.aircraft === this.aircraft)) this.aircraft = '';
    const byAircraft = this.aircraft ? all.filter((s) => s.aircraft === this.aircraft) : all;
    // Newest first, like the log.
    const shown = this.range ? byAircraft.slice(0, this.range) : byAircraft;
    const st = summarize(shown);
    const scroll = el.scrollTop;

    const cell = (label: string, value: string, unit = '') => `<div class="la-cell"><div class="la-label">${label}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    const seg = (cls: string, attr: string, value: string, label: string, on: boolean) => `<button class="la-seg-btn ${cls}${on ? ' on' : ''}" ${attr}="${esc(value)}">${esc(label)}</button>`;
    const strip = dispersionStrip(shown.slice(0, 60), u, this.drawingWidth(98));
    // Oldest to newest, left to right.
    const seq: LandingSummary[] = shown.filter((s) => !s.touchAndGo).reverse();

    el.innerHTML = `
      ${log.showingExamples ? EXAMPLE_NOTE : ''}
      <div class="la-head">
        <div class="la-head-main"><div class="la-title">Summary</div><div class="la-sub">${shown.length} of ${all.length} landing${all.length === 1 ? '' : 's'}${this.aircraft ? ' · ' + esc(this.aircraft) : ''}</div></div>
        <div class="la-head-actions"><div class="la-seg">${RANGES.map(([n, label]) => seg('la-seg-small', 'data-range', String(n), label, n === this.range)).join('')}</div></div>
      </div>
      ${fleet.length > 1 ? `<div class="la-filter"><span class="la-label">AIRCRAFT</span><div class="la-seg">${seg('la-seg-small', 'data-ac', '', 'All', this.aircraft === '')}${fleet.map((f) => seg('la-seg-small la-seg-clip', 'data-ac', f.aircraft, f.aircraft, f.aircraft === this.aircraft)).join('')}</div></div>` : ''}
      <div class="la-panel la-cells la-cells-7">
        ${cell('LANDINGS', String(st?.count ?? 0))}
        ${cell('MEDIAN V/S', st ? u.fmtVs(st.medianVs) : 'n/a', st ? u.vsUnit : '')}
        ${cell('MEDIAN LOAD', st ? st.medianG.toFixed(2) : 'n/a', st ? 'g' : '')}
        ${cell('MEDIAN TD POINT', st && st.medianTdM !== null ? u.fmtDist(st.medianTdM) : 'n/a', st && st.medianTdM !== null ? u.distUnit : '')}
        ${cell('MEDIAN C/L', st && st.medianClM !== null ? group(u.dist(st.medianClM)) : 'n/a', st && st.medianClM !== null ? u.distUnit : '')}
        ${cell('MEDIAN FLARE', st && st.medianFlareFt !== null ? u.fmtHeight(st.medianFlareFt) : 'n/a', st && st.medianFlareFt !== null ? u.heightUnit : '')}
        ${cell('WITH A BOUNCE', st ? String(st.bounced) : 'n/a', st ? `of ${st.count}` : '')}
      </div>
      ${strip ? `<div class="la-panel la-rw-panel"><div class="la-panel-head"><span class="la-label">TOUCHDOWN DISPERSION · ALL RUNWAYS OVERLAID</span><span class="la-note">Distance from each runway's own threshold and centreline</span></div>${strip}</div>` : ''}
      ${
        seq.length >= 2
          ? `<div class="la-panel la-chart-box">
              <div class="la-panel-head"><span class="la-label">LANDING BY LANDING · oldest to newest</span><span class="la-note">Tap a point to open that landing.</span></div>
              <div class="la-stack-hit">${this.trend(seq)}</div>
            </div>`
          : '<div class="la-panel"><div class="la-panel-empty">The landing by landing graph appears once there are two landings to compare.</div></div>'
      }`;
    el.scrollTop = scroll;

    this.on(el, '[data-range]', (b) => {
      // getAttribute: dataset is not reliable in Coherent.
      this.range = Number(b.getAttribute('data-range'));
      this.redraw();
    });
    this.on(el, '[data-ac]', (b) => {
      this.aircraft = b.getAttribute('data-ac') ?? '';
      this.redraw();
    });
    const hit = el.querySelector<HTMLDivElement>('.la-stack-hit');
    hit?.addEventListener('click', (e) => {
      const box = hit.getBoundingClientRect();
      if (box.width <= 0) return;
      const n = Math.round(stackTimeAt(seq.map((_, i) => i + 1), ((e as MouseEvent).clientX - box.left) / box.width));
      const s = seq[Math.max(1, Math.min(seq.length, n)) - 1];
      this.props.svc.selected.set(s);
      this.props.go('Landing');
    });
  }

  private trend(seq: LandingSummary[]): string {
    const u = this.units;
    return stackSvg({
      t: seq.map((_, i) => i + 1),
      sequence: true,
      cursorT: null,
      pxWidth: this.drawingWidth(98),
      lanes: [
        { label: `VERTICAL SPEED AT TOUCHDOWN · ${u.vsUnit}`, values: seq.map((s) => u.vs(s.touchdownVsFpm)), color: LINE, format: (v) => String(v) },
        { label: 'PEAK LOAD · g', values: seq.map((s) => s.peakG), color: LINE, format: (v) => String(v) },
        { label: `TOUCHDOWN POINT · ${u.distUnit} from threshold`, values: seq.map((s) => (s.geometry ? u.dist(s.geometry.distFromThresholdM) : null)), color: LINE, yMin: 0, format: (v) => String(v) },
        { label: `CENTRELINE OFFSET · ${u.distUnit}, right positive`, values: seq.map((s) => (s.geometry ? u.dist(s.geometry.centerlineOffsetM) : null)), color: LINE, format: (v) => String(v) },
        { label: `FLARE HEIGHT · ${u.heightUnit}`, values: seq.map((s) => (s.flare.flareHeightFt !== null ? u.height(s.flare.flareHeightFt) : null)), color: LINE, yMin: 0, format: (v) => String(v) },
      ],
    });
  }
}
