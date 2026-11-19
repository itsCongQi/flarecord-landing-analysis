import { UiView, UiViewProps } from '@efb/efb-api';
import { FSComponent, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';
import type { LandingSummary, LandingTrace } from '../../core/types';
import { chartSvg, type ChartMarker } from '../components/chartSvg';
import { where } from '../format';

interface Props extends UiViewProps {
  svc: AnalyzerService;
}

/**
 * Flare analysis: four synchronised graphs on one time axis (seconds to touchdown), with
 * FLARE and TD markers, plus a rollout centreline graph when the runway was identified.
 * A window switch zooms between the last 30 s (approach) and the last 10 s (flare).
 */
// A UiView: AppViewService calls onOpen/onResume/onPause on every registered page.
export class AnalysisPage extends UiView<Props> {
  public readonly tabName = 'Analysis';
  private readonly root = FSComponent.createRef<HTMLDivElement>();
  private windowS = 15;

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    this.props.svc.selected.sub(() => this.draw(), true);
  }

  private draw(): void {
    const el = this.root.instance;
    const s = this.props.svc.selected.get();
    const tr = s ? this.props.svc.log.getTrace(s.id) : null;
    if (!s || !tr) {
      el.innerHTML = `<div class="la-empty"><h2>No graph data</h2><p>${s ? 'Graphs are kept for the 60 most recent landings.' : 'Land once to see the flare analysis.'}</p></div>`;
      return;
    }
    el.innerHTML = `
      <div class="la-an-head">
        <div><b>${where(s)}</b> · ${s.touchdownVsFpm} fpm · ${s.peakG.toFixed(2)} g</div>
        <div class="la-seg">${[30, 15, 8].map((w) => `<button class="la-seg-btn ${w === this.windowS ? 'on' : ''}" data-w="${w}">${w} s</button>`).join('')}</div>
      </div>
      <div class="la-charts">${this.charts(s, tr)}</div>
      <div class="la-flare-facts">${this.facts(s)}</div>`;
    // Array.from + getAttribute: NodeList.forEach and dataset are not reliable in Coherent.
    Array.from(el.querySelectorAll<HTMLButtonElement>('.la-seg-btn')).forEach((b) =>
      b.addEventListener('click', () => {
        this.windowS = Number(b.getAttribute('data-w'));
        this.draw();
      }),
    );
  }

  private charts(s: LandingSummary, tr: LandingTrace): string {
    const from = tr.t.findIndex((t) => t >= -this.windowS);
    const to = tr.t.findIndex((t) => t > 3);
    const cut = <T,>(xs: T[]) => xs.slice(Math.max(0, from), to < 0 ? undefined : to);
    const t = cut(tr.t);
    const markers: ChartMarker[] = [{ t: 0, label: 'TD', color: '#ff6b6b' }];
    if (s.flare.flareDurationS !== null) markers.push({ t: -s.flare.flareDurationS, label: 'FLARE', color: '#ffd166' });
    const W = 640;
    const H = 150;
    const box = (title: string, svg: string) => `<div class="la-chart-box"><div class="la-chart-title">${title}</div>${svg}</div>`;

    let html =
      box('Vertical speed', chartSvg({ t, width: W, height: H, unit: 'fpm', markers, series: [{ values: cut(tr.vs), color: '#4cc9f0', label: 'VS' }], guides: [{ value: -150, label: 'target -150' }] })) +
      box('Height above ground', chartSvg({ t, width: W, height: H, unit: 'ft', markers, yMin: 0, series: [{ values: cut(tr.agl), color: '#80ed99', label: 'AGL' }] })) +
      box('Pitch and pitch input', chartSvg({ t, width: W, height: H, unit: 'deg / %', markers, series: [
        { values: cut(tr.pitch), color: '#f9c74f', label: 'Pitch' },
        { values: cut(tr.elevator).map((v) => v * 10), color: '#b388ff', label: 'Input x10' },
      ] })) +
      box('Indicated airspeed', chartSvg({ t, width: W, height: H, unit: 'kt', markers, series: [{ values: cut(tr.ias), color: '#f8961e', label: 'IAS' }] }));

    if (tr.centerline.some((v) => v !== null)) {
      const r0 = tr.t.findIndex((x) => x >= 0);
      html += box('Rollout: distance from centreline', chartSvg({ t: tr.t.slice(r0), width: W, height: H, unit: 'm', series: [{ values: tr.centerline.slice(r0), color: '#4cc9f0', label: 'CL' }], guides: [{ value: 0, label: 'centreline' }] }));
    }
    return html;
  }

  private facts(s: LandingSummary): string {
    const f = s.flare;
    const row = (k: string, v: string) => `<div class="la-fact"><span>${k}</span><b>${v}</b></div>`;
    return [
      row('Flare started', f.flareHeightFt !== null ? `${Math.round(f.flareHeightFt)} ft, ${f.flareDurationS!.toFixed(1)} s before TD` : 'not detected'),
      row('Sink rate at flare → TD', f.vsAtFlareFpm !== null ? `${Math.round(f.vsAtFlareFpm)} → ${s.touchdownVsFpm} fpm` : `${s.touchdownVsFpm} fpm`),
      row('Pitch added in flare', f.pitchChangeDeg !== null ? `${f.pitchChangeDeg.toFixed(1)}° (from ${f.approachPitchDeg?.toFixed(1)}°)` : '--'),
      row('Float below 5 ft', `${f.floatTimeS.toFixed(1)} s`),
      row('Detected by', f.method === 'pitch' ? 'attitude change' : f.method === 'input' ? 'pitch input' : '--'),
    ].join('');
  }

  render(): VNode {
    return <div class="la-page la-analysis" ref={this.root} />;
  }
}
