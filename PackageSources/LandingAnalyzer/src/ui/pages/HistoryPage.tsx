import { ComponentProps, DisplayComponent, FSComponent, VNode } from '@microsoft/msfs-sdk';
import type { AnalyzerService } from '../../AnalyzerService';
import { chartSvg } from '../components/chartSvg';
import { fmtWhen, gradeClass, where } from '../format';

interface Props extends ComponentProps {
  svc: AnalyzerService;
  go: (page: string) => void;
}

/** History: personal stats, a score trend line and the list of every logged landing. */
export class HistoryPage extends DisplayComponent<Props> {
  private readonly root = FSComponent.createRef<HTMLDivElement>();
  private filter = '';

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    this.draw();
    this.props.svc.log.onChange(() => this.draw());
  }

  private draw(): void {
    const log = this.props.svc.log;
    const el = this.root.instance;
    const all = log.list();
    const rows = this.filter ? all.filter((s) => (s.aircraft + where(s)).toLowerCase().includes(this.filter)) : all;
    const st = log.stats();
    const trend = [...rows].slice(0, 30).reverse();

    el.innerHTML = `
      <div class="la-stats">
        <div class="la-stat"><span>Landings</span><b>${st?.count ?? 0}</b></div>
        <div class="la-stat"><span>Average score</span><b>${st?.avgScore ?? '--'}</b></div>
        <div class="la-stat"><span>Best score</span><b>${st?.bestScore ?? '--'}</b></div>
        <div class="la-stat"><span>Average rate</span><b>${st ? st.avgVs + ' fpm' : '--'}</b></div>
      </div>
      ${trend.length >= 2 ? `<div class="la-chart-box"><div class="la-chart-title">Score, last ${trend.length} landings</div>${chartSvg({ t: trend.map((_, i) => i), width: 640, height: 110, unit: 'pts', yMin: 0, yMax: 100, series: [{ values: trend.map((s) => s.score.total), color: '#4cc9f0', label: 'Score' }], timeAxis: false })}</div>` : ''}
      <input class="la-search" placeholder="Filter by aircraft or airport" value="${this.filter}"/>
      <div class="la-list">
        ${rows
          .map(
            (s) => `<div class="la-row" data-id="${s.id}">
              <span class="la-row-score ${gradeClass(s.score.grade)}">${s.score.total}</span>
              <span class="la-row-main"><b>${where(s)}</b><small>${fmtWhen(s.recordedAt)} · ${s.aircraft}</small></span>
              <span class="la-row-num">${s.touchdownVsFpm} fpm</span>
              <span class="la-row-num">${s.peakG.toFixed(2)} g</span>
              <span class="la-row-num">${s.bounces ? s.bounces + '× bounce' : ''}</span>
            </div>`,
          )
          .join('')}
      </div>`;

    el.querySelector<HTMLInputElement>('.la-search')?.addEventListener('change', (e) => {
      this.filter = (e.target as HTMLInputElement).value.toLowerCase();
      this.draw();
    });
    el.querySelectorAll<HTMLDivElement>('.la-row').forEach((r) =>
      r.addEventListener('click', () => {
        const s = log.list().find((x) => x.id === r.dataset.id) ?? null;
        this.props.svc.selected.set(s);
        this.props.go('Latest');
      }),
    );
  }

  render(): VNode {
    return <div class="la-page la-history" ref={this.root} />;
  }
}
