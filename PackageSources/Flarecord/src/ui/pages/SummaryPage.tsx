import { aircraftCounts, filterByAircraft, parseSelection, summarize, toggleAircraft, type AircraftSelection } from '../../core/summary';
import type { LandingSummary } from '../../core/types';
import { group } from '../../core/units';
import { stackSvg } from '../components/chartSvg';
import { dispersionStrip } from '../components/runwaySvg';
import { esc, fmtAgo, where } from '../format';
import { PageBase, emptyState } from './PageBase';

const LINE = '#5ab0ff';
const RANGES: [number, string][] = [[10, 'Last 10'], [30, 'Last 30'], [0, 'All']];
/** Show the search box in the aircraft list once it is longer than this. */
const SEARCH_FROM = 9;

/**
 * Summary: how the logged landings compare with each other. Medians, the touchdown points
 * overlaid on one runway outline, and each landing's key figures in order.
 *
 * Aircraft filter: "All aircraft" is one tap and is the default. "Choose aircraft" opens a tick
 * list (most flown first, with landing counts) that scrolls and can be searched, so it stays
 * usable when every livery shows up as its own aircraft. The selection is remembered.
 */
export class SummaryPage extends PageBase {
  public readonly tabName = 'Summary';
  protected readonly pageClass = 'la-summary';
  private range = 30;
  /** null until first drawn, then read from the stored preference. */
  private selection: AircraftSelection | undefined;
  private pickerOpen = false;
  private search = '';
  /** Newest unread landing whose notice was dismissed; a later landing shows the notice again. */
  private dismissedId = '';

