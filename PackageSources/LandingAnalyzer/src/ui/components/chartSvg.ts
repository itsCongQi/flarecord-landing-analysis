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

  const all = o.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  for (const g of o.guides ?? []) all.push(g.value);
  let lo = o.yMin ?? Math.min(...all);
  let hi = o.yMax ?? Math.max(...all);
  if (hi - lo < 1e-6) {
    hi += 1;
    lo -= 1;
  }
  if (o.yMin === undefined) lo -= (hi - lo) * 0.08;
  if (o.yMax === undefined) hi += (hi - lo) * 0.08;

  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * w;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * h;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${o.width}" height="${o.height}" class="la-chart">`);

  // Grid: 4 horizontal lines with labels, vertical line every 5 s.
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const yy = y(v).toFixed(1);
    parts.push(`<line x1="${padL}" x2="${padL + w}" y1="${yy}" y2="${yy}" class="la-grid"/>`);
    parts.push(`<text x="${padL - 6}" y="${yy}" class="la-axis" text-anchor="end" dominant-baseline="middle">${fmt(v)}</text>`);
  }
  for (let t = Math.ceil(t0 / 5) * 5; o.timeAxis !== false && t <= t1; t += 5) {
    const xx = x(t).toFixed(1);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${padT + h}" class="la-grid"/>`);
    parts.push(`<text x="${xx}" y="${padT + h + 14}" class="la-axis" text-anchor="middle">${t === 0 ? 'TD' : t + 's'}</text>`);
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

  parts.push(`<text x="4" y="12" class="la-unit">${o.unit}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(0) : v.toFixed(1);
}
