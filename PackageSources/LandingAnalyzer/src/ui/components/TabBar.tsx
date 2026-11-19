import { ComponentProps, DisplayComponent, FSComponent, NodeReference, Subscribable, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';
import { Units } from '../../core/units';

interface Props extends ComponentProps {
  svc: AnalyzerService;
  go: (page: string) => void;
  /** Key of the page currently shown, to highlight its tab. */
  active: Subscribable<string>;
}

const PAGES = ['Landing', 'Log', 'Settings'];
const PHASE_LABEL: Record<string, string> = { idle: 'MONITORING', armed: 'ARMED', rollout: 'RECORDING' };

/** Top bar: page tabs, then a status strip with the capture state and live values. */
export class TabBar extends DisplayComponent<Props> {
  private readonly tabRefs: NodeReference<HTMLButtonElement>[] = PAGES.map(() => FSComponent.createRef<HTMLButtonElement>());
  private readonly dot = FSComponent.createRef<HTMLSpanElement>();
  private readonly phase = this.props.svc.phase.map((p) => PHASE_LABEL[p] ?? p.toUpperCase());
  private readonly ra = FSComponent.createRef<HTMLSpanElement>();
  private readonly vs = FSComponent.createRef<HTMLSpanElement>();
  private readonly gs = FSComponent.createRef<HTMLSpanElement>();

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    const svc = this.props.svc;
    // FSComponent does not bind onClick props on plain HTML elements: attach real listeners.
    PAGES.forEach((p, i) => this.tabRefs[i].instance.addEventListener('click', () => this.props.go(p)));
    this.props.active.sub((key) => {
      PAGES.forEach((p, i) => {
        const cl = this.tabRefs[i].instance.classList;
        if (p === key) cl.add('on');
        else cl.remove('on');
      });
    }, true);
    svc.phase.sub((p) => {
      const cl = this.dot.instance.classList;
      if (p === 'idle') cl.remove('live');
      else cl.add('live');
    }, true);
    const values = () => {
      const s = svc.live.get();
      const u = new Units(svc.settings.get());
      this.ra.instance.textContent = s ? `RA ${u.fmtHeight(Math.max(0, s.agl))} ${u.heightUnit}` : 'RA --';
      this.vs.instance.textContent = s ? `V/S ${u.fmtVs(s.vs)} ${u.vsUnit}` : 'V/S --';
      this.gs.instance.textContent = s ? `GS ${u.fmtSpeed(s.gs)} ${u.speedUnit}` : 'GS --';
    };
    svc.live.sub(values);
    svc.settings.sub(values, true);
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
        <div class="la-strip">
          <span class="la-dot" ref={this.dot} />
          <span class="la-status">{this.phase}</span>
          <span class="la-live" ref={this.ra} />
          <span class="la-live" ref={this.vs} />
          <span class="la-live" ref={this.gs} />
          <span class="la-strip-note">Recording arms below 200 ft</span>
        </div>
      </div>
    );
  }
}
