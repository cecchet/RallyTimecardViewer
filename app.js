'use strict';

// Events from events.js, newest first; the newest loads when no ?sheet= is given.
const EVENT_LIST = (typeof EVENTS !== 'undefined' ? EVENTS : [])
  .map((e) => ({ name: e.name, id: sheetIdFrom(e.sheet) }))
  .filter((e) => e.id)
  .sort((a, b) => b.name.localeCompare(a.name));
const DEFAULT_SHEET = EVENT_LIST.length ? EVENT_LIST[0].id : '';
const eventName = (id) => (EVENT_LIST.find((e) => e.id === id) || {}).name || '';
const TIMING_SHEET = 'First Entry - TIMING ONLY';
const SUMMARY_SHEET = 'Summary - TIMING ONLY';
const NSTAGES = 12;          // stages on the 3 time cards
const STAGES_PER_CARD = 4;
const REFRESH_MS = 60000;

const $ = (id) => document.getElementById(id);
const state = { sheetId: '', data: null, car: '', card: 1, tab: 'card', cls: '', timer: null };

/* ---------------- storage (optional convenience) ---------------- */
function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
}

/* ---------------- CSV ---------------- */
function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

async function fetchSheet(id, name) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent(name)}&t=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Could not read "${name}" (HTTP ${r.status}). Is the sheet shared as "Anyone with the link"?`);
  const txt = await r.text();
  if (/^\s*</.test(txt)) throw new Error('Google returned a sign-in page. Share the spreadsheet as "Anyone with the link can view".');
  return parseCSV(txt);
}

function sheetIdFrom(s) {
  s = (s || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

/* ---------------- value helpers ---------------- */
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
function num(s) {
  s = String(s ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
// "0:05:09.70" | "5:09.7" | "0:00:40" -> seconds
function dur(s) {
  s = String(s ?? '').trim();
  if (!s || !/^\d/.test(s)) return null;
  const p = s.split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return null;
  return p.reduce((acc, x) => acc * 60 + x, 0);
}
const tenths = (sec) => Math.round(sec * 10);
function fmtDur(sec, forceHours) {
  if (sec == null) return '';
  const neg = sec < 0; let t = Math.abs(tenths(sec));
  const d = t % 10; t = (t - d) / 10;
  const s = t % 60; t = (t - s) / 60;
  const m = t % 60; const h = (t - m) / 60;
  const ss = String(s).padStart(2, '0') + '.' + d;
  const out = h || forceHours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return (neg ? '-' : '') + out;
}
function hmParts(minOfDay) {
  if (minOfDay == null) return [null, null];
  const m = ((minOfDay % 1440) + 1440) % 1440;
  return [String(Math.floor(m / 60)), String(m % 60).padStart(2, '0')];
}
const fmtHM = (m) => (m == null ? '' : hmParts(m).join(':'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- parse the timing sheet ---------------- */
const TOP_LABELS = { 'dnf penalty': 'dnf', 'bogey': 'bogey', 'transit': 'transit' };
const BLOCK_LABELS = new Set(['atc in hr', 'atc in min', 'start hr', 'start min', 'finish hr', 'finish min', 'finish sec',
  'atc min diff', 'atc penalty', 'chicane penalty', 'time penalty m:s', 'time']);
const isCar = (s) => /^\d+[A-Za-z]?$/.test(String(s || '').trim());

function parseTiming(rows) {
  const cfg = { dnf: [], bogey: [], transit: [] };
  const cars = []; let cur = null;
  for (const r of rows) {
    const li = r.findIndex((c) => TOP_LABELS[norm(c)] || BLOCK_LABELS.has(norm(c)));
    if (li < 0) continue;
    const key = norm(r[li]);
    const vals = r.slice(li + 1, li + 1 + NSTAGES);
    if (TOP_LABELS[key]) { if (!cars.length) cfg[TOP_LABELS[key]] = vals.map(num); continue; }
    if (key === 'atc in hr') { cur = { rows: {}, car: '' }; cars.push(cur); }
    if (!cur) continue;
    cur.rows[key] = vals;
    if (!cur.car) cur.car = [r[1], r[li - 1]].map((x) => String(x || '').trim()).find(isCar) || '';
    if (key === 'time') {
      cur.cls = String(r[2] || '').trim();
      cur.total = dur(r[4]) ?? dur(r[li + 1 + NSTAGES + 5]);
      cur = null;
    }
  }
  return { cfg, cars: cars.filter((c) => c.car) };
}

function parseSummary(rows) {
  const names = {};
  for (const r of rows) {
    const car = String(r[1] || '').trim();
    if (!isCar(car) || names[car]) continue;
    const driver = String(r[5] || '').trim();
    if (!driver || driver === 'Driver') continue;
    names[car] = { driver, codriver: String(r[6] || '').trim().replace(/[“”]/g, '"'), cls: String(r[3] || '').trim() };
  }
  return names;
}

// Everything the time card and results need for one stage of one car.
function stageInfo(car, cfg, i) {
  const g = (k) => (car.rows[k] || [])[i];
  const hm = (h, m) => (num(h) == null || num(m) == null ? null : num(h) * 60 + num(m));
  const atcIn = hm(g('atc in hr'), g('atc in min'));
  const start = hm(g('start hr'), g('start min'));
  const finMin = hm(g('finish hr'), g('finish min'));
  const finSec = num(g('finish sec'));
  const finish = finMin == null ? null : finMin * 60 + (finSec || 0);
  const bogey = cfg.bogey[i], transit = cfg.transit[i], dnfPen = cfg.dnf[i];
  let stage = null, startTransit = null, atcDue = null;
  if (start != null && finish != null) {
    stage = finish - start * 60;
    if (stage < 0) stage += 86400;
    const stageMins = Math.floor(stage / 60 + 1e-9);
    if (bogey != null) {
      startTransit = start + Math.max(bogey, stageMins);
      if (transit != null) atcDue = startTransit + transit;
    }
  }
  const scored = dur(g('time'));
  const penalty = dur(g('time penalty m:s')) || 0;
  const atcDiff = num(g('atc min diff'));
  const didRun = scored != null && scored > 0;
  const dnf = didRun && (start == null || finish == null);
  return { i, atcIn, start, finish, finSec, bogey, transit, dnfPen, stage, startTransit, atcDue, scored, penalty, atcDiff, didRun, dnf };
}

/* ---------------- results ---------------- */
function buildResults(data) {
  const { cfg, cars } = data.timing;
  const list = cars.map((c) => {
    const st = []; for (let i = 0; i < NSTAGES; i++) st.push(stageInfo(c, cfg, i));
    const n = data.names[c.car] || {};
    const done = st.filter((s) => s.didRun).length;
    const sum = st.reduce((a, s) => a + (s.didRun ? s.scored : 0), 0);
    const total = c.total && c.total > 0 ? c.total : sum;
    return { car: c.car, cls: c.cls && c.cls !== '#N/A' ? c.cls : (n.cls || ''), driver: n.driver || '', codriver: n.codriver || '', stages: st, done, total, raw: c };
  });
  let lastStage = 0;
  list.forEach((r) => r.stages.forEach((s) => { if (s.didRun) lastStage = Math.max(lastStage, s.i + 1); }));
  // Fastest real (not max-time) scored time per stage among the given cars
  const bestOf = (cars) => Array.from({ length: NSTAGES }, (_, i) => {
    const t = cars.map((r) => r.stages[i]).filter((s) => s.didRun && !s.dnf).map((s) => s.scored);
    return t.length ? Math.min(...t) : null;
  });
  const best = bestOf(list);
  const rank = (arr) => {
    const sorted = arr.slice().sort((a, b) => (b.done - a.done) || (a.done ? a.total - b.total : 0) || (Number(a.car) - Number(b.car)));
    let pos = 0;
    return sorted.map((r, k) => {
      if (r.done) pos = k + 1;
      const lead = sorted[0];
      const prev = sorted[k - 1];
      return {
        r, pos: r.done ? pos : null,
        gap: r.done && lead.done === r.done && k > 0 ? r.total - lead.total : null,
        diff: r.done && prev && prev.done === r.done ? r.total - prev.total : null,
      };
    });
  };
  const overall = rank(list);
  const classes = [...new Set(list.map((r) => r.cls).filter(Boolean))].sort();
  const byClass = {};
  const classBest = {};
  classes.forEach((c) => {
    const cars = list.filter((r) => r.cls === c);
    byClass[c] = rank(cars);
    classBest[c] = bestOf(cars);
  });
  const posOf = {}; overall.forEach((x) => { posOf[x.r.car] = { overall: x.pos }; });
  classes.forEach((c) => byClass[c].forEach((x) => { posOf[x.r.car].cls = x.pos; posOf[x.r.car].clsCount = byClass[c].length; }));
  return { list, overall, classes, byClass, best, classBest, lastStage, posOf };
}

/* ---------------- time card rendering ---------------- */
function cellsHtml(cells) {
  return `<div class="cells">${cells.map(([v, u, wide]) =>
    `<div class="cell${wide ? ' wide' : ''}"><span class="v pen">${v == null ? '' : esc(v)}</span><span class="u">${u}</span></div>`).join('')}</div>`;
}
function box(label, cells, foot, extra = '') {
  return `<div class="bx ${extra}"><span class="lb">${label}</span>${cellsHtml(cells)}<span class="ft">${foot || ''}</span></div>`;
}
function secParts(sec) {
  if (sec == null) return [null, null];
  const t = tenths(sec); const m = Math.floor(t / 600); const s = (t - m * 600) / 10;
  return [String(m), s.toFixed(1).padStart(4, '0')];
}

function renderStage(s, next) {
  const [aH, aM] = hmParts(s.atcIn);
  const [sH, sM] = hmParts(s.start);
  const [fH, fM] = s.finish == null ? [null, null] : hmParts(Math.floor(s.finish / 60));
  const fS = s.finish == null ? null : (s.finish % 60).toFixed(1);
  const [stM, stS] = secParts(s.stage);
  const [tH, tM] = hmParts(s.startTransit);
  const [dH, dM] = hmParts(s.atcDue);
  const n = s.i + 1;

  const notes = [];
  if (s.dnf) notes.push(`<span class="dnf">No start/finish recorded — scored ${fmtDur(s.scored)} (bogey ${s.bogey ?? '?'} + ${s.dnfPen ?? '?'} min)</span>`);
  if (next && s.atcDue != null && next.atcIn != null) {
    const d = next.atcIn - s.atcDue;
    const lbl = `ATC ${n + 1} IN ${fmtHM(next.atcIn)}`;
    if (d === 0) notes.push(`<span class="ok">${lbl} — on time</span>`);
    else if (d > 0) notes.push(`<span class="late">${lbl} — ${d} min late</span>`);
    else notes.push(`<span class="early">${lbl} — ${-d} min early</span>`);
  }
  if (!s.dnf && s.didRun && s.stage != null && s.scored < s.stage - 0.05) notes.push(`<span class="early">Scored time capped at ${fmtDur(s.scored)} (actual ${fmtDur(s.stage)})</span>`);
  if (s.penalty > 0) notes.push(`<span class="late">Time penalty ${fmtDur(s.penalty)}</span>`);
  if (s.didRun) notes.push(`<span class="scored">Scored stage time: <span class="pen">${fmtDur(s.scored)}</span></span>`);
  else if (s.start == null && s.finish == null) notes.push('<span class="scored" style="color:#777">Not run yet</span>');

  return `<div class="ss">
    <div class="ss-row">
      <div class="ss-id"><b>SS ${n}</b><span>Bogey: ${s.bogey ?? '–'}</span><span>Transit: ${s.transit ?? '–'}</span></div>
      ${box(`ATC ${n} IN`, [[aH, 'H'], [aM, 'M']], 'Control Use')}
      ${box('Actual Start', [[sH, 'H'], [sM, 'M']], 'Control Use')}
      ${box('Finish', [[fH, 'H'], [fM, 'M'], [fS, 'S.1/10', true]], 'Control Use')}
      ${box('Bogey', [[s.bogey, 'Min']], '', 'pre')}
      <div class="comp">
        ${box('Stage Time', [[stM, 'M'], [stS, 'S.1/10', true]], 'Competitor Use')}
        ${box('Start Transit', [[tH, 'H'], [tM, 'M']], 'Competitor Use')}
        ${box('Transit', [[s.transit, 'Min']], '', 'pre')}
        ${box(`ATC ${n + 1} IN`, [[dH, 'H'], [dM, 'M']], 'Competitor Use')}
      </div>
    </div>
    ${notes.length ? `<div class="ss-note">${notes.join('')}</div>` : ''}
  </div>`;
}

function renderCard() {
  const out = $('cardOut');
  if (!state.data) { out.innerHTML = '<div class="msg">Load a timing spreadsheet to begin.</div>'; return; }
  const car = state.car.trim();
  if (!car) { out.innerHTML = '<div class="msg">Enter a car number to see its time card.</div>'; return; }
  const res = state.data.results;
  const matches = res.list.filter((r) => r.car === car);
  if (!matches.length) { out.innerHTML = `<div class="msg">Car #${esc(car)} is not in the timing sheet.</div>`; return; }
  out.innerHTML = matches.map((r) => {
    const first = (state.card - 1) * STAGES_PER_CARD;
    const st = r.stages.slice(first, first + STAGES_PER_CARD);
    const cardSum = st.reduce((a, s) => a + (s.didRun ? s.scored : 0), 0);
    const cardPen = st.reduce((a, s) => a + s.penalty, 0);
    const pos = res.posOf[r.car] || {};
    const rows = st.map((s, k) => renderStage(s, r.stages[first + k + 1])).join('');
    return `
      <div class="crew">
        <strong>#${esc(r.car)} ${esc(r.driver)}${r.codriver ? ' / ' + esc(r.codriver) : ''}</strong>
        ${r.cls ? `<span class="pill">Class ${esc(r.cls)}</span>` : ''}
        ${pos.overall ? `<span class="pill">P${pos.overall} overall</span>` : ''}
        ${pos.cls ? `<span class="pill">P${pos.cls} of ${pos.clsCount} in class</span>` : ''}
      </div>
      <div class="tc">
        <div class="tc-head">
          <span class="ev">${esc(state.data.title || 'Rally time card')}</span>
          <span class="cardno">Card ${state.card} · SS ${first + 1}–${first + STAGES_PER_CARD}</span>
          <span class="carno">CAR # <span class="pen">${esc(r.car)}</span></span>
        </div>
        ${rows}
        <div class="tc-foot">
          <div class="totals">
            <div><span class="muted">This card</span><span class="pen">${cardSum ? fmtDur(cardSum) : '–'}</span></div>
            <div><span class="muted">Penalties</span><span class="pen">${cardPen ? fmtDur(cardPen) : '–'}</span></div>
            <div><span class="muted">Rally total (${r.done} SS)</span><span class="pen">${r.done ? fmtDur(r.total, true) : '–'}</span></div>
          </div>
          <span class="muted">Stage time and ATC due are computed: actual start + max(bogey, stage minutes) + transit.</span>
        </div>
      </div>`;
  }).join('<div style="height:20px"></div>');
}

