/**
 * EFB app entry point. Structure follows the SDK's EFB TemplateApp sample
 * (<SDK>/Samples/DevmodeProjects/EFB/PackageSources/TemplateApp).
 */
import { App, AppBootMode, AppInstallProps, AppSuspendMode, AppView, AppViewProps, Efb, RequiredProps, TVNode } from '@efb/efb-api';
import { FSComponent, Subject, VNode } from '@microsoft/msfs-sdk';
import { AnalyzerService } from './AnalyzerService';
import { AnalysisPage } from './ui/pages/AnalysisPage';
import { HistoryPage } from './ui/pages/HistoryPage';
import { LatestPage } from './ui/pages/LatestPage';
import { TabBar } from './ui/components/TabBar';

import './LandingAnalyzer.scss';

class LandingAnalyzerView extends AppView<RequiredProps<AppViewProps, 'bus'>> {
  protected defaultView = 'Latest';
  private readonly activePage = Subject.create('Latest');

  protected registerViews(): void {
    const svc = AnalyzerService.instance;
    this.appViewService.registerPage('Latest', () => <LatestPage svc={svc} go={(p) => this.go(p)} />);
    this.appViewService.registerPage('Analysis', () => <AnalysisPage svc={svc} />);
    this.appViewService.registerPage('History', () => <HistoryPage svc={svc} go={(p) => this.go(p)} />);
  }

  private go(page: string): void {
    // open() throws if the page is already in the view stack; nothing to do when it is showing.
    if (!this.appViewService.isActive(page)) this.appViewService.open(page);
    this.activePage.set(page);
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
