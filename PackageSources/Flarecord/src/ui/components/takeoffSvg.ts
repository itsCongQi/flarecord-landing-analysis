/**
 * The Departure page's drawings, built as SVG strings like the other charts: the takeoff roll
 * over the whole runway seen from above, and the climb by height above the liftoff point.
 */
import type { ClimbSummary, ClimbTrace, PowerKind, TakeoffSummary, TakeoffTrace } from '../../core/types.ts';
import { group, type Units } from '../../core/units.ts';
import { niceStep } from './chartSvg.ts';

const PAINT = '#c9d1d9';
const ACCENT = '#5ab0ff';
const ROTATION = '#e3b341';
const SURFACE = '#1a2027';
const TEXT = '#e8ecf0';
const SOFT = '#b8c0cc';
const n = (v: number) => v.toFixed(1);

const VB_W = 1184;
const X0 = 60;
const X1 = 1164;

export interface TakeoffRunwayView {
  svg: string;
  caption: string;
  note: string;
}

/**
 * The whole pavement from its start (left) to its far end, with the ground track of the roll,
 * where the rotation began and where the wheels left the ground. Left of the centreline is up.
 * Null without a runway or a track.
 */
export function takeoffRunwayView(s: TakeoffSummary, tr: TakeoffTrace | null, u: Units, pxWidth: number): TakeoffRunwayView | null {
  const rw = s.runway;
  if (!rw || !tr) return null;
  const pts: { t: number; along: number; cross: number }[] = [];
  for (let i = 0; i < tr.t.length; i++) {
    const a = tr.along[i];
    const c = tr.centerline[i];
    if (a !== null && c !== null) pts.push({ t: tr.t[i], along: a, cross: c });
  }
  if (pts.length < 2) return null;
  const rejected = s.kind === 'rejected';
  const lengthM = rw.lengthM + (rw.displacedM ?? 0);
  const VB_H = 200;
  const y0 = 52;
  const y1 = 152;
  const mid = (y0 + y1) / 2;
  const x = (m: number) => X0 + (Math.max(0, Math.min(lengthM, m)) / lengthM) * (X1 - X0);
  const pxPerM = (y1 - y0) / rw.widthM;
  // A track that leaves the pavement is drawn just outside the edge rather than off the drawing.
  const y = (crossM: number) => Math.max(y0 - 14, Math.min(y1 + 14, mid + crossM * pxPerM));
  const side = (m: number) => (Math.abs(u.dist(m)) < 0.5 ? '' : m >= 0 ? ' R' : ' L');
  const off = (m: number) => (Math.abs(u.dist(m)) < 0.5 ? 'on the centreline' : `${group(Math.abs(u.dist(m)))} ${u.distUnit}${side(m)}`);

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" width="${Math.round(pxWidth)}" height="${Math.round((pxWidth * VB_H) / VB_W)}" class="la-rw">`);
  p.push(`<rect x="${X0}" y="${y0}" width="${X1 - X0}" height="${y1 - y0}" fill="${SURFACE}"/>`);
  for (const yy of [y0, y1]) p.push(`<line x1="${X0}" y1="${yy}" x2="${X1}" y2="${yy}" stroke="${PAINT}" stroke-width="1.5" opacity="0.7"/>`);
  for (const xx of [X0, X1]) p.push(`<line x1="${xx}" y1="${y0}" x2="${xx}" y2="${y1}" stroke="${PAINT}" stroke-width="3" opacity="0.85"/>`);
  // Threshold stripes at both ends, so the drawing reads as a runway seen from above.
  p.push(`<g fill="${PAINT}" opacity="0.8">`);
  const sw = 4.2;
  for (let i = 0; i < 4; i++) {
    for (const xx of [X0 + 6, X1 - 30]) {
      p.push(`<rect x="${xx}" y="${n(y0 + 5 + i * sw * 2.4)}" width="24" height="${sw}"/>`);
      p.push(`<rect x="${xx}" y="${n(y1 - 5 - sw - i * sw * 2.4)}" width="24" height="${sw}"/>`);
    }
  }
  p.push('</g>');
  p.push(`<line x1="${X0 + 42}" y1="${mid}" x2="${X1 - 42}" y2="${mid}" stroke="${PAINT}" stroke-width="2" stroke-dasharray="27 18" opacity="0.55"/>`);
  p.push(`<text x="${X0 - 10}" y="${y0 + 14}" class="la-rw-side" text-anchor="end">LEFT</text>`);
  p.push(`<text x="${X0 - 10}" y="${y1 - 6}" class="la-rw-side" text-anchor="end">RIGHT</text>`);

  // On the ground a solid line; in the air a dashed one, as far as the end of the pavement.
  const line = (qs: typeof pts) => qs.map((q) => `${n(x(q.along))},${n(y(q.cross))}`).join(' ');
  const ground = rejected ? pts : pts.filter((q) => q.t <= 0);
  const air = rejected ? [] : pts.filter((q) => q.t >= 0 && q.along <= lengthM);
  if (ground.length > 1) p.push(`<polyline points="${line(ground)}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round"/>`);
  if (air.length > 1) p.push(`<polyline points="${line(air)}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="7 6" stroke-linejoin="round" opacity="0.85"/>`);

  const first = pts[0];
  p.push(`<circle cx="${n(x(first.along))}" cy="${n(y(first.cross))}" r="4.5" fill="${SOFT}"/>`);

  // The reference moment: liftoff, or the highest speed of a rejected takeoff.
  let ref = pts[0];
  for (const q of pts) if (Math.abs(q.t) < Math.abs(ref.t)) ref = q;
  const rx = x(ref.along);
  const call = rejected ? `HIGHEST SPEED ${u.fmtSpeed(s.maxGsKt ?? s.liftoffGsKt)} ${u.speedUnit}` : `LIFTOFF ${u.fmtDist(ref.along)} ${u.distUnit} · ${off(ref.cross)}`;
  const callW = call.length * 7.4;
  const startAnchor = rx + callW < VB_W - 4;
  p.push(`<line x1="${n(rx)}" y1="${y0 - 34}" x2="${n(rx)}" y2="${n(y(ref.cross) - 6.5)}" stroke="${ACCENT}" stroke-width="1.5"/>`);
  p.push(`<circle cx="${n(rx)}" cy="${n(y(ref.cross))}" r="6.5" fill="#0b0d10" stroke="${ACCENT}" stroke-width="2.5"/>`);
  p.push(`<text x="${n(rx + (startAnchor ? 7 : -7))}" y="${y0 - 26}" class="la-rw-call" fill="${ACCENT}" text-anchor="${startAnchor ? 'start' : 'end'}">${call}</text>`);

  if (s.rotToLiftoffS !== null && s.rotIasKt !== null) {
    let rot = pts[0];
    for (const q of pts) if (Math.abs(q.t + s.rotToLiftoffS) < Math.abs(rot.t + s.rotToLiftoffS)) rot = q;
    const xx = x(rot.along);
    p.push(`<line x1="${n(xx)}" y1="${y0 - 16}" x2="${n(xx)}" y2="${y1}" stroke="${ROTATION}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    const label = `ROTATION ${u.fmtSpeed(s.rotIasKt)} ${u.speedUnit}`;
    const end = xx - label.length * 7.4 > 4;
    p.push(`<text x="${n(xx + (end ? -7 : 7))}" y="${y0 - 8}" class="la-rw-call" fill="${ROTATION}" text-anchor="${end ? 'end' : 'start'}">${label}</text>`);
  }
  if (rejected) {
    const last = pts[pts.length - 1];
    p.push(`<circle cx="${n(x(last.along))}" cy="${n(y(last.cross))}" r="4" fill="${ACCENT}"/>`);
  }

  // Where the roll was furthest from the centreline, when that is a place of its own.
  if (s.clMaxM !== null && s.clMaxStartM !== null && Math.abs(u.dist(s.clMaxM)) >= 0.5 && Math.abs(x(s.clMaxStartM) - rx) > 150) {
    const fx = x(s.clMaxStartM);
    p.push(`<line x1="${n(fx)}" y1="${n(y(s.clMaxM))}" x2="${n(fx)}" y2="${y1 + 10}" stroke="${PAINT}" stroke-width="1" opacity="0.7"/>`);
    p.push(`<text x="${n(Math.max(X0 + 70, Math.min(X1 - 70, fx)))}" y="${y1 + 22}" class="la-rw-call" fill="${PAINT}" text-anchor="middle">FURTHEST ${off(s.clMaxM).toUpperCase().replace(u.distUnit.toUpperCase(), u.distUnit)}</text>`);
  }

  // Distance scale from the start of the pavement.
  let tickM = u.s.dist === 'ft' ? 1000 / 3.280839895 : 250;
  while (lengthM / tickM > 9) tickM *= 2;
  for (let m = 0; m < lengthM - tickM * 0.45; m += tickM) {
    const xx = x(m);
    p.push(`<line x1="${n(xx)}" y1="${VB_H - 18}" x2="${n(xx)}" y2="${VB_H - 12}" stroke="#2a323c" stroke-width="1"/>`);
    p.push(`<text x="${n(xx)}" y="${VB_H - 1}" class="la-rw-label" text-anchor="middle">${m === 0 ? 'START' : group(u.dist(m))}</text>`);
  }
  p.push(`<line x1="${X1}" y1="${VB_H - 18}" x2="${X1}" y2="${VB_H - 12}" stroke="#2a323c" stroke-width="1"/>`);
  p.push(`<text x="${X1 + 14}" y="${VB_H - 1}" class="la-rw-label" text-anchor="end">END ${u.fmtDist(lengthM)} ${u.distUnit}</text>`);
  p.push('</svg>');

  const scale = pxPerM / ((X1 - X0) / lengthM);
  const caption = `Runway ${u.fmtDist(lengthM)} ${u.distUnit} · width ${u.fmtDist(rw.widthM)} ${u.distUnit} · lateral scale x${scale >= 10 ? scale.toFixed(0) : scale.toFixed(1)}${s.startM !== null ? ` · roll began ${u.fmtDist(s.startM)} ${u.distUnit} from the runway start` : ''}`;
  const notes: string[] = [];
  if (s.remainingM !== null) notes.push(`${u.fmtDist(Math.max(0, s.remainingM))} ${u.distUnit} of runway ${rejected ? 'left at the end of the recording' : 'ahead at liftoff'}`);
  if (s.clMaxM !== null && s.clMaxStartM !== null) notes.push(`furthest from the centreline ${off(s.clMaxM).replace('on the centreline', `0 ${u.distUnit}`)}${s.clMaxIasKt !== null ? ` at ${u.fmtSpeed(s.clMaxIasKt)} ${u.speedUnit}` : ''}`);
  const note = notes.join(' · ');
  return { svg: p.join(''), caption, note: note.charAt(0).toUpperCase() + note.slice(1) };
}

const C = { width: 1080, padL: 150, padR: 30, top: 56, lane: 66, gap: 26, padB: 24 };

/** The height the climb drawing ends at on the right, feet. */
export function climbTop(tr: ClimbTrace): number {
  return Math.max(200, Math.max(...tr.h));
}

/** The height under a horizontal position in the climb drawing (0 = left edge of the image), feet. */
export function climbHeightAt(tr: ClimbTrace, fraction: number): number {
  const w = C.width - C.padL - C.padR;
  const f = Math.max(0, Math.min(1, (fraction * C.width - C.padL) / w));
  return climbTop(tr) * f;
}

export interface ClimbPoint {
  t: number;
  h: number;
  vs: number;
  ias: number;
  gs: number;
  pitch: number;
  bank: number;
  power: number | null;
  flaps: number;
  gear: number;
}

/** Every value on first climbing through a height, or null when the recording ends below it. */
export function climbAt(tr: ClimbTrace, heightFt: number): ClimbPoint | null {
  let j = -1;
  for (let k = 0; k < tr.h.length; k++) {
    if (tr.h[k] >= heightFt) {
      j = k;
      break;
    }
  }
  if (j < 0) return null;
  const i = Math.max(0, j - 1);
  const f = tr.h[j] - tr.h[i] > 1e-6 ? Math.max(0, Math.min(1, (heightFt - tr.h[i]) / (tr.h[j] - tr.h[i]))) : 1;
  const mix = (xs: number[]) => xs[i] + (xs[j] - xs[i]) * f;
  const pi = tr.power[i];
  const pj = tr.power[j];
  return { t: mix(tr.t), h: heightFt, vs: mix(tr.vs), ias: mix(tr.ias), gs: mix(tr.gs), pitch: mix(tr.pitch), bank: mix(tr.bank), power: pi === null ? pj : pj === null ? pi : pi + (pj - pi) * f, flaps: tr.flaps[j], gear: tr.gear[j] };
}

function tickStep(top: number): number {
  for (const st of [50, 100, 200, 250, 500, 1000]) if (top / st <= 7) return st;
  return 1000;
}

export interface ClimbSvgOptions {
  summary: ClimbSummary;
  trace: ClimbTrace;
  powerKind: PowerKind | null;
  units: Units;
  pxWidth: number;
  /** Height of the read-out cursor, feet, or null for none. */
  cursorFt: number | null;
}

/**
 * The climb by height above the liftoff point, from the runway on the left to the top of the
 * recording on the right: airspeed, vertical speed, pitch, bank and engine power in lanes, with
 * the gear, flap and thrust changes marked at the height they happened.
 */
export function climbSvg(o: ClimbSvgOptions): string {
  const { summary: c, trace: tr, units: u } = o;
  const { width, padL, padR, top, lane, gap, padB } = C;
  const w = width - padL - padR;
  const topFt = climbTop(tr);
  const x = (h: number) => padL + (Math.max(0, Math.min(topFt, h)) / topFt) * w;
  const hasPower = tr.power.some((v) => v !== null);
  // The drawing follows the first climb through each height: stop at the highest point reached.
  let last = 0;
  for (let i = 1; i < tr.h.length; i++) if (tr.h[i] > tr.h[last]) last = i;
  const rpm = o.powerKind === 'rpm';
  const lanes: { title: string; sub: string; values: (number | null)[]; zero?: boolean }[] = [
    { title: 'AIRSPEED', sub: `indicated, ${u.speedUnit}`, values: tr.ias.map((v) => u.speed(v)) },
    { title: 'VERTICAL SPEED', sub: u.vsUnit, values: tr.vs.map((v) => u.vs(v)), zero: true },
    { title: 'PITCH', sub: 'deg', values: tr.pitch },
    // Seen from behind: right wing down is down.
    { title: 'BANK', sub: 'deg, right +', values: tr.bank },
  ];
  if (hasPower) lanes.push({ title: rpm ? 'RPM' : 'N1', sub: rpm ? 'engine average' : '%, engine average', values: tr.power });
  const bottom = top + lanes.length * lane + (lanes.length - 1) * gap;
  const height = bottom + padB;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${Math.round(o.pxWidth)}" height="${Math.round((o.pxWidth * height) / width)}" class="la-chart la-approach">`);

  // Height axis along the bottom, in the display unit.
  const topUnit = u.height(topFt);
  const step = tickStep(topUnit);
  const perUnit = topFt / topUnit;
  for (let v = 0; v <= topUnit + 1e-6; v += step) {
    const xx = x(v * perUnit).toFixed(1);
    p.push(`<text x="${xx}" y="${bottom + 16}" class="la-axis" text-anchor="middle">${v === 0 ? '0' : group(v)}${v + step > topUnit + 1e-6 ? ' ' + u.heightUnit : ''}</text>`);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${top - 10}" y2="${bottom}" class="la-grid"/>`);
  }

  const cursor = o.cursorFt !== null ? climbAt(tr, Math.max(0, Math.min(tr.h[last], o.cursorFt))) : null;
  const dots: string[] = [];
  lanes.forEach((ln, k) => {
    const y0 = top + k * (lane + gap);
    const vals = ln.values.slice(0, last + 1).filter((v): v is number => v !== null);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (ln.zero) lo = Math.min(0, lo);
    if (hi - lo < 1e-6) hi = lo + 1;
    const st = niceStep(hi - lo, 2);
    lo = Math.floor(lo / st + 1e-9) * st;
    hi = Math.ceil(hi / st - 1e-9) * st;
    const digits = st >= 1 ? 0 : 1;
    const y = (v: number) => y0 + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * lane;
    p.push(`<text x="0" y="${y0 + lane / 2}" class="la-lane-label">${ln.title}</text>`);
    p.push(`<text x="0" y="${y0 + lane / 2 + 14}" class="la-axis">${ln.sub}</text>`);
    for (let v = lo; v <= hi + st * 1e-6; v += st) {
      const yy = y(v).toFixed(1);
      p.push(`<line x1="${padL}" x2="${padL + w}" y1="${yy}" y2="${yy}" class="la-grid"/>`);
      p.push(`<text x="${padL - 6}" y="${yy}" class="la-axis" text-anchor="end" dominant-baseline="middle">${st >= 1 ? group(Math.abs(v) < st * 1e-6 ? 0 : v) : v.toFixed(digits)}</text>`);
    }
    let d = '';
    let pen = false;
    for (let i = 0; i <= last; i++) {
      const v = ln.values[i];
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(tr.h[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    p.push(`<path d="${d}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round"/>`);
    if (cursor) {
      const cv = [u.speed(cursor.ias), u.vs(cursor.vs), cursor.pitch, cursor.bank, cursor.power][k];
      if (cv !== null && cv !== undefined) dots.push(`<circle cx="${x(cursor.h).toFixed(1)}" cy="${y(cv).toFixed(1)}" r="4" fill="#0b0d10" stroke="${TEXT}" stroke-width="2"/>`);
    }
  });

  // Events at the height they happened, their labels on two rows so neighbours do not collide.
  const events: { h: number; label: string; color: string }[] = [];
  const at = (h: number | null, label: string, color: string) => {
    if (h !== null && h <= topFt) events.push({ h, label: `${label} ${u.fmtHeight(h)} ${u.heightUnit}`, color });
  };
  at(c.gearUpFt, 'GEAR UP', SOFT);
  at(c.runwayEndFt, 'RUNWAY END', '#c297ff');
  at(c.thrustRedFt, rpm ? 'POWER REDUCTION' : 'THRUST REDUCTION', ROTATION);
  at(c.flapFt, 'FLAP RETRACTION', ACCENT);
  events.sort((a, b) => a.h - b.h);
  const rowEnd = [-1e9, -1e9];
  for (const e of events) {
    const xx = x(e.h);
    const tw = e.label.length * 6.7;
    const start = xx + 6 + tw < width;
    const from = start ? xx + 6 : xx - 6 - tw;
    const row = from > rowEnd[0] + 10 ? 0 : 1;
    rowEnd[row] = from + tw;
    const ty = top - 18 - row * 14;
    p.push(`<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${ty - 8}" y2="${bottom}" stroke="${e.color}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    p.push(`<text x="${(start ? xx + 6 : xx - 6).toFixed(1)}" y="${ty}" class="la-marker-label" fill="${e.color}" text-anchor="${start ? 'start' : 'end'}">${e.label}</text>`);
  }
  if (cursor) {
    const xx = x(cursor.h).toFixed(1);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${top - 10}" y2="${bottom}" stroke="${TEXT}" stroke-width="1"/>`);
    p.push(dots.join(''));
  }
  p.push('</svg>');
  return p.join('');
}
