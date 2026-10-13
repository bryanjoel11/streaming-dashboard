// Hand-rolled SVG charts. Each chart re-renders to its container's real width,
// so text stays legible at phone width (no viewBox scaling).

import { esc } from './format';

export interface Series {
  name: string;
  color: string;
  values: number[];
  dash?: boolean;
  pattern?: boolean; // hatched fill (stacked bars)
}

const FONT = `font-family="Inter, system-ui, sans-serif"`;

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

export function niceScale(min: number, max: number, ticks = 4) {
  if (max === min) max = min + 1;
  const step = niceStep(max - min, ticks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(10));
  return { lo, hi, ticks: out };
}

// ---------- tooltip ----------
let tipEl: HTMLDivElement | null = null;
function tip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'status');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function showTip(html: string, x: number, y: number) {
  const t = tip();
  t.innerHTML = html;
  t.style.opacity = '1';
  const r = t.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  t.style.transform = `translate(${left}px, ${top}px)`;
}
export function hideTip() {
  if (tipEl) tipEl.style.opacity = '0';
}

export function tipRow(color: string | null, label: string, value: string, opts: { pattern?: boolean; dash?: boolean } = {}) {
  const sw = color
    ? `<span class="sw${opts.pattern ? ' sw-hatch' : ''}${opts.dash ? ' sw-dash' : ''}" style="--c:${color}"></span>`
    : '';
  return `<div class="tip-row">${sw}<span class="tip-l">${esc(label)}</span><span class="tip-v">${esc(value)}</span></div>`;
}

/** Wire hover on any element carrying data-tip (HTML), plus optional per-index hooks. */
function wireTips(root: HTMLElement, onIndex?: (i: number | null) => void) {
  const svg = root.querySelector('svg');
  if (!svg) return;
  const handler = (ev: PointerEvent) => {
    const el = (ev.target as Element).closest('[data-tip]') as SVGElement | null;
    if (!el) {
      hideTip();
      onIndex?.(null);
      return;
    }
    showTip(el.getAttribute('data-tip')!, ev.clientX, ev.clientY);
    const i = el.getAttribute('data-i');
    onIndex?.(i == null ? null : +i);
  };
  svg.addEventListener('pointermove', handler);
  svg.addEventListener('pointerdown', handler);
  svg.addEventListener('pointerleave', () => {
    hideTip();
    onIndex?.(null);
  });
}

function xLabelEvery(n: number, plotW: number, minPx = 58) {
  const per = plotW / n;
  return Math.max(1, Math.ceil(minPx / per));
}

// ---------- line chart ----------
export interface LineOpts {
  labels: string[];
  shortLabels?: string[];
  series: Series[];
  yFmt: (v: number) => string;
  axisFmt?: (v: number) => string;
  height?: number;
  yMin?: number;
  annotations?: { i: number; text: string }[];
  endLabels?: boolean;
  tipTitle?: (i: number) => string;
  tipExtra?: (i: number) => string;
}

