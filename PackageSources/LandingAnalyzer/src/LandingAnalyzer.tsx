/**
 * EFB app entry point. Structure follows the SDK's EFB TemplateApp sample
 * (<SDK>/Samples/DevmodeProjects/EFB/PackageSources/TemplateApp).
 */
import { App, AppBootMode, AppInstallProps, AppSuspendMode, AppView, AppViewProps, Efb, RequiredProps, TVNode } from '@efb/efb-api';
import { FSComponent, Subject, VNode } from '@microsoft/msfs-sdk';
import { AnalyzerService } from './AnalyzerService';
import { LandingPage } from './ui/pages/LandingPage';
import { LogPage } from './ui/pages/LogPage';
import { SummaryPage } from './ui/pages/SummaryPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { TabBar } from './ui/components/TabBar';

import './LandingAnalyzer.scss';

class LandingAnalyzerView extends AppView<RequiredProps<AppViewProps, 'bus'>> {
  protected defaultView = 'Landing';
  private readonly activePage = Subject.create('Landing');

  protected registerViews(): void {
    const svc = AnalyzerService.instance;
    const go = (p: string) => this.go(p);
    this.appViewService.registerPage('Landing', () => <LandingPage svc={svc} go={go} />);
    this.appViewService.registerPage('Log', () => <LogPage svc={svc} go={go} />);
    this.appViewService.registerPage('Summary', () => <SummaryPage svc={svc} go={go} />);
    this.appViewService.registerPage('Settings', () => <SettingsPage svc={svc} go={go} />);
  }

  /**
   * Tab switch. AppViewService keeps a stack: open() hides the current page but leaves it in the
   * stack, and open() on a page already in the stack throws. So go back down the stack to a page
   * that is already in it, and only open() pages that are not.
   */
  private go(page: string): void {
    const svc = this.appViewService;
    try {
      if (svc.isInViewStack(page)) {
        while (!svc.isActive(page)) svc.goBack(1);
      } else {
        svc.open(page);
      }
      this.activePage.set(page);
    } catch (e) {
      console.error(`LandingAnalyzer: could not open ${page}`, e);
    }
  }

  public render(): VNode {
    return (
      <div class="la-app">
        <TabBar svc={AnalyzerService.instance} go={(p) => this.go(p)} active={this.activePage} />
        <div class="la-body">{super.render()}</div>
      </div>
    );
  }
}

/**
 * BASE_URL is defined in build.js and points at this app's folder in the package
 * (coui://html_ui/efb_ui/efb_apps/LandingAnalyzer).
 */
declare const BASE_URL: string;

// The class name is the EFB's internal app name. It matches the package folder name, which the
// build uses to scope this app's CSS, as in the SDK's TemplateApp sample.
class LandingAnalyzer extends App {
  public get name(): string {
    return 'Landing Analyzer';
  }

  public get icon(): string {
    return `${BASE_URL}/Assets/app-icon.svg`;
  }

  // Build the app's UI at boot so the first open is instant. Capture does not depend on this:
  // it is started from install() below.
  public BootMode = AppBootMode.WARM;
  public SuspendMode = AppSuspendMode.SLEEP;

  public async install(props: AppInstallProps): Promise<void> {
    // The bundled stylesheet is not applied automatically: load it like the SDK sample does.
    Efb.loadCss(`${BASE_URL}/LandingAnalyzer.css`).catch(() => undefined);
    AnalyzerService.start(this.bus);
    return super.install(props);
  }

  public render(): TVNode<LandingAnalyzerView> {
    return <LandingAnalyzerView bus={this.bus} />;
  }
}

Efb.use(LandingAnalyzer);
