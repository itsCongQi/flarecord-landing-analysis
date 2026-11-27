/**
 * The Approach view's drawing: which stable-approach condition was met from what height, with the
 * glidepath deviation, the lateral deviation and engine power below it, all on one height axis
 * that runs from the top of the recorded approach on the left down to the runway on the right.
 * A string of SVG, like the other charts.
 */
import { CONDITIONS, CONDITION_LABEL, STABLE } from '../../core/approach';
import type { ApproachSummary, ApproachTrace, PowerKind } from '../../core/types';
import { group, type Units } from '../../core/units';
import { niceStep } from './chartSvg';

const A = { width: 1080, padL: 150, padR: 104, top: 36, row: 22, lane: 62, gap: 26, padB: 24 };
const LINE = '#5ab0ff';
const TRACK = '#2a323c';
const STABLE_COLOR = '#3fb950';
const TEXT = '#e8ecf0';
/** Deviation lanes show two dots either way; anything beyond rides the edge. */
const DOTS = 2;

/** The height the drawing starts at on the left, feet. */
export function approachTop(tr: ApproachTrace): number {
  return Math.max(STABLE.floorFt * 2, Math.min(STABLE.topFt, Math.max(...tr.h)));
}

/** The height under a horizontal position in the drawing (0 = left edge of the image), feet. */
export function approachHeightAt(tr: ApproachTrace, fraction: number): number {
  const w = A.width - A.padL - A.padR;
  const f = Math.max(0, Math.min(1, (fraction * A.width - A.padL) / w));
  return approachTop(tr) * (1 - f);
}

/** Index of the last point at or above a height: the final descent through it. */
export function approachIndexAt(tr: ApproachTrace, heightFt: number): number {
  for (let i = tr.h.length - 1; i >= 0; i--) if (tr.h[i] >= heightFt) return i;
  return 0;
}

export interface ApproachPoint {
  t: number;
  h: number;
  vs: number;
  ias: number;
  bank: number;
  power: number | null;
  gs: number | null;
  loc: number | null;
  flaps: number;
  gear: number;
  dist: number | null;
}

/** Every value on the final descent through a height, or null when the recording starts below it. */
export function approachAt(tr: ApproachTrace, heightFt: number): ApproachPoint | null {
  if (tr.h.length === 0 || Math.max(...tr.h) < heightFt) return null;
  const i = approachIndexAt(tr, heightFt);
  const j = Math.min(i + 1, tr.h.length - 1);
  const f = tr.h[i] - tr.h[j] > 1e-6 ? Math.max(0, Math.min(1, (tr.h[i] - heightFt) / (tr.h[i] - tr.h[j]))) : 0;
  const mix = (xs: number[]) => xs[i] + (xs[j] - xs[i]) * f;
  const mixOpt = (xs: (number | null)[]) => (xs[i] === null ? xs[j] : xs[j] === null ? xs[i] : (xs[i] as number) + ((xs[j] as number) - (xs[i] as number)) * f);
  // The handles are steps, not slopes: what was set on arriving at the height.
  const k = f >= 1 ? j : i;
  return { t: mix(tr.t), h: heightFt, vs: mix(tr.vs), ias: mix(tr.ias), bank: mix(tr.bank), power: mixOpt(tr.power), gs: mixOpt(tr.gs), loc: mixOpt(tr.loc), flaps: tr.flaps[k], gear: tr.gear[k], dist: mixOpt(tr.dist) };
}

function tickStep(top: number): number {
  for (const s of [50, 100, 200, 250, 500, 1000]) if (top / s <= 7) return s;
  return 1000;
}

export interface ApproachSvgOptions {
  summary: ApproachSummary;
  trace: ApproachTrace;
  powerKind: PowerKind | null;
  units: Units;
  pxWidth: number;
  /** Height of the read-out cursor, feet, or null for none. */
  cursorFt: number | null;
}