export function lineChart(root: HTMLElement, o: LineOpts) {
  const W = Math.max(280, root.clientWidth);
  const H = o.height ?? 260;
  const narrow = W < 520;
  const endLabels = (o.endLabels ?? true) && !narrow;
  const m = { t: o.annotations?.length ? 26 : 12, r: endLabels ? 92 : 12, b: 26, l: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = o.labels.length;
  const all = o.series.flatMap((s) => s.values);
  const sc = niceScale(o.yMin ?? Math.min(...all), Math.max(...all), 4);
  const x = (i: number) => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;

  let g = '';
  for (const t of sc.ticks) {
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    g += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${esc((o.axisFmt ?? o.yFmt)(t))}</text>`;
  }
  const every = xLabelEvery(n, pw, 64);
  const sl = o.shortLabels ?? o.labels;
  for (let i = 0; i < n; i += every) {
    g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(sl[i])}</text>`;
  }
  for (const a of o.annotations ?? []) {
    g += `<line x1="${x(a.i)}" x2="${x(a.i)}" y1="${m.t - 4}" y2="${m.t + ph}" class="annot-line"/>`;
    const anchor = x(a.i) > m.l + pw * 0.7 ? 'end' : 'start';
    g += `<text x="${x(a.i) + (anchor === 'start' ? 6 : -6)}" y="${m.t - 10}" text-anchor="${anchor}" class="annot">${esc(a.text)}</text>`;
  }
  // lines
  for (const s of o.series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
  }
  // end labels with simple collision avoidance
  if (endLabels) {
    const ends = o.series.map((s) => ({ s, yy: y(s.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
    for (const e of ends) {
      g += `<circle cx="${x(n - 1)}" cy="${y(e.s.values[n - 1])}" r="3.5" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      g += `<text x="${x(n - 1) + 10}" y="${e.yy + 4}" class="end-label">${esc(e.s.name)}</text>`;
    }
  }
  // crosshair + hover bands
  g += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" style="opacity:0"/>`;
  g += `<g class="dots"></g>`;
  const bw = n > 1 ? pw / (n - 1) : pw;
  for (let i = 0; i < n; i++) {
    const rows = o.series.map((s) => tipRow(s.color, s.name, o.yFmt(s.values[i]), { dash: s.dash })).join('');
    const html = `<div class="tip-t">${esc(o.tipTitle ? o.tipTitle(i) : o.labels[i])}</div>${rows}${o.tipExtra ? o.tipExtra(i) : ''}`;
    g += `<rect x="${x(i) - bw / 2}" y="${m.t}" width="${bw}" height="${ph}" fill="transparent" data-i="${i}" data-tip="${esc(html)}"/>`;
  }
  root.innerHTML = `<svg width="${W}" height="${H}" ${FONT} role="img">${g}</svg>`;
  const svg = root.querySelector('svg')!;
  const cross = svg.querySelector('.crosshair') as SVGLineElement;
  const dots = svg.querySelector('.dots') as SVGGElement;
  wireTips(root, (i) => {
    if (i == null) {
      cross.style.opacity = '0';
      dots.innerHTML = '';
      return;
    }
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.style.opacity = '1';
    dots.innerHTML = o.series
      .map((s) => `<circle cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`)
      .join('');
  });
}

// ---------- stacked bars ----------
export interface StackOpts {
  labels: string[];
  shortLabels?: string[];
  series: Series[];
  yFmt: (v: number) => string;
  axisFmt?: (v: number) => string;
  height?: number;
  totalLabel?: string;
}

export function stackedBars(root: HTMLElement, o: StackOpts) {
  const W = Math.max(280, root.clientWidth);
  const H = o.height ?? 260;
  const m = { t: 12, r: 12, b: 26, l: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = o.labels.length;
  const totals = o.labels.map((_, i) => o.series.reduce((a, s) => a + s.values[i], 0));
  const sc = niceScale(0, Math.max(...totals), 4);
  const y = (v: number) => m.t + ph - (v / sc.hi) * ph;
  const slot = pw / n;
  const bw = Math.max(3, Math.min(22, slot * 0.68));
  let g = `<defs>${o.series
    .filter((s) => s.pattern)
    .map(
      (s, k) =>
        `<pattern id="hatch-${k}-${s.color.slice(1)}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${s.color}" opacity="0.35"/><line x1="0" y1="0" x2="0" y2="6" stroke="${s.color}" stroke-width="3"/></pattern>`,
    )
    .join('')}</defs>`;
  for (const t of sc.ticks) {
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    g += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="axis">${esc((o.axisFmt ?? o.yFmt)(t))}</text>`;
  }
  const every = xLabelEvery(n, pw, 64);
  const sl = o.shortLabels ?? o.labels;
  for (let i = 0; i < n; i += every) {
    g += `<text x="${m.l + slot * (i + 0.5)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(sl[i])}</text>`;
  }
  let pk = 0;
  const fills = o.series.map((s) => (s.pattern ? `url(#hatch-${pk++}-${s.color.slice(1)})` : s.color));
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const cx = m.l + slot * (i + 0.5);
    const rows = o.series.map((s) => tipRow(s.color, s.name, o.yFmt(s.values[i]), { pattern: s.pattern })).join('');
    const html = `<div class="tip-t">${esc(o.labels[i])}</div>${rows}${tipRow(null, o.totalLabel ?? 'Total', o.yFmt(totals[i]))}`;
    o.series.forEach((s, k) => {
      const v = s.values[i];
      const y0 = y(acc);
      const y1 = y(acc + v);
      acc += v;
      const top = k === o.series.length - 1;
      const h = Math.max(0, y0 - y1 - 2); // 2px surface gap between segments
      if (top) {
        const r = Math.min(4, bw / 2, h);
        g += `<path d="M${cx - bw / 2},${y0 - 2}V${y1 + r}Q${cx - bw / 2},${y1} ${cx - bw / 2 + r},${y1}H${cx + bw / 2 - r}Q${cx + bw / 2},${y1} ${cx + bw / 2},${y1 + r}V${y0 - 2}Z" fill="${fills[k]}"/>`;
      } else {
        g += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${h}" fill="${fills[k]}"/>`;
      }
    });
    g += `<rect x="${m.l + slot * i}" y="${m.t}" width="${slot}" height="${ph}" fill="transparent" class="hit" data-i="${i}" data-tip="${esc(html)}"/>`;
  }
  root.innerHTML = `<svg width="${W}" height="${H}" ${FONT} role="img">${g}</svg>`;
  const svg = root.querySelector('svg')!;
  wireTips(root, (i) => {
    svg.querySelectorAll('.hit').forEach((h) => h.classList.toggle('on', h.getAttribute('data-i') === String(i)));
  });
}

// ---------- heatmap ----------
export interface HeatOpts {
  rows: string[];
  cols: string[];
  values: (number | null)[][];
  min: number;
  max: number;
  fmt: (v: number) => string;
  tip: (r: number, c: number, v: number) => string;
}

/** Single-hue sequential ramp (nebula), light -> dark is low -> high on a dark surface: low = dim, high = bright. */
export function rampColor(t: number): string {
  const tt = Math.max(0, Math.min(1, t));
  // interpolate in OKLCH-ish by hand: from deep indigo to bright lavender
  const a = [38, 34, 92];
  const b = [196, 182, 255];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.pow(tt, 0.9)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function heatmap(root: HTMLElement, o: HeatOpts) {
  const W = Math.max(300, root.clientWidth);
  const narrow = W < 560;
  const m = { t: 22, r: 4, b: 4, l: narrow ? 56 : 70 };
  const cw = (W - m.l - m.r) / o.cols.length;
  const ch = narrow ? 20 : 22;
  const H = m.t + m.b + ch * o.rows.length;
  const showVals = cw >= 34;
  let g = '';
  o.cols.forEach((c, j) => {
    g += `<text x="${m.l + cw * (j + 0.5)}" y="14" text-anchor="middle" class="axis">${esc(showVals ? 'M' + c : c)}</text>`;
  });
  g += `<text x="${m.l - 8}" y="14" text-anchor="end" class="axis">${showVals ? '' : 'Month'}</text>`;
  o.rows.forEach((r, i) => {
    g += `<text x="${m.l - 8}" y="${m.t + ch * i + ch / 2 + 4}" text-anchor="end" class="axis">${esc(r)}</text>`;
    o.values[i].forEach((v, j) => {
      if (v == null) return;
      const t = (v - o.min) / (o.max - o.min);
      const x0 = m.l + cw * j + 1;
      const y0 = m.t + ch * i + 1;
      g += `<rect x="${x0}" y="${y0}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${rampColor(t)}" data-tip="${esc(o.tip(i, j, v))}" class="cell"/>`;
      if (showVals)
        g += `<text x="${x0 + (cw - 2) / 2}" y="${y0 + ch / 2 + 3}" text-anchor="middle" class="cell-v" fill="${t > 0.55 ? '#141833' : '#E8ECFF'}" pointer-events="none">${esc(o.fmt(v))}</text>`;
    });
  });
  root.innerHTML = `<svg width="${W}" height="${H}" ${FONT} role="img">${g}</svg>`;
  wireTips(root);
}

// ---------- horizontal 100% bar ----------
export function shareBar(segments: { name: string; color: string; value: number; pattern?: boolean }[], fmt: (v: number) => string) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return `<div class="sharebar">${segments
    .map((s) => {
      const p = s.value / total;
      const html = `${tipRow(s.color, s.name, `${(p * 100).toFixed(1)}%`)}${tipRow(null, 'Value', fmt(s.value))}`;
      return `<div class="seg${s.pattern ? ' sw-hatch' : ''}" style="--c:${s.color};flex:${p}" data-tip="${esc(html)}"><span>${p >= 0.12 ? Math.round(p * 100) + '%' : ''}</span></div>`;
    })
    .join('')}</div>`;
}

export function wireHtmlTips(root: HTMLElement) {
  root.addEventListener('pointermove', (ev) => {
    const el = (ev.target as Element).closest('[data-tip]');
    if (!el || el.closest('svg')) {
      if (!el) hideTip();
      return;
    }
    showTip(el.getAttribute('data-tip')!, ev.clientX, ev.clientY);
  });
  root.addEventListener('pointerleave', hideTip);
}
