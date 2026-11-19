/**
 * Top-down runway drawings, built as SVG strings like the charts (cheap to redraw in Coherent and
 * testable outside the sim).
 *
 * The runway outline, length and width come from the sim's runway data. The painted markings are
 * not exposed by the sim, so they are drawn at their standard positions (see runwayMarkings).
 */
import type { LandingSummary, LandingTrace } from '../../core/types.ts';
import { group, runwayMarkings, type RunwayMarkings, type Units } from '../../core/units.ts';

const PAINT = '#c9d1d9';
const ACCENT = '#5ab0ff';
const FLARE = '#e3b341';
const SURFACE = '#1a2027';

/** viewBox width, and the x position of the landing threshold inside it. */
const VB_W = 1184;
const THR_X = 80;

interface Scale {
  mk: RunwayMarkings;
  windowM: number;
  tickM: number;
  x: (alongM: number) => number;
  /** Right edge of the pavement inside the view. */
  endX: number;
}

function scale(lengthM: number, u: Units, furthestM: number): Scale {
  const mk = runwayMarkings(lengthM, u.s.dist);
  // Show the first 4,000 ft (1,200 m); widen in whole ticks when the touchdown is beyond that.
  let windowM = mk.windowM;
  let tickM = mk.tickM;
  if (furthestM > windowM * 0.92) {
    const needed = furthestM * 1.15;
    while (needed / tickM > 9) tickM *= 2;
    windowM = Math.ceil(needed / tickM) * tickM;
  }
  const x = (m: number) => THR_X + (m / windowM) * (VB_W - THR_X);
  return { mk, windowM, tickM, x, endX: Math.min(VB_W, x(lengthM)) };
}

const n = (v: number) => v.toFixed(1);