export function approachSvg(o: ApproachSvgOptions): string {
  const { summary: a, trace: tr, units: u } = o;
  const { width, padL, padR, top, row, lane, gap, padB } = A;
  const w = width - padL - padR;
  const topFt = approachTop(tr);
  const x = (h: number) => padL + (1 - Math.max(0, Math.min(topFt, h)) / topFt) * w;
  const hasPath = tr.gs.some((v) => v !== null);
  const hasPower = tr.power.some((v) => v !== null);
  const lanes = (hasPath ? 2 : 0) + (hasPower ? 1 : 0);
  const barsBottom = top + CONDITIONS.length * row;
  const lanesTop = barsBottom + 22;
  const bottom = lanes > 0 ? lanesTop + lanes * lane + (lanes - 1) * gap : barsBottom;
  const height = bottom + padB;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${Math.round(o.pxWidth)}" height="${Math.round((o.pxWidth * height) / width)}" class="la-chart la-approach">`);

  // Height axis along the bottom, in the display unit.
  const topUnit = u.height(topFt);
  const step = tickStep(topUnit);
  const perUnit = topFt / topUnit;
  for (let v = Math.floor(topUnit / step) * step; v >= 0; v -= step) {
    const xx = x(v * perUnit).toFixed(1);
    p.push(`<text x="${xx}" y="${bottom + 16}" class="la-axis" text-anchor="middle">${v === 0 ? `0 ${u.heightUnit}` : group(v)}</text>`);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${top - 10}" y2="${bottom}" class="${v * perUnit === 1000 || v * perUnit === 500 ? 'la-gate' : 'la-grid'}"/>`);
  }

  // One bar per condition: the track, and over it the stretches where the condition was met.
  const floorX = x(STABLE.floorFt);
  CONDITIONS.forEach((key, n) => {
    const y = top + n * row + row / 2;
    const c = a.conditions.find((q) => q.key === key);
    p.push(`<text x="0" y="${y + 4}" class="la-lane-label">${CONDITION_LABEL[key].toUpperCase()}</text>`);
    if (!c || !c.measured) {
      p.push(`<text x="${padL}" y="${y + 4}" class="la-axis">not measured for this landing</text>`);
      return;
    }
    p.push(`<rect x="${padL}" y="${y - 4}" width="${(floorX - padL).toFixed(1)}" height="8" rx="2" fill="${TRACK}"/>`);
    let from: number | null = null;
    const flush = (to: number) => {
      if (from !== null && to - from > 0.2) p.push(`<rect x="${from.toFixed(1)}" y="${y - 4}" width="${(to - from).toFixed(1)}" height="8" rx="2" fill="${LINE}"/>`);
      from = null;
    };
    for (let i = 0; i < tr.h.length - 1; i++) {
      const a0 = Math.min(floorX, x(tr.h[i]));
      const a1 = Math.min(floorX, x(tr.h[i + 1]));
      if (tr.met[i] & (1 << n) && a1 > a0) {
        if (from === null) from = a0;
        if (i === tr.h.length - 2) flush(a1);
      } else if (from !== null) {
        flush(a0);
      }
    }
    const label = c.fromFt === null ? 'not met' : `${u.fmtHeight(c.fromFt)}${c.top ? '+' : ''} ${u.heightUnit}`;
    p.push(`<text x="${padL + w + 12}" y="${y + 4}" class="la-cursor-value"${key === a.last ? '' : ' opacity="0.72"'}>${label}</text>`);
  });

  // Lanes under the bars, each with its own scale.
  const dots: string[] = [];
  const ci = o.cursorFt !== null ? approachIndexAt(tr, o.cursorFt) : -1;
  let k = 0;
  const drawLane = (title: string, sub: string, values: (number | null)[], lo: number, hi: number, ticks: { v: number; label: string }[], band: boolean) => {
    const y0 = lanesTop + k * (lane + gap);
    k++;
    const y = (v: number) => y0 + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * lane;
    p.push(`<text x="0" y="${y0 + lane / 2}" class="la-lane-label">${title}</text>`);
    p.push(`<text x="0" y="${y0 + lane / 2 + 14}" class="la-axis">${sub}</text>`);
    if (band) p.push(`<rect x="${padL}" y="${y(STABLE.dots).toFixed(1)}" width="${w}" height="${(y(-STABLE.dots) - y(STABLE.dots)).toFixed(1)}" fill="${LINE}" opacity="0.09"/>`);
    for (const t of ticks) {
      const yy = y(t.v).toFixed(1);
      p.push(`<line x1="${padL}" x2="${padL + w}" y1="${yy}" y2="${yy}" class="la-grid"/>`);
      p.push(`<text x="${padL - 6}" y="${yy}" class="la-axis" text-anchor="end" dominant-baseline="middle">${t.label}</text>`);
    }
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(tr.h[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    p.push(`<path d="${d}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`);
    if (ci >= 0 && values[ci] !== null && values[ci] !== undefined) dots.push(`<circle cx="${x(tr.h[ci]).toFixed(1)}" cy="${y(values[ci] as number).toFixed(1)}" r="4" fill="#0b0d10" stroke="${TEXT}" stroke-width="2"/>`);
  };
  if (hasPath) {
    const edge = DOTS + 0.15;
    drawLane(`${a.ilsPath ? 'G/S' : 'PATH'} DEVIATION`, 'dots, above +', tr.gs, -edge, edge, [{ v: DOTS, label: `+${DOTS}` }, { v: 0, label: '0' }, { v: -DOTS, label: `-${DOTS}` }], true);
    // Seen from above with the aircraft flying to the right: left of the centreline is up.
    drawLane('LOC DEVIATION', 'dots, top-down view', tr.loc.map((v) => (v === null ? null : -v)), -edge, edge, [{ v: DOTS, label: `${DOTS} L` }, { v: 0, label: '0' }, { v: -DOTS, label: `${DOTS} R` }], true);
  }
  if (hasPower) {
    const vals = tr.power.filter((v): v is number => v !== null);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-6) hi = lo + 1;
    const st = niceStep(hi - lo, 2);
    lo = Math.floor(lo / st + 1e-9) * st;
    hi = Math.ceil(hi / st - 1e-9) * st;
    const ticks: { v: number; label: string }[] = [];
    for (let v = lo; v <= hi + st * 1e-6; v += st) ticks.push({ v, label: group(v) });
    drawLane(o.powerKind === 'rpm' ? 'RPM' : 'N1', o.powerKind === 'rpm' ? 'engine average' : '%, engine average', tr.power, lo, hi, ticks, false);
  }

  // The height the approach was stable from runs through everything.
  if (a.stableFt !== null) {
    const xx = x(a.stableFt);
    p.push(`<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${top - 10}" y2="${bottom}" stroke="${STABLE_COLOR}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    const anchor = xx < padL + 70 ? 'start' : xx > padL + w - 70 ? 'end' : 'middle';
    p.push(`<text x="${xx.toFixed(1)}" y="${top - 18}" class="la-marker-label" fill="${STABLE_COLOR}" text-anchor="${anchor}">STABLE ${u.fmtHeight(a.stableFt)}${a.stableAtTop ? '+' : ''} ${u.heightUnit}</text>`);
  }
  if (ci >= 0) {
    const xx = x(tr.h[ci]).toFixed(1);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${top - 10}" y2="${bottom}" stroke="${TEXT}" stroke-width="1"/>`);
    p.push(dots.join(''));
  }
  p.push('</svg>');
  return p.join('');
}
