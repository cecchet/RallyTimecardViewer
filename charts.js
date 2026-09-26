'use strict';

// Line charts of how the rally developed: position and time behind the leader after each stage.
// Plain SVG, no library. Colors come from the --s1..--s8 categorical slots in style.css.

const MAX_COLORS = 8;
const SVGNS = 'http://www.w3.org/2000/svg';

// Cumulative time, position and gap to the leader after each stage, for a group of cars.
// A car's line stops at the first stage it has no time for.
function progression(cars, nStages) {
  const out = cars.map((r) => {
    const cum = []; let t = 0; let ok = true;
    for (let k = 0; k < nStages; k++) {
      const s = r.stages[k];
      if (ok && s.didRun) { t += s.scored; cum.push(t); } else { ok = false; cum.push(null); }
    }
    return { r, cum, pos: [], gap: [] };
  });
  for (let k = 0; k < nStages; k++) {
    const ran = out.filter((p) => p.cum[k] != null).sort((a, b) => a.cum[k] - b.cum[k]);
    ran.forEach((p, i) => { p.pos[k] = i + 1; p.gap[k] = p.cum[k] - ran[0].cum[k]; });
    out.forEach((p) => { if (p.cum[k] == null) { p.pos[k] = null; p.gap[k] = null; } });
  }
  return out;
}

const surname = (name) => { const w = String(name || '').trim().split(/\s+/); return w[w.length - 1] || ''; };

function niceStep(range, maxTicks, steps) {
  return steps.find((s) => range / s <= maxTicks) || steps[steps.length - 1];
}
const GAP_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const fmtGapTick = (sec) => (sec === 0 ? '0' : '+' + (sec >= 3600 ? fmtDur(sec, true).replace(/\.\d$/, '') : fmtDur(sec).replace(/\.0$/, '')));

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * Draw one line chart into `host`.
 * cfg: { title, sub, n (stages), series: [{ id, color (css) | null, label, vals: [num|null] }],
 *        yMax, yTicks: [num], yFmt(v), note, rows(k) -> [{id, color, text, value}], onOpen(id), selected }
 * Values map top-down: 0 / P1 at the top.
 */
