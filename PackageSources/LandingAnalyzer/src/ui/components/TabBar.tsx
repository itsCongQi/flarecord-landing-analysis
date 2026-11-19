import { ComponentProps, DisplayComponent, FSComponent, NodeReference, Subscribable, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';

interface Props extends ComponentProps {
  svc: AnalyzerService;
  go: (page: string) => void;
  /** Key of the page currently shown, to highlight its tab. */
  active: Subscribable<string>;
}

const PAGES = ['Latest', 'Analysis', 'History'];
const PHASE_LABEL: Record<string, string> = { idle: 'Monitoring', armed: 'Armed: on approach', rollout: 'Recording rollout' };

/** Top bar: page tabs plus a live strip (AGL, VS, IAS) and the capture status. */
export class TabBar extends DisplayComponent<Props> {
  private readonly live = this.props.svc.live.map((s) =>
    s ? `${Math.max(0, Math.round(s.agl))} ft AGL   ${Math.round(s.vs)} fpm   ${Math.round(s.ias)} kt` : '--',
  );
  private readonly phase = this.props.svc.phase.map((p) => PHASE_LABEL[p] ?? p);
  private readonly tabRefs: NodeReference<HTMLButtonElement>[] = PAGES.map(() => FSComponent.createRef<HTMLButtonElement>());

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    // FSComponent does not bind onClick props on plain HTML elements: attach real listeners.
    PAGES.forEach((p, i) => this.tabRefs[i].instance.addEventListener('click', () => this.props.go(p)));
    this.props.active.sub((key) => {
      PAGES.forEach((p, i) => {
        const cl = this.tabRefs[i].instance.classList;
        if (p === key) cl.add('on');
        else cl.remove('on');
      });
    }, true);
  }

  render(): VNode {
    return (
      <div class="la-topbar">
        <div class="la-tabs">
          {PAGES.map((p, i) => (
            <button class="la-tab" ref={this.tabRefs[i]}>
              {p}
            </button>
          ))}
        </div>
        <div class="la-live">
          <span class="la-status">{this.phase}</span>
          <span class="la-live-values">{this.live}</span>
        </div>
      </div>
    );
  }
}