  protected draw(el: HTMLDivElement): void {
    const log = this.props.svc.log;
    const u = this.units;
    const all = log.list();
    if (!all.length) {
      el.innerHTML = `<div class="la-head"><div class="la-head-main"><div class="la-title">Summary</div><div class="la-sub">Figures across your landings</div></div></div>${emptyState('Your medians, touchdown points and landing by landing trend will build up here.')}`;
      return;
    }
    const fleet = aircraftCounts(all);
    const names = fleet.map((f) => f.aircraft);
    if (this.selection === undefined) this.selection = parseSelection(this.props.svc.getPref('summaryAircraft'));
    const sel = this.selection;
    const ticked = (name: string) => sel === null || sel.includes(name);
    const byAircraft = filterByAircraft(all, sel);
    // Newest first, like the log.
    const shown = this.range ? byAircraft.slice(0, this.range) : byAircraft;
    const st = summarize(shown);
    const scroll = el.scrollTop;
    const listScroll = el.querySelector('.la-ac-list')?.scrollTop ?? 0;

    const cell = (label: string, value: string, unit = '') => `<div class="la-cell"><div class="la-label">${label}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    const seg = (cls: string, attr: string, value: string, label: string, on: boolean) => `<button class="la-seg-btn ${cls}${on ? ' on' : ''}" ${attr}="${esc(value)}">${esc(label)}</button>`;
    const strip = dispersionStrip(shown.slice(0, 60), u, this.drawingWidth(98));
    // Oldest to newest, left to right.
    const seq: LandingSummary[] = shown.filter((s) => !s.touchAndGo).reverse();

    // Landings recorded but not opened yet: a notice that opens the newest one.
    const unread = log.unreadList();
    const fresh = unread.length && unread[0].id !== this.dismissedId ? unread[0] : null;
    const notice = fresh
      ? `<div class="la-notice">
          <i class="la-new-dot on"></i>
          <div class="la-notice-main"><b>${unread.length === 1 ? 'New landing recorded' : `${unread.length} new landings recorded`}</b><span>${unread.length === 1 ? '' : 'Latest: '}${esc(where(fresh))} · ${esc(fresh.aircraft)} · ${fmtAgo(fresh.recordedAt)}</span></div>
          <button class="la-btn la-btn-small la-btn-accent" data-act="open-new">Open landing</button>
          <button class="la-btn la-btn-small" data-act="dismiss-new">Dismiss</button>
        </div>`
      : '';

    el.innerHTML = `
      ${notice}
      <div class="la-head">
        <div class="la-head-main"><div class="la-title">Summary</div><div class="la-sub">${shown.length} of ${all.length} landing${all.length === 1 ? '' : 's'}</div></div>
        <div class="la-head-actions"><div class="la-seg">${RANGES.map(([n, label]) => seg('la-seg-small', 'data-range', String(n), label, n === this.range)).join('')}</div></div>
      </div>
      ${fleet.length > 1 ? this.aircraftFilter(fleet, sel, ticked) : ''}
      <div class="la-panel la-cells la-cells-4">
        ${cell('LANDINGS', String(st?.count ?? 0))}
        ${cell('MEDIAN V/S', st ? u.fmtVs(st.medianVs) : 'n/a', st ? u.vsUnit : '')}
        ${cell('MEDIAN LOAD', st ? st.medianG.toFixed(2) : 'n/a', st ? 'g' : '')}
        ${cell('MEDIAN TD POINT', st && st.medianTdM !== null ? u.fmtDist(st.medianTdM) : 'n/a', st && st.medianTdM !== null ? u.distUnit : '')}
        ${cell('MEDIAN C/L', st && st.medianClM !== null ? group(u.dist(st.medianClM)) : 'n/a', st && st.medianClM !== null ? u.distUnit : '')}
        ${cell('MEDIAN FLARE', st && st.medianFlareFt !== null ? u.fmtHeight(st.medianFlareFt) : 'n/a', st && st.medianFlareFt !== null ? u.heightUnit : '')}
        ${cell('WITH A BOUNCE', st ? String(st.bounced) : 'n/a', st ? `of ${st.count}` : '')}
        ${cell('MEDIAN STABLE FROM', st && st.medianStableFt !== null ? u.fmtHeight(st.medianStableFt) : 'n/a', st && st.medianStableFt !== null ? u.heightUnit : '')}
      </div>
      ${strip ? `<div class="la-panel la-rw-panel"><div class="la-panel-head"><span class="la-label">TOUCHDOWN DISPERSION · ALL RUNWAYS OVERLAID</span><span class="la-note">Distance from each runway's own threshold and centreline</span></div>${strip}</div>` : ''}
      ${
        seq.length >= 2
          ? `<div class="la-panel la-chart-box">
              <div class="la-panel-head"><span class="la-label">LANDING BY LANDING · oldest to newest</span></div>
              ${this.trend(seq)}
            </div>`
          : '<div class="la-panel"><div class="la-panel-empty">The landing by landing graph appears once there are two landings to compare.</div></div>'
      }`;
    el.scrollTop = scroll;

    this.on(el, '[data-act="open-new"]', () => {
      if (!fresh) return;
      this.props.svc.selected.set(fresh);
      this.props.go('Landing');
    });
    this.on(el, '[data-act="dismiss-new"]', () => {
      if (fresh) this.dismissedId = fresh.id;
      this.redraw();
    });
    this.on(el, '[data-range]', (b) => {
      // getAttribute: dataset is not reliable in Coherent.
      this.range = Number(b.getAttribute('data-range'));
      this.redraw();
    });
    const list = el.querySelector<HTMLDivElement>('.la-ac-list');
    if (list) list.scrollTop = listScroll;
    const choose = (next: AircraftSelection) => {
      this.selection = next;
      this.props.svc.setPref('summaryAircraft', next === null ? null : JSON.stringify(next));
      this.redraw();
    };
    this.on(el, '[data-ac-all]', () => choose(null));
    this.on(el, '[data-ac-none]', () => choose([]));
    this.on(el, '[data-ac-open]', () => {
      this.pickerOpen = !this.pickerOpen;
      this.redraw();
    });
    this.on(el, '[data-ac]', (b) => choose(toggleAircraft(this.selection ?? null, b.getAttribute('data-ac') ?? '', names)));
    // Searching hides rows in place, so typing does not rebuild the page under the keyboard.
    const search = el.querySelector<HTMLInputElement>('.la-ac-search');
    const applySearch = () => {
      this.search = (search?.value ?? '').trim().toLowerCase();
      Array.from(el.querySelectorAll<HTMLElement>('.la-ac-item')).forEach((item) => {
        const hit = !this.search || (item.getAttribute('data-ac') ?? '').toLowerCase().includes(this.search);
        item.style.display = hit ? '' : 'none';
      });
    };
    search?.addEventListener('input', applySearch);
    search?.addEventListener('change', applySearch);
    if (this.search) applySearch();
  }

  private aircraftFilter(fleet: { aircraft: string; count: number }[], sel: AircraftSelection, ticked: (name: string) => boolean): string {
    const chosen = fleet.filter((f) => ticked(f.aircraft));
    let summary: string;
    if (sel === null) summary = `All ${fleet.length} aircraft`;
    else if (chosen.length === 0) summary = 'None ticked';
    else summary = `${chosen.length} of ${fleet.length}: ${chosen.slice(0, 2).map((f) => esc(f.aircraft)).join(', ')}${chosen.length > 2 ? `, +${chosen.length - 2} more` : ''}`;

    const bar = `
      <div class="la-ac-bar">
        <span class="la-label">AIRCRAFT</span>
        <div class="la-seg">
          <button class="la-seg-btn la-seg-small${sel === null ? ' on' : ''}" data-ac-all="1">All aircraft</button>
          <button class="la-seg-btn la-seg-small${sel !== null ? ' on' : ''}" data-ac-open="1">${this.pickerOpen ? 'Hide list' : 'Choose aircraft'}</button>
        </div>
        <span class="la-ac-summary">${summary}</span>
      </div>`;
    if (!this.pickerOpen) return `<div class="la-panel la-ac">${bar}</div>`;

    const items = fleet
      .map(
        (f) => `<button class="la-ac-item${ticked(f.aircraft) ? ' on' : ''}" data-ac="${esc(f.aircraft)}">
          <i class="la-tick"></i><span class="la-ac-name">${esc(f.aircraft)}</span><span class="la-ac-count">${f.count}</span>
        </button>`,
      )
      .join('');
    return `<div class="la-panel la-ac">
      ${bar}
      <div class="la-ac-tools">
        ${fleet.length > SEARCH_FROM ? `<input class="la-search la-ac-search" placeholder="Find an aircraft" value="${esc(this.search)}"/>` : ''}
        <span class="la-note">Tick the aircraft to include. The number is how many landings each has.</span>
        <button class="la-btn la-btn-small" data-ac-none="1">Untick all</button>
      </div>
      <div class="la-ac-list">${items}</div>
    </div>`;
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
        // Only once a landing with a recorded approach is in the selection.
        ...(seq.some((s) => s.approach && s.approach.stableFt !== null)
          ? [{ label: `APPROACH STABLE FROM · ${u.heightUnit} above the runway`, values: seq.map((s) => (s.approach && s.approach.stableFt !== null ? u.height(s.approach.stableFt) : null)), color: LINE, yMin: 0, format: (v: number) => String(v) }]
          : []),
      ],
    });
  }
}
