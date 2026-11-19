/**
 * Builds a small line chart as an SVG string. Plain string building keeps it independent of the
 * UI framework, cheap to redraw in Coherent, and reusable by the browser mockup.
 */
export interface ChartSeries {
  values: (number | null)[];
  color: string;
  label: string;
}

export interface ChartMarker {
  t: number;
  label: string;
  color: string;
}

export interface ChartOptions {
  t: number[];
  series: ChartSeries[];
  width: number;
  height: number;
  unit: string;
  markers?: ChartMarker[];
  /** Horizontal guide lines, e.g. a target sink rate. */
  guides?: { value: number; label: string }[];
  /** Force the y-range (otherwise fitted to the data with 8% padding). */
  yMin?: number;
  yMax?: number;
  /** Rendered width in CSS pixels; the height follows the aspect ratio. Defaults to `width`. */
  pxWidth?: number;
  /** Draw the seconds-to-touchdown axis labels (default true). */
  timeAxis?: boolean;
}

export function chartSvg(o: ChartOptions): string {
  const padL = 44;
  const padR = 10;
  const padT = 18;
  const padB = 22;
  const w = o.width - padL - padR;
  const h = o.height - padT - padB;
  const t0 = o.t[0];
  const t1 = o.t[o.t.length - 1];

  // No Array.flatMap: the EFB build targets ES2017 (Coherent GT).
  const all: number[] = [];
  for (const s of o.series) for (const v of s.values) if (v !== null) all.push(v);
  for (const g of o.guides ?? []) all.push(g.value);
  let lo = o.yMin ?? Math.min(...all);
  let hi = o.yMax ?? Math.max(...all);
  if (hi - lo < 1e-6) {
    // Flat data: widen the range, but never past a fixed bound (e.g. height stays at or above 0).
    if (o.yMax === undefined) hi += 1;
    if (o.yMin === undefined) lo -= 1;
    if (hi - lo < 1e-6) hi = lo + 1;
  }
  // Round the range out to whole steps so the axis reads in plain numbers (0, 50, 100 ...).
  const step = niceStep(hi - lo, 4);
  if (o.yMin === undefined) lo = Math.floor(lo / step + 1e-9) * step;
  if (o.yMax === undefined) hi = Math.ceil(hi / step - 1e-9) * step;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;

  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * w;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * h;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${Math.round(o.pxWidth ?? o.width)}" height="${Math.round(((o.pxWidth ?? o.width) * o.height) / o.width)}" class="la-chart">`);

  // Grid: a horizontal line per step with its value, a vertical line every 5 s.
  for (let v = lo; v <= hi + step * 1e-6; v += step) {
    const yy = y(v).toFixed(1);
    parts.push(`<line x1="${padL}" x2="${padL + w}" y1="${yy}" y2="${yy}" class="la-grid"/>`);
    parts.push(`<text x="${padL - 6}" y="${yy}" class="la-axis" text-anchor="end" dominant-baseline="middle">${(Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(digits)}</text>`);
  }
  for (let t = Math.ceil(t0 / 5) * 5; o.timeAxis !== false && t <= t1; t += 5) {
    const xx = x(t).toFixed(1);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${padT + h}" class="la-grid"/>`);
    parts.push(`<text x="${xx}" y="${padT + h + 14}" class="la-axis" text-anchor="middle">${t === 0 ? 'TD' : t}</text>`);
  }

  for (const g of o.guides ?? []) {
    const yy = y(g.value).toFixed(1);
    parts.push(`<line x1="${padL}" x2="${padL + w}" y1="${yy}" y2="${yy}" class="la-guide"/>`);
    parts.push(`<text x="${padL + w - 2}" y="${(+yy - 4).toFixed(1)}" class="la-guide-label" text-anchor="end">${g.label}</text>`);
  }

  for (const s of o.series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(o.t[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`);
  }

  for (const m of o.markers ?? []) {
    if (m.t < t0 || m.t > t1) continue;
    const xx = x(m.t).toFixed(1);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${padT + h}" stroke="${m.color}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${xx}" y="${padT - 5}" fill="${m.color}" class="la-marker" text-anchor="middle">${m.label}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

/** A step of 1, 2, 2.5 or 5 times a power of ten that splits the range into about `n` parts. */
function niceStep(range: number, n: number): number {
  const raw = range / n;
  const mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

export interface StackLane {
  label: string;
  values: (number | null)[];
  color: string;
  /** Force the lower bound (e.g. 0 for height). */
  yMin?: number;
  /** Value shown at the cursor, already formatted with its unit. */
  format: (v: number) => string;
}

export interface StackOptions {
  t: number[];
  lanes: StackLane[];
  markers?: ChartMarker[];
  /** Thin vertical lines with a label on top, e.g. the moment of passing 50 ft. */
  gates?: { t: number; label: string }[];
  /** Time of the read-out cursor, or null for none. */
  cursorT: number | null;
  pxWidth: number;
}

const STACK = { width: 1080, padL: 44, padR: 86, padT: 26, lane: 92, gap: 26, padB: 24 };

/** Height of the stacked chart's viewBox for a number of lanes. */
function stackHeight(lanes: number): number {
  return STACK.padT + lanes * STACK.lane + (lanes - 1) * STACK.gap + STACK.padB;
}

/**
 * The time under a horizontal position in a stacked chart, for placing the cursor from a tap.
 * `fraction` is the tap's x position as a fraction of the drawing's width (0 = left edge).
 */
export function stackTimeAt(t: number[], fraction: number): number {
  const w = STACK.width - STACK.padL - STACK.padR;
  const f = Math.max(0, Math.min(1, (fraction * STACK.width - STACK.padL) / w));
  return t[0] + f * (t[t.length - 1] - t[0]);
}

/**
 * Several quantities stacked in lanes over one shared time axis, so a moment reads straight down
 * through all of them. Each lane keeps its own scale. Markers, gates and the cursor run through
 * every lane; the cursor prints each lane's value in the right margin.
 */
export function stackSvg(o: StackOptions): string {
  const { width, padL, padR, padT, lane, gap, padB } = STACK;
  const w = width - padL - padR;
  const height = stackHeight(o.lanes.length);
  const bottom = height - padB;
  const t0 = o.t[0];
  const t1 = o.t[o.t.length - 1];
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * w;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${Math.round(o.pxWidth)}" height="${Math.round((o.pxWidth * height) / width)}" class="la-chart la-stack">`);

  // Shared time grid.
  for (let t = Math.ceil(t0 / 5) * 5; t <= t1; t += 5) {
    const xx = x(t).toFixed(1);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${bottom}" class="la-grid"/>`);
    p.push(`<text x="${xx}" y="${bottom + 15}" class="la-axis" text-anchor="middle">${t === 0 ? 'TD' : t}</text>`);
  }

  const cursor = o.cursorT !== null && o.cursorT >= t0 && o.cursorT <= t1 ? o.cursorT : null;
  let ci = 0;
  if (cursor !== null) while (ci < o.t.length - 2 && o.t[ci + 1] <= cursor) ci++;

  const dots: string[] = [];
  o.lanes.forEach((ln, k) => {
    const top = padT + k * (lane + gap);
    const vals = ln.values.filter((v): v is number => v !== null);
    let lo = ln.yMin ?? Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-6) hi = lo + 1;
    const step = niceStep(hi - lo, 2);
    if (ln.yMin === undefined) lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * lane;

    p.push(`<rect x="${padL}" y="${top}" width="${w}" height="${lane}" class="la-lane"/>`);
    for (let v = lo; v <= hi + step * 1e-6; v += step) {
      const yy = y(v).toFixed(1);
      p.push(`<line x1="${padL}" x2="${padL + w}" y1="${yy}" y2="${yy}" class="la-grid"/>`);
      p.push(`<text x="${padL - 6}" y="${yy}" class="la-axis" text-anchor="end" dominant-baseline="middle">${(Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(digits)}</text>`);
    }
    p.push(`<text x="${padL + 8}" y="${top + 15}" class="la-lane-label">${ln.label}</text>`);

    let d = '';
    let pen = false;
    ln.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(o.t[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    p.push(`<path d="${d}" fill="none" stroke="${ln.color}" stroke-width="2" stroke-linejoin="round"/>`);

    if (cursor !== null) {
      const a = ln.values[ci];
      const b = ln.values[ci + 1];
      if (a !== null && b !== null && a !== undefined && b !== undefined) {
        const span = o.t[ci + 1] - o.t[ci];
        const v = a + (b - a) * (span > 0 ? (cursor - o.t[ci]) / span : 0);
        dots.push(`<circle cx="${x(cursor).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#0b0d10" stroke="#e8ecf0" stroke-width="2"/>`);
        dots.push(`<text x="${padL + w + 10}" y="${(top + lane / 2).toFixed(1)}" class="la-cursor-value" dominant-baseline="middle">${ln.format(v)}</text>`);
      }
    }
  });

  for (const g of o.gates ?? []) {
    if (g.t < t0 || g.t > t1) continue;
    const xx = x(g.t).toFixed(1);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${bottom}" class="la-gate"/>`);
    p.push(`<text x="${xx}" y="${padT - 8}" class="la-gate-label" text-anchor="middle">${g.label}</text>`);
  }
  for (const m of o.markers ?? []) {
    if (m.t < t0 || m.t > t1) continue;
    const xx = x(m.t).toFixed(1);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${bottom}" stroke="${m.color}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
  }
  if (cursor !== null) {
    const xx = x(cursor).toFixed(1);
    p.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${bottom}" stroke="#e8ecf0" stroke-width="1"/>`);
    p.push(dots.join(''));
  }
  p.push('</svg>');
  return p.join('');
}
