import { UiView, UiViewProps } from '@efb/efb-api';
import { FSComponent, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';
import { Units } from '../../core/units';

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
    this.props.svc.settings.sub(() => this.redraw());
    this.props.svc.selected.sub(() => this.redraw());
    this.props.svc.log.onChange(() => this.redraw());
    this.redraw();
  }

  // Drawings are sized in pixels from the page width, which is only known once the page is shown.
  public onOpen(): void {
    super.onOpen();
    this.redraw();
  }

  public onResume(): void {
    super.onResume();
    this.redraw();
  }

  protected redraw(): void {
    const el = this.root.getOrDefault();
    if (!el) return;
    try {
      this.draw(el);
    } catch (e) {
      console.error(`Flarecord: ${this.pageClass} draw failed`, e);
    }
  }

  protected abstract draw(el: HTMLDivElement): void;

  /** Attach a click listener to every element matching a selector (FSComponent ignores onClick). */
  protected on(el: HTMLElement, selector: string, fn: (target: HTMLElement) => void): void {
    // Array.from: NodeList.forEach is not reliable in Coherent.
    Array.from(el.querySelectorAll<HTMLElement>(selector)).forEach((t) => t.addEventListener('click', () => fn(t)));
  }

  render(): VNode {
    return <div class={`la-page ${this.pageClass}`} ref={this.root} />;
  }
}

export const EXAMPLE_NOTE = '<div class="la-example-note">Example data. Your own landings replace the examples after your first touchdown.</div>';

/** Screen title: airport and runway, or a plain note when no runway was matched. */
export function titleHtml(airportIdent: string | null, designation: string | null): string {
  return airportIdent ? `<div class="la-title">${airportIdent} <span>RWY</span> ${designation}</div>` : '<div class="la-title">Runway not identified</div>';
}
