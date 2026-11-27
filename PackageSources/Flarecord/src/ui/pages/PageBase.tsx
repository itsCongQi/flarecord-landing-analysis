import { UiView, UiViewProps } from '@efb/efb-api';
import { FSComponent, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';
import { Units } from '../../core/units';
import { method } from '../methods';

export interface PageProps extends UiViewProps {
  svc: AnalyzerService;
  go: (page: string) => void;
}

/**
 * Shared page plumbing. Pages are UiViews (AppViewService calls onOpen/onResume/onPause on every
 * registered page) that render an HTML string into one root element. They change a few times per
 * flight, so a full redraw is cheap, and it keeps the layout free of framework bindings that
 * Coherent handles differently from a browser.
 */
export abstract class PageBase extends UiView<PageProps> {
  protected readonly root = FSComponent.createRef<HTMLDivElement>();
  protected abstract readonly pageClass: string;

  protected get units(): Units {
    return new Units(this.props.svc.settings.get());
  }

  /** Width available for drawings, in CSS pixels. Pages built while hidden report 0: use a fallback. */
  protected drawingWidth(inset: number): number {
    const w = this.root.getOrDefault()?.clientWidth ?? 0;
    return Math.max(480, (w > 0 ? w : 1180) - inset);
  }

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    this.props.svc.settings.sub(() => this.changed());
    this.props.svc.selected.sub(() => this.changed());
    this.props.svc.log.onChange(() => this.changed());
    this.props.svc.selectedTakeoff.sub(() => this.changed());
    this.props.svc.takeoffs.onChange(() => this.changed());
    this.props.svc.fileState.sub(() => this.changed());
    // A tap anywhere else closes an open explanation.
    this.root.instance.addEventListener('click', () => {
      if (this.helpTapped) this.helpTapped = false;
      else this.closeHelp();
    });
    this.redraw();
  }

  // Drawings are sized in pixels from the page width, which is only known once the page is shown.
  public onOpen(): void {
    super.onOpen();
    this.showing = true;
    this.redraw();
  }

  public onResume(): void {
    super.onResume();
    this.showing = true;
    this.redraw();
  }

  public onPause(): void {
    super.onPause();
    this.showing = false;
  }

  public onClose(): void {
    super.onClose();
    this.showing = false;
  }

  /** True between onOpen/onResume and onPause/onClose: the page is the one on screen. */
  private showing = false;
  private redrawQueued = false;

  /**
   * Something the page shows has changed. A page that is not on screen is left alone: it is drawn
   * afresh when it is opened or resumed anyway. One landing changes several things at once (the
   * log, the selection), so the page on screen is redrawn once for all of them, a moment later.
   * This keeps the end of a rollout from rebuilding every page, drawings included, twice over.
   */
  protected changed(): void {
    if (!this.showing || this.redrawQueued) return;
    this.redrawQueued = true;
    setTimeout(() => {
      this.redrawQueued = false;
      if (this.showing) this.redraw();
    }, 0);
  }

  protected redraw(): void {
    const el = this.root.getOrDefault();
    if (!el) return;
    try {
      this.draw(el);
      this.helpKey = null;
      this.on(el, '.la-help', (b) => this.toggleHelp(el, b));
    } catch (e) {
      console.error(`Flarecord: ${this.pageClass} draw failed`, e);
    }
  }

  protected abstract draw(el: HTMLDivElement): void;

  private helpKey: string | null = null;
  private helpTapped = false;

  private closeHelp(): void {
    const el = this.root.getOrDefault();
    const tip = el?.querySelector('.la-tip');
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    this.helpKey = null;
  }

  /**
   * Show how a figure is obtained in a small box under its "?" button; a second tap closes it.
   * The box is placed inside the scrolling page so it moves with the content.
   */
  private toggleHelp(el: HTMLDivElement, btn: HTMLElement): void {
    this.helpTapped = true;
    const key = btn.getAttribute('data-help') ?? '';
    const was = this.helpKey;
    this.closeHelp();
    const m = method(key);
    if (!m || was === key) return;
    const tip = document.createElement('div');
    tip.className = 'la-tip';
    tip.innerHTML = `<div class="la-tip-title">${m.title}</div><div class="la-tip-text">${m.text}</div>`;
    const width = 420;
    const page = el.getBoundingClientRect();
    const at = btn.getBoundingClientRect();
    // Without usable geometry, fall back to the top of what is on screen.
    const known = page.width > 0 && at.width > 0;
    const left = known ? Math.max(12, Math.min(at.left - page.left - 24, page.width - width - 28)) : 28;
    const top = known ? at.bottom - page.top + el.scrollTop + 8 : el.scrollTop + 70;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.width = `${width}px`;
    el.appendChild(tip);
    this.helpKey = key;
  }

  /** Attach a click listener to every element matching a selector (FSComponent ignores onClick). */
  protected on(el: HTMLElement, selector: string, fn: (target: HTMLElement) => void): void {
    // Array.from: NodeList.forEach is not reliable in Coherent.
    Array.from(el.querySelectorAll<HTMLElement>(selector)).forEach((t) => t.addEventListener('click', () => fn(t)));
  }

  render(): VNode {
    return <div class={`la-page ${this.pageClass}`} ref={this.root} />;
  }
}

