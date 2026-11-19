/**
 * Top-down runway drawings, built as SVG strings like the charts (cheap to redraw in Coherent and
 * testable outside the sim).
 *
 * The runway outline, length and width come from the sim's runway data. The painted markings are
 * not exposed by the sim, so they are drawn at their standard positions (see runwayMarkings).
 */
import { thresholdCrossing } from '../../core/gates.ts';
import type { LandingSummary, LandingTrace } from '../../core/types.ts';
import { group, runwayMarkings, type MarkingInput, type RunwayMarkings, type Units } from '../../core/units.ts';

const PAINT = '#c9d1d9';
const ACCENT = '#5ab0ff';
const FLARE = '#e3b341';
/** Threshold crossing: the same colour as its marker on the Landing page's chart. */
export const THRESHOLD = '#c297ff';
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

function scale(lengthM: number, u: Units, furthestM: number, rw: MarkingInput = {}): Scale {
  const mk = runwayMarkings(lengthM, u.s.dist, rw);
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

/** Threshold stripes: `perSide` on each side of the centreline, filling the width between y0 and y1. */
function thresholdStripes(y0: number, y1: number, perSide: number): string {
  if (perSide <= 0) return '';
  const h = y1 - y0;
  const sw = (h * 0.42) / (1.6 * perSide - 0.6);
  const p: string[] = [];
  for (let i = 0; i < perSide; i++) {
    p.push(`<rect x="${THR_X + 6}" y="${n(y0 + h * 0.04 + i * sw * 1.6)}" width="27" height="${n(sw)}"/>`);
    p.push(`<rect x="${THR_X + 6}" y="${n(y1 - h * 0.04 - sw - i * sw * 1.6)}" width="27" height="${n(sw)}"/>`);
  }
  return p.join('');
}

/** Pavement, edges, threshold, centreline and standard markings between y0 and y1. */
function pavement(sc: Scale, y0: number, y1: number, displacedM: number, detail: boolean, u?: Units): string {
  const h = y1 - y0;
  const mid = (y0 + y1) / 2;
  const p: string[] = [];
  const startX = Math.max(0, sc.x(-displacedM));
  p.push(`<rect x="${n(startX)}" y="${y0}" width="${n(sc.endX - startX)}" height="${h}" fill="${SURFACE}"/>`);
  // The touchdown zone as a lighter band, with its length where it ends.
  if (detail && u && sc.mk.tdzM !== null) {
    const zx = Math.min(sc.endX, sc.x(sc.mk.tdzM));
    p.push(`<rect x="${THR_X}" y="${y0}" width="${n(zx - THR_X)}" height="${h}" fill="${PAINT}" opacity="0.06"/>`);
    if (sc.x(sc.mk.tdzM) <= VB_W) {
      p.push(`<line x1="${n(zx)}" y1="${y0}" x2="${n(zx)}" y2="${y1}" stroke="${PAINT}" stroke-width="1" stroke-dasharray="2 4" opacity="0.5"/>`);
      p.push(`<text x="${n(zx - 8)}" y="${y1 - 7}" class="la-rw-label" text-anchor="end">TDZ ${group(u.dist(sc.mk.tdzM))} ${u.distUnit}</text>`);
    }
  }
  if (detail) {
    p.push(`<line x1="${n(startX)}" y1="${y0}" x2="${n(sc.endX)}" y2="${y0}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
    p.push(`<line x1="${n(startX)}" y1="${y1}" x2="${n(sc.endX)}" y2="${y1}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
  }
  p.push(`<line x1="${THR_X}" y1="${y0}" x2="${THR_X}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);
  if (sc.endX < VB_W) p.push(`<line x1="${n(sc.endX)}" y1="${y0}" x2="${n(sc.endX)}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);

  const clStart = detail ? THR_X + 110 : THR_X;
  if (sc.mk.painted !== 'none') p.push(`<line x1="${clStart}" y1="${mid}" x2="${n(sc.endX)}" y2="${mid}" stroke="${PAINT}" stroke-width="${detail ? 2 : 1.5}" stroke-dasharray="27 18" opacity="${detail ? 0.55 : 0.4}"/>`);

  p.push(`<g fill="${PAINT}" opacity="${detail ? 0.8 : 0.55}">`);
  if (detail) p.push(thresholdStripes(y0, y1, sc.mk.thresholdStripes));
  // Aiming point: one solid block each side.
  if (sc.mk.aimingM !== null && sc.x(sc.mk.aimingM) < sc.endX) {
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
  /** How the markings and the touchdown zone were worked out. Empty for the rollout view. */
  method?: string;
}

/** The Touchdown page's runway view: markings, ground track, flare start and touchdown point. */
export function runwayView(s: LandingSummary, tr: LandingTrace | null, u: Units, pxWidth: number): RunwayView | null {
  const g = s.geometry;
  if (!g) return null;
  const rw = g.runway;
  const sc = scale(rw.lengthM, u, g.distFromThresholdM, rw);
  const VB_H = 232;
  const y0 = 60;
  const y1 = 180;
  const mid = 120;
  const pxPerM = (y1 - y0) / rw.widthM;
  const clampY = (v: number) => Math.max(40, Math.min(200, v));
  const y = (crossM: number) => clampY(mid + crossM * pxPerM);

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${Math.round(pxWidth)}" height="${Math.round((pxWidth * VB_H) / VB_W)}" class="la-rw">`);
  p.push(pavement(sc, y0, y1, rw.displacedM ?? 0, true, u));
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

  // Height over the threshold, at the left of the lower call-out row, above the threshold line.
  const thr = tr ? thresholdCrossing(tr) : null;
  const THR_LABEL_END = 190;
  if (thr) {
    p.push(`<line x1="${THR_X}" y1="50" x2="${THR_X}" y2="${y0}" stroke="${THRESHOLD}" stroke-width="1.5"/>`);
    p.push(`<text x="2" y="46" class="la-rw-call" fill="${THRESHOLD}">THRESHOLD ${u.fmtHeight(thr.agl)} ${u.heightUnit} RA</text>`);
  }

  // Call-outs sit on two rows so the flare and touchdown labels never collide; a flare that
  // starts near the threshold has its label moved clear of the threshold one.
  if (flareX !== null && s.flare.flareHeightFt !== null) {
    p.push(`<line x1="${n(flareX)}" y1="52" x2="${n(flareX)}" y2="188" stroke="${FLARE}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    p.push(`<text x="${n(Math.max(thr ? THR_LABEL_END + 70 : 0, labelX(flareX, 70)))}" y="46" class="la-rw-call" fill="${FLARE}" text-anchor="middle">FLARE ${u.fmtHeight(s.flare.flareHeightFt)} ${u.heightUnit}</text>`);
  }
  p.push(`<line x1="${n(tdX)}" y1="30" x2="${n(tdX)}" y2="${n(tdY - 6.5)}" stroke="${ACCENT}" stroke-width="1.5"/>`);
  p.push(`<circle cx="${n(tdX)}" cy="${n(tdY)}" r="6.5" fill="#0b0d10" stroke="${ACCENT}" stroke-width="2.5"/>`);
  p.push(`<circle cx="${n(tdX)}" cy="${n(tdY)}" r="2" fill="${ACCENT}"/>`);
  p.push(`<text x="${n(labelX(tdX, 150))}" y="22" class="la-rw-call" fill="${ACCENT}" text-anchor="middle">${tdText}</text>`);

  p.push(ticks(sc, u, 190, 214));
  p.push('</svg>');

  const shown = Math.min(sc.windowM, rw.lengthM);
  const exaggeration = pxPerM / ((VB_W - THR_X) / sc.windowM);
  let caption =
    (shown < rw.lengthM ? `First ${group(u.dist(shown))} ${u.distUnit} of ${group(u.dist(rw.lengthM))} ${u.distUnit}` : `Length ${group(u.dist(rw.lengthM))} ${u.distUnit}`) +
    ` · width ${group(u.dist(rw.widthM))} ${u.distUnit} · lateral scale x${exaggeration >= 10 ? exaggeration.toFixed(0) : exaggeration.toFixed(1)}`;

  const paint = { precision: 'markings', aiming: 'markings, aiming point only', basic: 'markings, threshold and centreline only', none: '' }[sc.mk.painted];
  caption += sc.mk.painted === 'none' ? ' · unpaved, no markings' : ` · standard ${sc.mk.standard} ${paint}`;

  const aimM = sc.mk.aimingM;
  const dAim = g.distFromThresholdM - (aimM ?? 0);
  const note =
    g.distFromThresholdM < 0
      ? `${group(u.dist(-g.distFromThresholdM))} ${u.distUnit} before the threshold`
      : aimM === null
      ? `${group(u.dist(g.distFromThresholdM))} ${u.distUnit} past the threshold`
      : `${group(Math.abs(u.dist(dAim)))} ${u.distUnit} ${dAim >= 0 ? 'past' : 'before'} the aiming point (${group(u.dist(aimM))} ${u.distUnit})`;
  // How the paint was worked out, since none of it is read from the simulator.
  const mk = sc.mk;
  const len = `${group(u.dist(rw.lengthM))} ${u.distUnit}`;
  const rules = mk.standard === 'FAA' ? 'FAA rules (AC 150/5340-1), used at US airports' : 'ICAO Annex 14 rules, used outside the US';
  const known = rw.hard === undefined ? ' Surface and ILS were not recorded for this landing, so a paved runway with an ILS is assumed.' : '';
  let method: string;
  if (mk.painted === 'none') {
    method = 'The simulator does not provide runway markings. This runway is unpaved, so none are drawn.';
  } else {
    const parts: string[] = [];
    if (mk.aimingM !== null) parts.push(`aiming point at ${group(u.dist(mk.aimingM))} ${u.distUnit}`);
    if (mk.bars.length) parts.push(`${mk.bars.length} pair${mk.bars.length === 1 ? '' : 's'} of touchdown zone bars`);
    if (mk.tdzM !== null) parts.push(`touchdown zone (TDZ) to ${group(u.dist(mk.tdzM))} ${u.distUnit}`);
    const why = mk.painted === 'precision' ? 'with an ILS' : mk.painted === 'aiming' ? 'without an ILS, so no touchdown zone is marked' : 'short and without an ILS, so only the threshold and centreline are marked';
    method =
      `Markings and touchdown zone are standard, not read from the simulator, which does not provide them. Drawn from ${rules}, for a ${len} paved runway ${why}` +
      (parts.length ? `: ${parts.join(', ')}.` : '.') +
      ` Positions are measured from the landing threshold; the scenery's own paint may differ.${known}`;
  }
  return { svg: p.join(''), caption, note, method };
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

/**
 * The Landing page's rollout view: the ground track after touchdown drawn on a plain top-down
 * runway, to show how far the aircraft was from the centreline and where. The runway runs left
 * to right in the landing direction, so the top of the drawing is the left of the centreline
 * and the bottom is the right. Only the threshold stripes and the centreline are painted; the
 * edges are the real runway width, so a deviation reads against the pavement it happened on.
 */
export function rolloutView(s: LandingSummary, tr: LandingTrace, u: Units, pxWidth: number): RunwayView | null {
  const g = s.geometry;
  if (!g || !tr.along) return null;
  const rw = g.runway;
  // Samples from touchdown on, with a position.
  const pts: { t: number; along: number; cross: number }[] = [];
  for (let i = 0; i < tr.t.length; i++) {
    const a = tr.along[i];
    const c = tr.centerline[i];
    if (tr.t[i] >= 0 && a !== null && a !== undefined && c !== null) pts.push({ t: tr.t[i], along: a, cross: c });
  }
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];

  // Scale: from the threshold to a little past the end of the recorded rollout, in whole ticks.
  let tickM = u.s.dist === 'ft' ? 500 / 3.280839895 : 150;
  const needed = Math.max(last.along * 1.04, tickM * 2);
  while (needed / tickM > 10) tickM *= 2;
  const windowM = Math.ceil(needed / tickM) * tickM;
  const VB_H = 196;
  const y0 = 44;
  const y1 = 144;
  const mid = (y0 + y1) / 2;
  const x = (m: number) => THR_X + (m / windowM) * (VB_W - THR_X);
  const pxPerM = (y1 - y0) / rw.widthM;
  // A track that leaves the pavement is drawn just outside the edge rather than off the drawing.
  const y = (crossM: number) => Math.max(y0 - 14, Math.min(y1 + 14, mid + crossM * pxPerM));
  const endX = Math.min(VB_W, x(rw.lengthM));

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${Math.round(pxWidth)}" height="${Math.round((pxWidth * VB_H) / VB_W)}" class="la-rw">`);
  p.push(`<rect x="${THR_X}" y="${y0}" width="${n(endX - THR_X)}" height="${y1 - y0}" fill="${SURFACE}"/>`);
  p.push(`<line x1="${THR_X}" y1="${y0}" x2="${n(endX)}" y2="${y0}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
  p.push(`<line x1="${THR_X}" y1="${y1}" x2="${n(endX)}" y2="${y1}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
  p.push(`<line x1="${THR_X}" y1="${y0}" x2="${THR_X}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);
  if (endX < VB_W) p.push(`<line x1="${n(endX)}" y1="${y0}" x2="${n(endX)}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);
  // Threshold stripes, so the drawing reads as a runway seen from above.
  const stripes = runwayMarkings(rw.lengthM, u.s.dist, rw).thresholdStripes;
  p.push(`<g fill="${PAINT}" opacity="0.8">`);
  p.push(thresholdStripes(y0, y1, stripes));
  p.push('</g>');
  p.push(`<line x1="${THR_X + 44}" y1="${mid}" x2="${n(endX)}" y2="${mid}" stroke="${PAINT}" stroke-width="2" stroke-dasharray="27 18" opacity="0.55"/>`);
  p.push(`<text x="${THR_X - 12}" y="${y0 + 16}" class="la-rw-side" text-anchor="end">LEFT</text>`);
  p.push(`<text x="${THR_X - 12}" y="${y1 - 8}" class="la-rw-side" text-anchor="end">RIGHT</text>`);

  // The track, then where it was furthest from the centreline.
  p.push(`<polyline points="${pts.map((q) => `${n(x(q.along))},${n(y(q.cross))}`).join(' ')}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round"/>`);
  let far = first;
  for (const q of pts) if (Math.abs(q.cross) > Math.abs(far.cross)) far = q;
  const side = (m: number) => (Math.abs(u.dist(m)) < 0.5 ? '' : m >= 0 ? ' R' : ' L');
  const off = (m: number) => `${group(Math.abs(u.dist(m)))} ${u.distUnit}${side(m)}`;
  const labelX = (xx: number, half: number) => Math.max(THR_X + half, Math.min(VB_W - half, xx));

  const tdX = x(first.along);
  p.push(`<line x1="${n(tdX)}" y1="${y0 - 18}" x2="${n(tdX)}" y2="${n(y(first.cross) - 6.5)}" stroke="${ACCENT}" stroke-width="1.5"/>`);
  p.push(`<circle cx="${n(tdX)}" cy="${n(y(first.cross))}" r="6.5" fill="#0b0d10" stroke="${ACCENT}" stroke-width="2.5"/>`);
  p.push(`<text x="${n(labelX(tdX, 90))}" y="${y0 - 24}" class="la-rw-call" fill="${ACCENT}" text-anchor="middle">TOUCHDOWN ${off(first.cross)}</text>`);

  const endPx = x(last.along);
  p.push(`<circle cx="${n(endPx)}" cy="${n(y(last.cross))}" r="4" fill="${ACCENT}"/>`);
  // Call out the largest deviation only when it is a different place from the touchdown itself.
  if (far !== first && Math.abs(x(far.along) - tdX) > 190 && Math.abs(u.dist(far.cross)) >= 0.5) {
    const fx = x(far.along);
    const below = far.cross >= 0;
    p.push(`<line x1="${n(fx)}" y1="${n(y(far.cross))}" x2="${n(fx)}" y2="${below ? y1 + 12 : y0 - 18}" stroke="${PAINT}" stroke-width="1" opacity="0.7"/>`);
    p.push(`<text x="${n(labelX(fx, 80))}" y="${below ? y1 + 24 : y0 - 24}" class="la-rw-call" fill="${PAINT}" text-anchor="middle">FURTHEST ${off(far.cross)}</text>`);
  }

  // Distance scale from the threshold.
  for (let m = 0; m <= windowM + 1; m += tickM) {
    const xx = x(m);
    const lastTick = m + tickM > windowM + 1;
    p.push(`<line x1="${n(xx)}" y1="${VB_H - 34}" x2="${n(xx)}" y2="${VB_H - 26}" stroke="#2a323c" stroke-width="1"/>`);
    p.push(`<text x="${n(lastTick ? VB_W - 6 : xx)}" y="${VB_H - 10}" class="la-rw-label" text-anchor="${lastTick ? 'end' : 'middle'}">${m === 0 ? 'THR' : `${Math.round(u.dist(m))}${lastTick ? ' ' + u.distUnit : ''}`}</text>`);
  }
  p.push('</svg>');

  const exaggeration = pxPerM / ((VB_W - THR_X) / windowM);
  return {
    svg: p.join(''),
    caption: `Runway width ${group(u.dist(rw.widthM))} ${u.distUnit} · lateral scale x${exaggeration >= 10 ? exaggeration.toFixed(0) : exaggeration.toFixed(1)}`,
    note: `Furthest from the centreline ${off(far.cross)}, at ${group(u.dist(far.along))} ${u.distUnit} from the threshold · recorded for ${last.t.toFixed(0)} s after touchdown, ending ${off(last.cross)}`,
  };
}
