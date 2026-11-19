import type { LandingSummary, LandingTrace } from '../../core/types';
import type { Units } from '../../core/units';
import { chartSvg, type ChartMarker } from '../components/chartSvg';
import { esc, fmtWhen } from '../format';
import { EXAMPLE_NOTE, PageBase, titleHtml } from './PageBase';

const LINE = '#5ab0ff';
const LINE2 = '#8a94a0';
const FLARE = '#e3b341';
const TD = '#e8ecf0';

/**
 * Analysis: the approach and flare as graphs on one time axis (seconds to touchdown), with the
 * flare start and touchdown marked, plus the rollout's distance from the centreline when the
 * runway was identified. A window switch zooms between the last 30, 15 and 8 seconds.
 */
export class AnalysisPage extends PageBase {
  public readonly tabName = 'Analysis';
  protected readonly pageClass = 'la-analysis';
  private windowS = 15;

  protected draw(el: HTMLDivElement): void {
    const s = this.props.svc.selected.get();
    const tr = s ? this.props.svc.log.getTrace(s.id) : null;
    if (!s || !tr) {
      el.innerHTML = `<div class="la-empty"><div class="la-title">No graph data</div><p>${s ? 'Graphs are kept for the 60 most recent landings.' : 'Graphs appear after the first recorded landing.'}</p></div>`;
      return;
    }
    const u = this.units;
    const g = s.geometry;
    el.innerHTML = `
      ${s.example ? EXAMPLE_NOTE : ''}
      <div class="la-head">
        <div class="la-head-main">
          ${titleHtml(g ? g.runway.airportIdent : null, g ? g.runway.designation : null)}
          <div class="la-sub">${esc(s.aircraft)} · ${fmtWhen(s.recordedAt, true)} · time axis in seconds to touchdown</div>
        </div>
        <div class="la-head-actions">
          <span class="la-key"><i class="la-key-flare"></i>Flare start</span>
          <span class="la-key"><i class="la-key-td"></i>Touchdown</span>
          <div class="la-seg">${[30, 15, 8].map((w) => `<button class="la-seg-btn${w === this.windowS ? ' on' : ''}" data-w="${w}">${w} s</button>`).join('')}</div>
        </div>
      </div>
      <div class="la-panel la-cells la-cells-5">${this.facts(s, u)}</div>
      ${this.charts(s, tr, u)}`;
    this.on(el, '.la-seg-btn', (b) => {
      // getAttribute: dataset is not reliable in Coherent.
      this.windowS = Number(b.getAttribute('data-w'));
      this.redraw();
    });
  }

  private charts(s: LandingSummary, tr: LandingTrace, u: Units): string {
    const from = tr.t.findIndex((t) => t >= -this.windowS);
    const to = tr.t.findIndex((t) => t > 3);
    const cut = <T,>(xs: T[]) => xs.slice(Math.max(0, from), to < 0 ? undefined : to);
    const t = cut(tr.t);
    const markers: ChartMarker[] = [{ t: 0, label: '', color: TD }];
    if (s.flare.flareDurationS !== null) markers.push({ t: -s.flare.flareDurationS, label: '', color: FLARE });
    const size = { width: 1080, height: 150, pxWidth: this.drawingWidth(98) };
    const box = (title: string, svg: string, legend = '') => `<div class="la-panel la-chart-box"><div class="la-panel-head"><span class="la-label">${title}</span>${legend}</div>${svg}</div>`;
    const key = (cls: string, text: string) => `<span class="la-key"><i class="${cls}"></i>${text}</span>`;

    let html =
      box(`VERTICAL SPEED · ${u.vsUnit}`, chartSvg({ ...size, t, unit: u.vsUnit, markers, series: [{ values: cut(tr.vs).map((v) => u.vs(v)), color: LINE, label: 'VS' }] })) +
      box(`RADIO ALTITUDE · ${u.heightUnit}`, chartSvg({ ...size, t, unit: u.heightUnit, markers, yMin: 0, series: [{ values: cut(tr.agl).map((v) => u.height(v)), color: LINE, label: 'RA' }] })) +
      box(
        'PITCH · deg',
        chartSvg({ ...size, t, unit: 'deg', markers, series: [
          { values: cut(tr.elevator).map((v) => v * 10), color: LINE2, label: 'Input' },
          { values: cut(tr.pitch), color: LINE, label: 'Pitch' },
        ] }),
        `<span>${key('la-key-line', 'Pitch attitude')}${key('la-key-line2', 'Elevator input, x10 %')}</span>`,
      ) +
      box(`INDICATED AIRSPEED · ${u.speedUnit}`, chartSvg({ ...size, t, unit: u.speedUnit, markers, series: [{ values: cut(tr.ias).map((v) => u.speed(v)), color: LINE, label: 'IAS' }] }));

    const r0 = tr.t.findIndex((x) => x >= 0);
    if (r0 >= 0 && tr.centerline.slice(r0).some((v) => v !== null)) {
      html += box(
        `ROLLOUT · distance from centreline, ${u.distUnit} (right positive) · seconds after touchdown`,
        chartSvg({ ...size, t: tr.t.slice(r0), unit: u.distUnit, series: [{ values: tr.centerline.slice(r0).map((v) => (v === null ? null : u.dist(v))), color: LINE, label: 'CL' }], guides: [{ value: 0, label: 'centreline' }] }),
      );
    }
    return html;
  }

  private facts(s: LandingSummary, u: Units): string {
    const f = s.flare;
    const cell = (label: string, value: string, unit = '') => `<div class="la-cell"><div class="la-label">${label}</div><div class="la-value">${value}${unit ? ` <span>${unit}</span>` : ''}</div></div>`;
    return [
      f.flareHeightFt !== null && f.flareDurationS !== null ? cell('FLARE START', u.fmtHeight(f.flareHeightFt), `${u.heightUnit} · -${f.flareDurationS.toFixed(1)} s`) : cell('FLARE START', 'n/a'),
      f.vsAtFlareFpm !== null ? cell('V/S AT FLARE', u.fmtVs(f.vsAtFlareFpm), u.vsUnit) : cell('V/S AT FLARE', 'n/a'),
      cell('V/S AT TOUCHDOWN', u.fmtVs(s.touchdownVsFpm), u.vsUnit),
      f.pitchChangeDeg !== null ? cell('PITCH CHANGE', `${f.pitchChangeDeg > 0 ? '+' : ''}${f.pitchChangeDeg.toFixed(1)}°`, f.approachPitchDeg !== null ? `from ${f.approachPitchDeg.toFixed(1)}°` : '') : cell('PITCH CHANGE', 'n/a'),
      cell(`FLOAT BELOW ${u.s.height === 'ft' ? '5 FT' : '1.5 M'}`, f.floatTimeS.toFixed(1), 's'),
    ].join('');
  }
}
