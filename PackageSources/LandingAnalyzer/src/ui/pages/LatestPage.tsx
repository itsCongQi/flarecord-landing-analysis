import { UiView, UiViewProps } from '@efb/efb-api';
import { FSComponent, NodeReference, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';
import type { LandingSummary } from '../../core/types';
import { coachingTip, fmtVs, fmtWhen, gradeClass, where } from '../format';

interface Props extends UiViewProps {
  svc: AnalyzerService;
  go: (page: string) => void;
}

/**
 * "Latest" page: the score ring, the six headline numbers, the score breakdown and one coaching tip.
 * Rendered as an HTML string on change; it changes once per landing, so this is cheap.
 */
// A UiView: AppViewService calls onOpen/onResume/onPause on every registered page.
export class LatestPage extends UiView<Props> {
  public readonly tabName = 'Latest';
  private readonly root = FSComponent.createRef<HTMLDivElement>();

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    this.props.svc.selected.sub((s) => this.draw(s), true);
  }

  private draw(s: LandingSummary | null): void {
    const el = this.root.instance;
    if (!s) {
      el.innerHTML = `<div class="la-empty"><h2>No landings yet</h2><p>Fly an approach. The analyzer arms below 200 ft and records automatically, even with the tablet closed.</p></div>`;
      return;
    }
    const tile = (label: string, value: string, sub = '') => `<div class="la-tile"><div class="la-tile-label">${label}</div><div class="la-tile-value">${value}</div><div class="la-tile-sub">${sub}</div></div>`;
    const g = s.geometry;
    el.innerHTML = `
      ${s.example ? '<div class="la-example-note">Example landing. Your own landings replace the examples after your first touchdown.</div>' : ''}
      <div class="la-hero">
        <div class="la-score ${gradeClass(s.score.grade)}"><span class="la-score-num">${s.score.total}</span><span class="la-score-grade">${s.score.grade}</span></div>
        <div class="la-hero-text">
          <div class="la-where">${where(s)}</div>
          <div class="la-when">${fmtWhen(s.recordedAt)} · ${s.aircraft}${s.touchAndGo ? ' · touch-and-go' : ''}</div>
          <div class="la-tip">${coachingTip(s)}</div>
        </div>
      </div>
      <div class="la-tiles">
        ${tile('Touchdown rate', fmtVs(s.touchdownVsFpm), `peak ${s.peakG.toFixed(2)} g`)}
        ${tile('Speed', `${s.touchdownIasKt} kt IAS`, `${s.touchdownGsKt} kt GS`)}
        ${tile('Attitude', `${s.pitchDeg.toFixed(1)}° pitch`, `${s.bankDeg.toFixed(1)}° bank · ${s.crabDeg.toFixed(1)}° crab`)}
        ${tile('Wind', `${Math.abs(s.headwindKt).toFixed(0)} kt ${s.headwindKt >= 0 ? 'head' : 'tail'}`, `${Math.abs(s.crosswindKt).toFixed(0)} kt from ${s.crosswindKt >= 0 ? 'right' : 'left'}`)}
        ${tile('Flare', s.flare.flareHeightFt !== null ? `${Math.round(s.flare.flareHeightFt)} ft` : 'none', `${s.flare.floatTimeS.toFixed(1)} s float · ${s.bounces} bounce${s.bounces === 1 ? '' : 's'}`)}
        ${tile('Runway', g ? `${Math.round(g.distFromThresholdM)} m` : '--', g ? `${Math.abs(g.centerlineOffsetM).toFixed(1)} m ${g.centerlineOffsetM >= 0 ? 'right' : 'left'} of CL` : 'not identified')}
      </div>
      <div class="la-breakdown">
        ${s.score.parts
          .map((p) => `<div class="la-bar-row"><span class="la-bar-label">${p.label}</span><span class="la-bar"><span class="la-bar-fill" style="width:${(100 * p.points) / p.max}%"></span></span><span class="la-bar-val">${p.points}/${p.max}</span><span class="la-bar-note">${p.note}</span></div>`)
          .join('')}
      </div>
      <button class="la-btn" id="la-open-analysis">Open flare analysis</button>`;
    el.querySelector('#la-open-analysis')?.addEventListener('click', () => this.props.go('Analysis'));
  }

  render(): VNode {
    return <div class="la-page la-latest" ref={this.root as NodeReference<HTMLDivElement>} />;
  }
}