/** Pavement, edges, threshold, centreline and standard markings between y0 and y1. */
function pavement(sc: Scale, y0: number, y1: number, displacedM: number, detail: boolean): string {
  const h = y1 - y0;
  const mid = (y0 + y1) / 2;
  const p: string[] = [];
  const startX = Math.max(0, sc.x(-displacedM));
  p.push(`<rect x="${n(startX)}" y="${y0}" width="${n(sc.endX - startX)}" height="${h}" fill="${SURFACE}"/>`);
  if (detail) {
    p.push(`<line x1="${n(startX)}" y1="${y0}" x2="${n(sc.endX)}" y2="${y0}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
    p.push(`<line x1="${n(startX)}" y1="${y1}" x2="${n(sc.endX)}" y2="${y1}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
  }
  p.push(`<line x1="${THR_X}" y1="${y0}" x2="${THR_X}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);
  if (sc.endX < VB_W) p.push(`<line x1="${n(sc.endX)}" y1="${y0}" x2="${n(sc.endX)}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);

  const clStart = detail ? THR_X + 110 : THR_X;
  p.push(`<line x1="${clStart}" y1="${mid}" x2="${n(sc.endX)}" y2="${mid}" stroke="${PAINT}" stroke-width="${detail ? 2 : 1.5}" stroke-dasharray="27 18" opacity="${detail ? 0.55 : 0.4}"/>`);

  p.push(`<g fill="${PAINT}" opacity="${detail ? 0.8 : 0.55}">`);
  if (detail) {
    // Threshold stripes: four on each side of the centreline.
    const sw = h / 15;
    for (let i = 0; i < 4; i++) {
      p.push(`<rect x="${THR_X + 6}" y="${n(y0 + sw * 0.75 + i * sw * 1.6)}" width="27" height="${n(sw)}"/>`);
      p.push(`<rect x="${THR_X + 6}" y="${n(y1 - sw * 1.75 - i * sw * 1.6)}" width="27" height="${n(sw)}"/>`);
    }
  }
  // Aiming point: one solid block each side.
  if (sc.x(sc.mk.aimingM) < sc.endX) {
    const ax = sc.x(sc.mk.aimingM);
    const aw = sc.x(sc.mk.aimingLengthM) - THR_X;
    const ah = h / 6;
    p.push(`<rect x="${n(ax)}" y="${n(y0 + h * 0.13)}" width="${n(aw)}" height="${n(ah)}"/>`);
    p.push(`<rect x="${n(ax)}" y="${n(y1 - h * 0.13 - ah)}" width="${n(aw)}" height="${n(ah)}"/>`);
  }
  // Touchdown zone bars: three, two or one each side.
  const bw = sc.x(sc.mk.barLengthM) - THR_X;
  const bh = h / 24;
  for (const b of sc.mk.bars) {
    const bx = sc.x(b.atM);
    if (bx >= sc.endX) continue;
    for (let i = 0; i < (detail ? b.count : 1); i++) {
      const off = h * 0.3 - i * bh * 1.8;
      p.push(`<rect x="${n(bx)}" y="${n(mid - off - bh)}" width="${n(bw)}" height="${n(bh)}"/>`);
      p.push(`<rect x="${n(bx)}" y="${n(mid + off)}" width="${n(bw)}" height="${n(bh)}"/>`);
    }
  }
  p.push('</g>');
  return p.join('');
}

/** Distance scale under the runway. */
function ticks(sc: Scale, u: Units, yTick: number | null, yText: number): string {
  const p: string[] = [];
  for (let m = 0; m <= sc.windowM + 1; m += sc.tickM) {
    const xx = sc.x(m);
    if (yTick !== null) p.push(`<line x1="${n(xx)}" y1="${yTick}" x2="${n(xx)}" y2="${yTick + 8}" stroke="#2a323c" stroke-width="1"/>`);
    const last = m + sc.tickM > sc.windowM + 1;
    const label = m === 0 ? 'THR' : `${Math.round(u.dist(m))}${last ? ' ' + u.distUnit : ''}`;
    p.push(`<text x="${n(last ? VB_W - 6 : xx)}" y="${yText}" class="la-rw-label" text-anchor="${last ? 'end' : 'middle'}">${label}</text>`);
  }
  return p.join('');
}

export interface RunwayView {
  svg: string;
  /** Line above the drawing: how much runway is shown and the lateral exaggeration. */
  caption: string;
  /** Line below: touchdown point relative to the aiming point marking. */
  note: string;
}

/** The Touchdown page's runway view: markings, ground track, flare start and touchdown point. */
export function runwayView(s: LandingSummary, tr: LandingTrace | null, u: Units, pxWidth: number): RunwayView | null {
  const g = s.geometry;
  if (!g) return null;
  const rw = g.runway;
  const sc = scale(rw.lengthM, u, g.distFromThresholdM);
  const VB_H = 232;
  const y0 = 60;
  const y1 = 180;
  const mid = 120;
  const pxPerM = (y1 - y0) / rw.widthM;
  const clampY = (v: number) => Math.max(40, Math.min(200, v));
  const y = (crossM: number) => clampY(mid + crossM * pxPerM);

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${Math.round(pxWidth)}" height="${Math.round((pxWidth * VB_H) / VB_W)}" class="la-rw">`);
  p.push(pavement(sc, y0, y1, rw.displacedM ?? 0, true));
  p.push(`<text x="${THR_X + 78}" y="${mid}" fill="${PAINT}" opacity="0.8" class="la-rw-num" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${THR_X + 78} ${mid})">${rw.designation}</text>`);

  // Ground track from the recorded samples: dashed on the approach, solid on the rollout.
  let flareX: number | null = null;
  if (tr && tr.along) {
    let app = '';
    let roll = '';
    for (let i = 0; i < tr.t.length; i++) {
      const a = tr.along[i];
      const c = tr.centerline[i];
      if (a === null || a === undefined || c === null) continue;
      const xx = sc.x(a);
      if (xx < 0 || xx > VB_W) continue;
      const pt = `${n(xx)},${n(y(c))} `;
      if (tr.t[i] <= 0) app += pt;
      if (tr.t[i] >= 0) roll += pt;
    }
    if (app) p.push(`<polyline points="${app.trim()}" fill="none" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 5"/>`);
    if (roll) p.push(`<polyline points="${roll.trim()}" fill="none" stroke="${ACCENT}" stroke-width="2" opacity="0.55"/>`);
    if (s.flare.flareDurationS !== null) {
      const i = tr.t.findIndex((t) => t >= -s.flare.flareDurationS!);
      const a = i >= 0 ? tr.along[i] : null;
      if (a !== null && a !== undefined && sc.x(a) >= 0) flareX = sc.x(a);
    }
  }

  const tdX = Math.min(VB_W - 8, Math.max(8, sc.x(g.distFromThresholdM)));
  const tdY = y(g.centerlineOffsetM);
  const labelX = (x: number, halfWidth: number) => Math.max(halfWidth, Math.min(VB_W - halfWidth, x));
  const side = (m: number) => (Math.abs(u.dist(m)) < 0.5 ? '' : m >= 0 ? ' R' : ' L');
  const tdText = `TOUCHDOWN ${group(u.dist(g.distFromThresholdM))} ${u.distUnit} · ${group(Math.abs(u.dist(g.centerlineOffsetM)))} ${u.distUnit}${side(g.centerlineOffsetM)}`;

  // Call-outs sit on two rows so the flare and touchdown labels never collide.
  if (flareX !== null && s.flare.flareHeightFt !== null) {
    p.push(`<line x1="${n(flareX)}" y1="52" x2="${n(flareX)}" y2="188" stroke="${FLARE}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    p.push(`<text x="${n(labelX(flareX, 70))}" y="46" class="la-rw-call" fill="${FLARE}" text-anchor="middle">FLARE ${u.fmtHeight(s.flare.flareHeightFt)} ${u.heightUnit}</text>`);
  }
  p.push(`<line x1="${n(tdX)}" y1="30" x2="${n(tdX)}" y2="${n(tdY - 6.5)}" stroke="${ACCENT}" stroke-width="1.5"/>`);
  p.push(`<circle cx="${n(tdX)}" cy="${n(tdY)}" r="6.5" fill="#0b0d10" stroke="${ACCENT}" stroke-width="2.5"/>`);
  p.push(`<circle cx="${n(tdX)}" cy="${n(tdY)}" r="2" fill="${ACCENT}"/>`);
  p.push(`<text x="${n(labelX(tdX, 150))}" y="22" class="la-rw-call" fill="${ACCENT}" text-anchor="middle">${tdText}</text>`);

  p.push(ticks(sc, u, 190, 214));
  p.push('</svg>');

  const shown = Math.min(sc.windowM, rw.lengthM);
  const exaggeration = pxPerM / ((VB_W - THR_X) / sc.windowM);
  const caption =
    (shown < rw.lengthM ? `First ${group(u.dist(shown))} ${u.distUnit} of ${group(u.dist(rw.lengthM))} ${u.distUnit}` : `Length ${group(u.dist(rw.lengthM))} ${u.distUnit}`) +
    ` · width ${group(u.dist(rw.widthM))} ${u.distUnit} · lateral scale x${exaggeration >= 10 ? exaggeration.toFixed(0) : exaggeration.toFixed(1)}`;

  const dAim = g.distFromThresholdM - sc.mk.aimingM;
  const note =
    g.distFromThresholdM < 0
      ? `${group(u.dist(-g.distFromThresholdM))} ${u.distUnit} before the threshold`
      : `${group(Math.abs(u.dist(dAim)))} ${u.distUnit} ${dAim >= 0 ? 'past' : 'before'} the aiming point (${group(u.dist(sc.mk.aimingM))} ${u.distUnit})`;
  return { svg: p.join(''), caption, note };
}

/**
 * The Log page's dispersion strip: touchdown points of many landings overlaid on one runway
 * outline. Runways differ in length and width, so the outline is nominal: positions are plotted
 * by distance from the threshold and by centreline offset as a fraction of that runway's width.
 */
export function dispersionStrip(landings: readonly LandingSummary[], u: Units, pxWidth: number): string {
  const pts = landings.filter((s) => s.geometry);
  if (pts.length === 0) return '';
  const sc = scale(1e6, u, 0);
  const VB_H = 96;
  const y0 = 14;
  const y1 = 66;
  const mid = 40;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${Math.round(pxWidth)}" height="${Math.round((pxWidth * VB_H) / VB_W)}" class="la-rw">`);
  p.push(pavement(sc, y0, y1, 0, false));
  const pos = (s: LandingSummary) => {
    const g = s.geometry!;
    const frac = Math.max(-0.5, Math.min(0.5, g.centerlineOffsetM / g.runway.widthM));
    return { x: Math.max(6, Math.min(VB_W - 6, sc.x(g.distFromThresholdM))), y: mid + frac * (y1 - y0) };
  };
  p.push(`<g fill="${ACCENT}" fill-opacity="0.35" stroke="${ACCENT}" stroke-width="1.5">`);
  for (const s of pts.slice(1)) {
    const q = pos(s);
    p.push(`<circle cx="${n(q.x)}" cy="${n(q.y)}" r="5"/>`);
  }
  p.push('</g>');
  const q = pos(pts[0]);
  p.push(`<circle cx="${n(q.x)}" cy="${n(q.y)}" r="6" fill="#0b0d10" stroke="#e8ecf0" stroke-width="2.5"/>`);
  p.push(ticks(sc, u, null, 86));
  p.push(`<text x="0" y="${mid + 4}" class="la-rw-label">Latest</text>`);
  p.push(`<circle cx="52" cy="${mid}" r="4.5" fill="#0b0d10" stroke="#e8ecf0" stroke-width="2"/>`);
  p.push('</svg>');
  return p.join('');
}
