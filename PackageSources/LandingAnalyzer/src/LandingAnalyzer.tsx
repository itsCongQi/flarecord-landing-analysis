/**
 * EFB app entry point. Structure follows the SDK's EFB TemplateApp sample
 * (<SDK>/Samples/DevmodeProjects/EFB/PackageSources/TemplateApp).
 */
import { App, AppBootMode, AppInstallProps, AppSuspendMode, AppView, AppViewProps, Efb, RequiredProps, TVNode } from '@efb/efb-api';
import { FSComponent, VNode } from '@microsoft/msfs-sdk';
import { AnalyzerService } from './AnalyzerService';
import { AnalysisPage } from './ui/pages/AnalysisPage';
import { HistoryPage } from './ui/pages/HistoryPage';
import { LatestPage } from './ui/pages/LatestPage';
import { TabBar } from './ui/components/TabBar';

import './LandingAnalyzer.scss';

class LandingAnalyzerView extends AppView<RequiredProps<AppViewProps, 'bus'>> {
  protected defaultView = 'Latest';

  protected registerViews(): void {
    const svc = AnalyzerService.instance;
    this.appViewService.registerPage('Latest', () => <LatestPage svc={svc} go={(p) => this.go(p)} />);
    this.appViewService.registerPage('Analysis', () => <AnalysisPage svc={svc} />);
    this.appViewService.registerPage('History', () => <HistoryPage svc={svc} go={(p) => this.go(p)} />);
  }

  private go(page: string): void {
    this.appViewService.open(page);
  }

  public render(): VNode {
    return (
      <div class="la-app">
        <TabBar svc={AnalyzerService.instance} go={(p) => this.go(p)} />
        <div class="la-body">{super.render()}</div>
      </div>
    );
  }
}

class LandingAnalyzerApp extends App {
  public get name(): string {
    return 'Landing Analyzer';
  }

  public get icon(): string {
    return `coui://html_ui/efb_ui/efb_apps/LandingAnalyzer/Assets/app-icon.svg`;
  }

  // Build the app's UI at boot so the first open is instant. Capture does not depend on this:
  // it is started from install() below.
  public BootMode = AppBootMode.WARM;
  public SuspendMode = AppSuspendMode.SLEEP;

  public async install(props: AppInstallProps): Promise<void> {
    AnalyzerService.start(this.bus);
    return super.install?.(props);
  }

  public render(): TVNode<LandingAnalyzerView> {
    return <LandingAnalyzerView bus={this.bus} />;
  }
}

Efb.use(LandingAnalyzerApp);