/* ---------------- results rendering ---------------- */
// classBest: per-stage fastest in class, highlighted when not also the overall fastest
function resultsTable(ranked, withClass, classBest) {
  const res = state.data.results;
  const n = Math.max(res.lastStage, 1);
  const head = `<tr><th class="l sticky">Pos</th><th class="l">Car</th><th class="l">Crew</th>${withClass ? '<th class="l">Class</th>' : ''}
    ${Array.from({ length: n }, (_, i) => `<th>SS${i + 1}</th>`).join('')}<th>SS</th><th>Total</th><th>Gap</th><th>Diff</th></tr>`;
  const body = ranked.map(({ r, pos, gap, diff }) => {
    const cells = r.stages.slice(0, n).map((s) => {
      if (!s.didRun) return '<td class="gap">–</td>';
      const isBest = !s.dnf && s.scored === res.best[s.i];
      const isClassBest = !isBest && classBest && !s.dnf && s.scored === classBest[s.i];
      const cls = [s.dnf || s.penalty > 0 ? 'pen-t' : '', isBest ? 'best' : '', isClassBest ? 'cbest' : ''].join(' ').trim();
      const title = s.dnf ? 'No start/finish recorded (max time)' : s.penalty > 0 ? `Includes ${fmtDur(s.penalty)} penalty`
        : isBest ? 'Fastest overall' : isClassBest ? 'Fastest in class' : '';
      return `<td class="${cls}"${title ? ` title="${title}"` : ''}>${fmtDur(s.scored)}${s.dnf ? '*' : ''}</td>`;
    }).join('');
    return `<tr data-car="${esc(r.car)}"><td class="pos sticky">${pos ?? '–'}</td><td class="l car">${esc(r.car)}</td>
      <td class="l crewcell">${esc(r.driver)}${r.codriver ? `<br><small>${esc(r.codriver)}</small>` : ''}</td>
      ${withClass ? `<td class="l">${esc(r.cls)}</td>` : ''}${cells}
      <td>${r.done}</td><td class="tot">${r.done ? fmtDur(r.total, true) : '–'}</td>
      <td class="gap">${gap != null ? '+' + fmtDur(gap) : ''}</td><td class="gap">${diff != null ? '+' + fmtDur(diff) : ''}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table class="res"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function noDataMsg() {
  return '<div class="msg">No stage times in the spreadsheet yet. Results appear here as soon as timing data is entered.</div>';
}

function renderOverall() {
  const out = $('overallOut');
  if (!state.data) { out.innerHTML = '<div class="msg">Load a timing spreadsheet to begin.</div>'; return; }
  const res = state.data.results;
  out.innerHTML = `<div class="res-title"><h2>Overall</h2><span>${res.list.length} cars${res.lastStage ? ` · after SS${res.lastStage}` : ''} · fastest stage times highlighted · * = max time</span></div>`
    + (res.lastStage ? resultsTable(res.overall, true) : noDataMsg());
}

function renderClass() {
  const out = $('classOut'); const chips = $('classChips');
  if (!state.data) { out.innerHTML = '<div class="msg">Load a timing spreadsheet to begin.</div>'; chips.innerHTML = ''; return; }
  const res = state.data.results;
  if (state.cls && !res.classes.includes(state.cls)) state.cls = '';
  chips.innerHTML = ['', ...res.classes].map((c) =>
    `<button type="button" data-cls="${esc(c)}" aria-pressed="${state.cls === c}">${c ? esc(c) : 'All classes'}</button>`).join('');
  if (!res.lastStage) { out.innerHTML = noDataMsg(); return; }
  const shown = state.cls ? [state.cls] : res.classes;
  out.innerHTML = '<div class="legend"><span><i class="sw best"></i>Fastest overall</span><span><i class="sw cbest"></i>Fastest in class</span><span>* = max time</span></div>'
    + shown.map((c) => `<div class="res-title"><h2>Class ${esc(c)}</h2><span>${res.byClass[c].length} cars</span></div>`
      + resultsTable(res.byClass[c], false, res.classBest[c])).join('');
}

function renderAll() {
  renderCard(); renderOverall(); renderClass();
  const dl = $('carList');
  dl.innerHTML = state.data ? state.data.results.list.map((r) => `<option value="${esc(r.car)}">${esc(r.driver)}</option>`).join('') : '';
}

/* ---------------- state / URL ---------------- */
function syncUrl() {
  const p = new URLSearchParams();
  if (state.sheetId && state.sheetId !== DEFAULT_SHEET) p.set('sheet', state.sheetId);
  if (state.tab !== 'card') p.set('tab', state.tab);
  if (state.car) p.set('car', state.car);
  if (state.card !== 1) p.set('card', state.card);
  if (state.cls) p.set('class', state.cls);
  history.replaceState(null, '', p.toString() ? '?' + p : location.pathname);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ['card', 'overall', 'class'].forEach((t) => { $('tab-' + t).hidden = t !== tab; });
  syncUrl();
}
function setCard(n) {
  state.card = n;
  document.querySelectorAll('#cardSeg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.card) === n)));
  renderCard(); syncUrl();
}

// Reflect the current sheet in the event dropdown and the link box
function showSheet(id) {
  $('eventSelect').value = EVENT_LIST.some((e) => e.id === id) ? id : '';
  $('sheetInput').value = id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}

function setStatus(msg, err) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }

async function load(quiet) {
  if (!state.sheetId) { setStatus('Enter a spreadsheet link', true); return; }
  if (!quiet) setStatus('Loading…');
  try {
    const [timingRows, summaryRows] = await Promise.all([
      fetchSheet(state.sheetId, TIMING_SHEET),
      fetchSheet(state.sheetId, SUMMARY_SHEET).catch(() => []),
    ]);
    const timing = parseTiming(timingRows);
    if (!timing.cars.length) throw new Error(`No car blocks found in the "${TIMING_SHEET}" tab.`);
    const data = { timing, names: parseSummary(summaryRows), title: new URLSearchParams(location.search).get('title') || eventName(state.sheetId) };
    data.results = buildResults(data);
    state.data = data;
    renderAll();
    setStatus(`${timing.cars.length} cars · updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setStatus(e.message || String(e), true);
    if (!state.data) renderAll();
  }
}

function setAutoRefresh(on) {
  clearInterval(state.timer); state.timer = null;
  if (on) state.timer = setInterval(() => load(true), REFRESH_MS);
  store('rtv.auto', on ? '1' : '0');
}

function init() {
  const p = new URLSearchParams(location.search);
  state.sheetId = sheetIdFrom(p.get('sheet')) || DEFAULT_SHEET;
  state.car = (p.get('car') || '').trim();
  state.card = Math.min(3, Math.max(1, Number(p.get('card')) || 1));
  state.cls = p.get('class') || '';
  $('eventSelect').innerHTML = EVENT_LIST.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')
    + '<option value="">Other spreadsheet (paste link below)</option>';
  showSheet(state.sheetId);
  $('carInput').value = state.car;
  setTab(['card', 'overall', 'class'].includes(p.get('tab')) ? p.get('tab') : 'card');
  setCard(state.card);

  $('sourceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = sheetIdFrom($('sheetInput').value);
    if (!id) { setStatus('That does not look like a Google Sheets link', true); return; }
    state.sheetId = id; showSheet(id); syncUrl(); load();
  });
  $('eventSelect').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) { $('sheetInput').value = ''; $('sheetInput').focus(); return; }
    state.sheetId = id; showSheet(id); syncUrl(); load();
  });
  $('cardForm').addEventListener('submit', (e) => e.preventDefault());
  $('carInput').addEventListener('input', (e) => { state.car = e.target.value.trim(); renderCard(); syncUrl(); });
  $('cardSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setCard(Number(b.dataset.card)); });
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('classChips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.cls = b.dataset.cls; renderClass(); syncUrl();
  });
  // Clicking a results row opens that car's time card
  document.querySelectorAll('#overallOut, #classOut').forEach((el) => el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-car]'); if (!tr) return;
    state.car = tr.dataset.car; $('carInput').value = state.car;
    renderCard(); setTab('card'); window.scrollTo(0, 0);
  }));
  const auto = store('rtv.auto') === '1';
  $('autoRefresh').checked = auto;
  $('autoRefresh').addEventListener('change', (e) => setAutoRefresh(e.target.checked));
  setAutoRefresh(auto);
  renderAll();
  load();
}

init();
