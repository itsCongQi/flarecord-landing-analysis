import { ComponentProps, DisplayComponent, FSComponent, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';

interface Props extends ComponentProps {
  svc: AnalyzerService;
  go: (page: string) => void;
}

const PHASE_LABEL: Record<string, string> = { idle: 'Monitoring', armed: 'Armed: on approach', rollout: 'Recording rollout' };

/** Top bar: page tabs plus a live strip (AGL, VS, IAS) and the capture status. */
export class TabBar extends DisplayComponent<Props> {
  private readonly live = this.props.svc.live.map((s) =>
    s ? `${Math.round(s.agl)} ft AGL   ${Math.round(s.vs)} fpm   ${Math.round(s.ias)} kt` : '--',
  );
  private readonly phase = this.props.svc.phase.map((p) => PHASE_LABEL[p] ?? p);

  render(): VNode {
    return (
      <div class="la-topbar">
        <div class="la-tabs">
          {['Latest', 'Analysis', 'History'].map((p) => (
            <button class="la-tab" onClick={() => this.props.go(p)}>
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