/**
 * Shown on a page while the log holds no landings. `where` says what will appear on that page.
 * The mark is the app icon's flare path.
 */
export function emptyState(where: string, takeoff = false): string {
  if (takeoff) {
    return `<div class="la-panel la-first">
    <svg class="la-first-mark" viewBox="0 0 64 64" width="72" height="72" style="width:72px;height:72px"><path d="M10 43L22 43Q31 43 38 34L51 17" fill="none" stroke="#e8ecf0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="43" r="5" fill="#e3b341"/></svg>
    <div class="la-first-title">No takeoffs recorded yet</div>
    <div class="la-first-text">Just take off as you normally would. Flarecord notices the roll on its own and records it, from where you started to 3,000 ft.</div>
    <div class="la-first-text">${where}</div>
    <div class="la-first-steps">
      <span class="la-first-step"><b>1</b>Line up and take off</span>
      <span class="la-first-step"><b>2</b>Climb through 3,000 ft</span>
      <span class="la-first-step"><b>3</b>Open Flarecord</span>
    </div>
  </div>`;
  }
  return `<div class="la-panel la-first">
    <svg class="la-first-mark" viewBox="0 0 64 64" width="72" height="72" style="width:72px;height:72px"><path d="M13 17L26 34Q33 43 42 43" fill="none" stroke="#e8ecf0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="43" r="5" fill="#e3b341"/></svg>
    <div class="la-first-title">No landings recorded yet</div>
    <div class="la-first-text">Just fly and land as you normally would. There is nothing to start or set up: Flarecord arms on its own below 200 ft on every approach and records the landing for you.</div>
    <div class="la-first-text">${where}</div>
    <div class="la-first-steps">
      <span class="la-first-step"><b>1</b>Fly an approach</span>
      <span class="la-first-step"><b>2</b>Land and slow down</span>
      <span class="la-first-step"><b>3</b>Open Flarecord</span>
    </div>
  </div>`;
}

/** Which log a page shows: landings (Arrivals) or takeoffs (Departures). */
export type Kind = 'landings' | 'takeoffs';

/** The switch between the two logs, with how many each holds. Buttons carry data-kind. */
export function kindSwitch(kind: Kind, landings: number, takeoffs: number): string {
  const btn = (k: Kind, label: string, n: number) => `<button class="la-seg-btn la-seg-small${k === kind ? ' on' : ''}" data-kind="${k}">${label} · ${n}</button>`;
  return `<div class="la-seg la-kind-seg">${btn('takeoffs', 'Departures', takeoffs)}${btn('landings', 'Arrivals', landings)}</div>`;
}

/** Screen title: airport and runway, or a plain note when no runway was matched. */
export function titleHtml(airportIdent: string | null, designation: string | null): string {
  return airportIdent ? `<div class="la-title">${airportIdent} <span>RWY</span> ${designation}</div>` : '<div class="la-title">Runway not identified</div>';
}
