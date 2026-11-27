/**
 * EFB app entry point. Structure follows the SDK's EFB TemplateApp sample
 * (<SDK>/Samples/DevmodeProjects/EFB/PackageSources/TemplateApp).
 */
import { describe, mark } from './boot';
import { App, AppBootMode, AppInstallProps, AppSuspendMode, AppView, AppViewProps, Efb, RequiredProps, TVNode, UiView, UiViewProps } from '@efb/efb-api';
import { FSComponent, Subject, VNode } from '@microsoft/msfs-sdk';
import { AnalyzerService } from './AnalyzerService';
import { DeparturePage } from './ui/pages/DeparturePage';
import { LandingPage } from './ui/pages/LandingPage';
import { LogPage } from './ui/pages/LogPage';
import { SummaryPage } from './ui/pages/SummaryPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { TabBar } from './ui/components/TabBar';

import './Flarecord.scss';

/** Set when the app could not start, so the tablet shows why instead of the app going missing. */
let startError: string | null = null;

class StartErrorPage extends UiView<UiViewProps> {
  public readonly tabName = 'Summary';

  public render(): VNode {
    return (
      <div class="la-page la-start-error">
        <div class="la-title">Flarecord could not start</div>
        <p>Please send a screenshot of this page. Your saved landings are not affected.</p>
        <pre>{startError}</pre>
      </div>
    );
  }
}

class FlarecordView extends AppView<RequiredProps<AppViewProps, 'bus'>> {
  protected defaultView = 'Summary';
  private readonly activePage = Subject.create('Summary');

  protected registerViews(): void {
    if (startError) {
      // The default page still has to exist, or the view itself fails to open.
      this.appViewService.registerPage('Summary', () => <StartErrorPage />);
      return;
    }
    const svc = AnalyzerService.instance;
    const go = (p: string) => this.go(p);
    // A page that cannot be built shows the reason in its place.
    const page = (name: string, make: () => any) => {
      this.appViewService.registerPage(name, (): any => {
        try {
          const node = make();
          mark(`page ${name} built`);
          return node;
        } catch (e) {
          mark(`page ${name} failed`, e);
          startError = describe(e);
          return <StartErrorPage />;
        }
      });
    };
    page('Departure', () => <DeparturePage svc={svc} go={go} />);
    page('Arrival', () => <LandingPage svc={svc} go={go} />);
    page('Log', () => <LogPage svc={svc} go={go} />);
    page('Summary', () => <SummaryPage svc={svc} go={go} />);
    page('Settings', () => <SettingsPage svc={svc} go={go} />);
    mark('views registered');
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
      console.error(`Flarecord: could not open ${page}`, e);
    }
  }

  public render(): VNode {
    mark('view render');
    if (startError) return <div class="la-app"><div class="la-body">{super.render()}</div></div>;
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
 * (coui://html_ui/efb_ui/efb_apps/Flarecord).
 */
declare const BASE_URL: string;

// The class name is the EFB's internal app name. It matches the package folder name, which the
// build uses to scope this app's CSS, as in the SDK's TemplateApp sample.
class Flarecord extends App {
  public get name(): string {
    return 'Flarecord';
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
    Efb.loadCss(`${BASE_URL}/Flarecord.css`).catch(() => undefined);
    // Whatever goes wrong here, the app must still register, or it vanishes from the tablet
    // with nothing to say why.
    mark('install');
    try {
      AnalyzerService.start(this.bus);
      mark('service started');
    } catch (e) {
      startError = describe(e);
      mark('service failed', e);
      console.error('Flarecord: could not start', e);
    }
    return super.install(props);
  }

  public render(): TVNode<FlarecordView> {
    mark('app render');
    return <FlarecordView bus={this.bus} />;
  }
}

try {
  Efb.use(Flarecord);
  mark('registered with the EFB');
} catch (e) {
  mark('EFB registration failed', e);
  throw e;
}