function lineChart(host, cfg) {
  const wrap = document.createElement('div');
  wrap.className = 'viz';
  wrap.innerHTML = `<div class="viz-head"><h3>${esc(cfg.title)}</h3><span>${esc(cfg.sub || '')}</span></div>`;
  host.appendChild(wrap);
  const plotBox = document.createElement('div');
  plotBox.className = 'viz-plot';
  wrap.appendChild(plotBox);

  const W = Math.max(280, plotBox.clientWidth || host.clientWidth || 600);
  const narrow = W < 520;
  const H = narrow ? 250 : 290;
  const m = { l: 50, r: 46, t: 12, b: 28 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const { n, yMin = 0, yMax } = cfg;
  const x = (k) => m.l + (n === 1 ? pw / 2 : (k * pw) / (n - 1));
  const y = (v) => m.t + ((v - yMin) / ((yMax - yMin) || 1)) * ph;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': cfg.title });
  plotBox.appendChild(svg);
  const clipId = 'clip' + Math.random().toString(36).slice(2);
  el('rect', { x: m.l - 6, y: m.t - 6, width: pw + 12, height: ph + 12 }, el('clipPath', { id: clipId }, el('defs', {}, svg)));

  // grid + axes
  const grid = el('g', { class: 'grid' }, svg);
  cfg.yTicks.forEach((v) => {
    el('line', { x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v) }, grid);
    el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, grid).textContent = cfg.yFmt(v);
  });
  const xEvery = narrow && n > 8 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    if (k % xEvery && k !== n - 1) continue;
    if (xEvery > 1 && k === n - 2) continue; // would crowd the last label
    el('text', { x: x(k), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, grid).textContent = narrow ? String(k + 1) : `SS${k + 1}`;
  }
  el('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, class: 'axis' }, grid);

  // lines: muted first, colored next, selected car last (on top)
  const order = cfg.series.slice().sort((a, b) =>
    (a.id === cfg.selected) - (b.id === cfg.selected) || (!!a.color) - (!!b.color));
  const lines = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  const byId = {};
  order.forEach((s) => {
    const pts = s.vals.map((v, k) => (v == null ? null : [x(k), y(v)])).filter(Boolean);
    if (!pts.length) return;
    const g = el('g', { class: 'series' + (s.color ? '' : ' muted') + (s.id === cfg.selected ? ' sel' : ''), style: s.color ? `--c:${s.color}` : '' }, lines);
    if (pts.length > 1) el('path', { d: 'M' + pts.map((p) => p.map((c) => c.toFixed(1)).join(',')).join('L') }, g);
    pts.forEach(([px, py]) => el('circle', { cx: px, cy: py, r: 4 }, g));
    byId[s.id] = g;
  });

  // end-of-line car labels, nudged apart so they never overlap
  const labels = cfg.series.map((s) => {
    let k = -1; s.vals.forEach((v, i) => { if (v != null) k = i; });
    if (k < 0 || s.vals[k] > yMax) return null;
    return { s, x: x(k) + 7, y: y(s.vals[k]) + 4 };
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (Math.abs(labels[i].x - labels[i - 1].x) < 30 && labels[i].y - labels[i - 1].y < 11) labels[i].y = labels[i - 1].y + 11;
  }
  const lg = el('g', { class: 'endlabels' }, svg);
  labels.forEach((l) => {
    const t = el('text', { x: l.x, y: l.y, class: l.s.id === cfg.selected ? 'sel' : '' }, lg);
    t.textContent = l.s.label;
    t.dataset.id = l.s.id;
  });

  // hover layer: crosshair + tooltip listing the field at that stage
  const cross = el('line', { y1: m.t, y2: m.t + ph, class: 'cross', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l - 20, y: 0, width: pw + 40, height: H, class: 'hit' }, svg);
  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.hidden = true;
  plotBox.appendChild(tip);
  let hot = null; let lastTap = null;

  const setHot = (id) => {
    if (hot === id) return;
    if (hot && byId[hot]) byId[hot].classList.remove('hot');
    hot = id;
    svg.classList.toggle('focus', !!id);
    if (id && byId[id]) { byId[id].classList.add('hot'); byId[id].parentNode.appendChild(byId[id]); }
  };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) * W) / r.width;
    const py = ((ev.clientY - r.top) * H) / r.height;
    const k = Math.max(0, Math.min(n - 1, n === 1 ? 0 : Math.round(((px - m.l) / pw) * (n - 1))));
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    let best = null; let bd = 16;
    cfg.series.forEach((s) => {
      const v = s.vals[k]; if (v == null || v > yMax) return;
      const d = Math.abs(y(v) - py); if (d < bd) { bd = d; best = s.id; }
    });
    setHot(best);
    const rows = cfg.rows(k);
    tip.innerHTML = `<b>After SS${k + 1}</b>` + rows.map((rw) =>
      `<div class="tr${rw.id === hot ? ' on' : ''}"><i style="background:${rw.color || 'var(--line-muted)'}"></i><span>${esc(rw.text)}</span><em>${esc(rw.value)}</em></div>`).join('')
      + (hot ? '<small>Click the line to open its time card</small>' : '');
    tip.hidden = false;
    const bw = plotBox.clientWidth; const tw = tip.offsetWidth;
    const sx = (x(k) * r.width) / W;
    tip.style.left = Math.max(0, Math.min(bw - tw, sx > bw / 2 ? sx - tw - 14 : sx + 14)) + 'px';
    tip.style.top = '4px';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); setHot(null); });
  hit.addEventListener('click', (ev) => {
    if (!hot) return;
    if (ev.pointerType === 'mouse' || lastTap === hot) cfg.onOpen(hot);
    else lastTap = hot;
  });

  if (cfg.note) {
    const nt = document.createElement('p'); nt.className = 'viz-note'; nt.textContent = cfg.note; wrap.appendChild(nt);
  }
}

// Two charts (position, gap) plus legend for one group of cars.
function renderGraphs(host, cars, opts) {
  const res = state.data.results;
  const n = res.lastStage;
  const prog = progression(cars, n);
  const byCar = {}; prog.forEach((p) => { byCar[p.r.car] = p; });
  const colorOf = opts.colorOf;

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = opts.legend.map((l) => `<span><i class="sw line" style="background:${l.color || 'var(--line-muted)'}"></i>${esc(l.text)}</span>`).join('')
    + (opts.legendNote ? `<span>${esc(opts.legendNote)}</span>` : '');
  host.appendChild(legend);

  const grid = document.createElement('div');
  grid.className = 'viz-grid';
  host.appendChild(grid);

  const rows = (k) => prog.filter((p) => p.pos[k] != null).sort((a, b) => a.pos[k] - b.pos[k]).map((p) => ({
    id: p.r.car, color: colorOf(p.r),
    text: `P${p.pos[k]}  #${p.r.car} ${surname(p.r.driver)}`,
    value: p.gap[k] ? '+' + fmtDur(p.gap[k]) : 'leader',
  }));
  const common = { n, selected: state.car, onOpen: opts.onOpen };
  const labelOf = (p) => '#' + p.r.car;

  // Position
  const maxPos = Math.max(1, ...prog.map((p) => Math.max(0, ...p.pos.filter((v) => v != null))));
  const pStep = Math.max(1, Math.ceil(maxPos / 8));
  const pTicks = []; for (let v = 1; v <= maxPos; v += pStep) pTicks.push(v);
  if (pTicks[pTicks.length - 1] !== maxPos) pTicks.push(maxPos);
  lineChart(grid, {
    ...common, title: 'Position after each stage', sub: 'P1 at the top',
    series: prog.map((p) => ({ id: p.r.car, color: colorOf(p.r), label: labelOf(p), vals: p.pos })),
    yMin: 1, yMax: Math.max(2, maxPos), yTicks: pTicks, yFmt: (v) => 'P' + v, rows,
  });

  // Time behind the leader, zoomed past far-off-the-pace cars unless "Full range" is on
  const gaps = prog.flatMap((p) => p.gap.filter((v) => v != null)).sort((a, b) => a - b);
  const maxGap = gaps.length ? gaps[gaps.length - 1] : 0;
  let yMax = maxGap; let note = '';
  if (!state.fullRange && gaps.length >= 4) {
    const p75 = gaps[Math.floor(0.75 * (gaps.length - 1))];
    const zoom = Math.max(60, Math.ceil((p75 * 1.5) / 60) * 60);
    if (zoom < maxGap) {
      yMax = zoom;
      const off = prog.filter((p) => p.gap.some((v) => v != null && v > zoom)).map((p) => '#' + p.r.car);
      note = `Zoomed to +${fmtGapTick(zoom).slice(1)}: ${off.join(', ')} ${off.length === 1 ? 'goes' : 'go'} off the scale. Tick "Full range" to see all.`;
    }
  }
  const gStep = niceStep(Math.max(yMax, 1), 6, GAP_STEPS);
  yMax = Math.max(gStep, Math.ceil(yMax / gStep) * gStep);
  const gTicks = []; for (let v = 0; v <= yMax; v += gStep) gTicks.push(v);
  lineChart(grid, {
    ...common, title: 'Time behind the leader', sub: 'cumulative, after each stage',
    series: prog.map((p) => ({ id: p.r.car, color: colorOf(p.r), label: labelOf(p), vals: p.gap })),
    yMin: 0, yMax, yTicks: gTicks, yFmt: fmtGapTick, rows, note,
  });
  return byCar;
}

function renderOverallGraph(host) {
  const res = state.data.results;
  const useColor = res.classes.length <= MAX_COLORS;
  const colorOf = (r) => (useColor && r.cls ? `var(--s${res.classes.indexOf(r.cls) + 1})` : null);
  renderGraphs(host, res.list, {
    colorOf,
    legend: useColor ? res.classes.map((c) => ({ text: 'Class ' + c, color: `var(--s${res.classes.indexOf(c) + 1})` })) : [],
    legendNote: useColor ? 'Lines colored by class, labeled with car #' : 'Hover a line or enter a car # to highlight it',
    onOpen: openCard,
  });
}

function renderClassGraph(host, cls) {
  const res = state.data.results;
  // Color follows the car (sorted by car #), never its current position
  const cars = res.list.filter((r) => r.cls === cls).sort((a, b) => Number(a.car) - Number(b.car) || a.car.localeCompare(b.car));
  const useColor = cars.length <= MAX_COLORS;
  const slot = {}; cars.forEach((r, i) => { slot[r.car] = i + 1; });
  const colorOf = (r) => (useColor ? `var(--s${slot[r.car]})` : null);
  renderGraphs(host, cars, {
    colorOf,
    legend: useColor ? cars.map((r) => ({ text: `#${r.car} ${r.driver}`, color: colorOf(r) })) : [],
    legendNote: useColor ? '' : 'Hover a line or enter a car # to highlight it',
    onOpen: openCard,
  });
}
