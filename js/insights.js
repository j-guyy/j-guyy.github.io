// Dashboard insights: the app Dashboard's at-a-glance charts.
//
// strava.js calls renderInsights(filtered) from applyFilters() whenever the
// activity list or the Dashboard's sport / year filters change; it draws into
// #strava-insights when the page has that mount point (the app's Dashboard
// and strava.html) and does nothing otherwise. Charts are hand-written SVG —
// no chart library.
//
// Every chart follows the sport and year filters, and each card that looks at
// one year has its own year picker covering every year with activities.
//
// Cards, top to bottom:
//   1. One year vs another (default this year vs last, to the same date)
//   2. Year pace: cumulative totals, one line per year (every year shown by
//      default; the legend chips hide / show each)
//   3. Year by year bars (activities / distance / hours / climbing)
//   4. Sport mix donut, for any one year or all of them
//   5. Consistency calendar (last 12 months or any year) + streaks
//   6. Eddington numbers (ride + run, in miles), all time or any year
//   7. Best Efforts: top 5 longest distance / time / climbing per sport,
//      all time or any year
//   8. Goal progress bars from the worker's /summary and travel lists
// Eddington, Best Efforts and Goals ignore the filters (their sport groups
// are fixed, and their year picker is their own).
//
// Only GPS activities are stored by the worker, so indoor activities without
// a route don't appear in any of these.

const INS_M_PER_MI = 1609.344;
const INS_FT_PER_M = 3.28084;
const INS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Sport families for the donut, in a fixed order so each keeps its colour
// whatever the filter (colours are the validated dark categorical slots).
const INS_FAMILIES = [
    { key: 'Run',   color: '#3987e5', types: ['Run', 'TrailRun', 'VirtualRun'] },
    { key: 'Ride',  color: '#d95926', types: ['Ride', 'GravelRide', 'EBikeRide', 'VirtualRide', 'MountainBikeRide', 'Handcycle', 'Velomobile'] },
    { key: 'Hike',  color: '#199e70', types: ['Hike', 'Snowshoe'] },
    { key: 'Walk',  color: '#c98500', types: ['Walk'] },
    { key: 'Ski',   color: '#d55181', types: ['AlpineSki', 'BackcountrySki', 'NordicSki', 'Snowboard', 'Snowkite'] },
    { key: 'Water', color: '#008300', types: ['Swim', 'OpenWaterSwim', 'Kayaking', 'Rowing', 'Surfing', 'Windsurf', 'Kitesurf', 'Canoeing', 'StandUpPaddling', 'Sail'] },
    { key: 'Other', color: '#9085e9', types: [] },
];

// Eddington: outdoor human-powered efforts only (no e-bike, no trainer).
const INS_EDDINGTON = [
    { key: 'ride', label: '🚴 Ride', types: ['Ride', 'GravelRide', 'MountainBikeRide'] },
    { key: 'run',  label: '🏃 Run',  types: ['Run', 'TrailRun'] },
];

// What the charts measure, picked by the dashboard's Activities / Miles /
// Hours / Climbing toggle (dashboardMetric in strava.js).
const INS_METRICS = {
    count: { label: 'Activities', noun: 'activities',   unit: '',   val: () => 1 },
    dist:  { label: 'Miles',      noun: 'miles',        unit: 'mi', val: a => (a.di || 0) / INS_M_PER_MI },
    hours: { label: 'Hours',      noun: 'moving time',  unit: 'h',  val: a => (a.m || 0) / 3600 },
    elev:  { label: 'Climbing',   noun: 'climbing',     unit: 'ft', val: a => (a.e || 0) * INS_FT_PER_M },
};

function insMetric() {
    const key = typeof dashboardMetric !== 'undefined' && INS_METRICS[dashboardMetric] ? dashboardMetric : 'dist';
    return { key, ...INS_METRICS[key] };
}

// "1,234 mi", "1,234 h", "56 activities"
function insWithUnit(v, m, short = false) {
    const n = short ? insShort(v) : insFmt(v);
    return m.unit ? `${n} ${m.unit}` : `${n} ${m.noun}`;
}

// Best Efforts: the sports, and what is ranked for each.
const INS_BEST_SPORTS = [
    { key: 'run',    label: '🏃 Run',             types: ['Run', 'TrailRun'] },
    { key: 'ride',   label: '🚴 Ride',            types: ['Ride', 'GravelRide', 'MountainBikeRide'] },
    { key: 'hike',   label: '🥾 Hike',            types: ['Hike'] },
    { key: 'nordic', label: '⛷️ Nordic ski',      types: ['NordicSki'] },
    { key: 'bc',     label: '🏔️ Backcountry ski', types: ['BackcountrySki'] },
];
const INS_BEST_CATS = [
    { key: 'dist', label: 'Longest distance', val: a => (a.di || 0) / INS_M_PER_MI },
    { key: 'time', label: 'Longest time',     val: a => a.m || 0 },
    { key: 'elev', label: 'Most climbing',    val: a => (a.e || 0) * INS_FT_PER_M },
];
const INS_BEST_TOP = 5;

const insState = {
    donutYear: null,      // null = this year; 'all' = every year in the filter
    compareA: null,       // years compared in card 1 (null = this year / the one before)
    compareB: null,
    paceHidden: new Set(),// years switched off in the pace chart's legend
    calYear: 'last',      // 'last' = last 12 months, or a year
    eddYear: 'all',
    bestYear: null,       // null = this year (or all time when it has none)
    bestSport: 'run',
    goals: null,          // loaded once from the worker
    goalsLoading: false,
    lastFiltered: [],
};

function insEsc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function insFmt(n, digits = 0) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

// Compact axis numbers: 1200 → 1.2k
function insShort(n) {
    if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
    return String(Math.round(n));
}

function insTodayParts() {
    const now = new Date();
    const y = now.getFullYear();
    const iso = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { year: y, iso, md: iso.slice(5) };
}

function insDayOfYear(iso) {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((d - start) / 86400000); // 0-based
}

function insAddDays(iso, n) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function insFamily(type) {
    return INS_FAMILIES.find(f => f.types.includes(type)) || INS_FAMILIES[INS_FAMILIES.length - 1];
}

// Totals for a list of activities.
function insTotals(list) {
    const days = new Set();
    let dist = 0, sec = 0, elev = 0;
    list.forEach(a => {
        dist += a.di || 0;
        sec += a.m || 0;
        elev += a.e || 0;
        if (a.d) days.add(a.d.slice(0, 10));
    });
    return { count: list.length, mi: dist / INS_M_PER_MI, hours: sec / 3600, ft: elev * INS_FT_PER_M, days: days.size };
}

// ── Entry point ────────────────────────────────────────────────────────────
function renderInsights(filtered) {
    const mount = document.getElementById('strava-insights');
    if (!mount) return;
    insState.lastFiltered = filtered || [];
    const list = insState.lastFiltered.filter(a => a.d);
    if (!list.length && !(typeof currentSlim !== 'undefined' && currentSlim.length)) {
        mount.innerHTML = '';
        return;
    }
    const today = insTodayParts();

    mount.innerHTML = [
        insCompareCard(list, today),
        insPaceCard(list, today),
        insYearsCard(list, today),
        insDonutCard(list, today),
        insCalendarCard(list, today),
        insEddingtonCard(today),
        insBestCard(today),
        insGoalsCard(),
    ].join('');

    insBindTooltips(mount);
    insRevealActivePills(mount);
    if (!insState.goals && !insState.goalsLoading) insLoadGoals();
}

function insCard(title, body, sub = '', id = '') {
    return `<section class="ins-card"${id ? ` id="${id}"` : ''}><header class="ins-card-head"><h2>${title}</h2>${sub ? `<span class="ins-card-sub">${sub}</span>` : ''}</header>${body}</section>`;
}

// Years with activities in a list, newest first.
function insYears(list) {
    return [...new Set(list.map(a => a.d.slice(0, 4)))].sort().reverse();
}

// Whether the Dashboard's year filter has any year switched off.
function insYearFiltered() {
    return typeof deactivatedYears !== 'undefined' && deactivatedYears.size > 0;
}

// A sideways-scrolling row of picker pills: options are [value, label]; a tap
// sets insState[key] to the value and redraws.
function insPills(key, options, sel) {
    const pills = options.map(([v, label]) =>
        `<button type="button" class="filter-pill ins-year-pill${v === sel ? ' active' : ''}" aria-pressed="${v === sel}" onclick="insSet('${key}', '${v}')">${label}</button>`).join('');
    return `<div class="ins-pills">${pills}</div>`;
}

// A year picker: an "all" option first, then every year, newest first.
function insYearPills(key, years, sel, allLabel = 'All time', allValue = 'all') {
    return insPills(key, [[allValue, allLabel], ...years.map(y => [y, y])], sel);
}

function insSet(key, value) {
    insState[key] = value;
    renderInsights(insState.lastFiltered);
}

// Each picker row was just redrawn scrolled to its start; bring its chosen
// pill into view so a pick far down the row stays visible.
function insRevealActivePills(root) {
    root.querySelectorAll('.ins-pills').forEach(row => {
        const pill = row.querySelector('.active');
        if (!pill || row.scrollWidth <= row.clientWidth) return;
        const off = pill.getBoundingClientRect().left - row.getBoundingClientRect().left;
        if (off + pill.offsetWidth > row.clientWidth - 24) row.scrollLeft = off - row.clientWidth / 2 + pill.offsetWidth / 2;
    });
}

// ── 1. One year vs another ─────────────────────────────────────────────────
function insCompareCard(list, today) {
    const years = insYears(list);
    if (!years.length) return '';
    const cy = String(today.year);
    let A = insState.compareA && years.includes(insState.compareA) ? insState.compareA : (years.includes(cy) ? cy : years[0]);
    let B = insState.compareB && years.includes(insState.compareB) && insState.compareB !== A ? insState.compareB : null;
    if (!B) B = years.includes(String(Number(A) - 1)) ? String(Number(A) - 1) : (years.find(y => y !== A) || null);
    // This year is compared to the same date in the other one; past years in full.
    const toDate = A === cy || B === cy;
    const pick = y => list.filter(a => a.d.startsWith(y) && (!toDate || a.d.slice(5, 10) <= today.md));
    const cur = insTotals(pick(A));
    const prev = B ? insTotals(pick(B)) : null;
    const metric = insMetric().key;
    const tiles = [
        ['count', 'Activities', 'count', ''],
        ['dist', 'Distance', 'mi', 'mi'],
        ['hours', 'Moving time', 'hours', 'h'],
        ['elev', 'Climbing', 'ft', 'ft'],
    ].map(([key, label, f, unit]) => {
        const v = cur[f], p = prev ? prev[f] : 0;
        let delta = `<span class="ins-delta">${B ? `no data in ${B}` : 'only one year in the filter'}</span>`;
        if (p > 0) {
            const pct = Math.round((v / p - 1) * 100);
            const cls = pct >= 0 ? 'up' : 'down';
            delta = `<span class="ins-delta ${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span> <span class="ins-delta-ref">vs ${insShort(p)}</span>`;
        }
        return `<div class="ins-tile${key === metric ? ' is-active' : ''}">
            <span class="ins-tile-label">${label}</span>
            <span class="ins-tile-value">${insShort(v)}${unit ? `<small> ${unit}</small>` : ''}</span>
            <span class="ins-tile-foot">${delta}</span>
        </div>`;
    }).join('');
    const select = (key, sel, skip) => `<select class="ins-select" aria-label="${key === 'compareA' ? 'Year' : 'Compared with'}" onchange="insSet('${key}', this.value)">${
        years.filter(y => y !== skip).map(y => `<option value="${y}"${y === sel ? ' selected' : ''}>${y}${y === cy ? ' so far' : ''}</option>`).join('')}</select>`;
    const picker = `<div class="ins-compare-pick">${select('compareA', A, null)}${B ? `<span>vs</span>${select('compareB', B, A)}` : ''}</div>`;
    return insCard(`${A}${A === cy ? ' so far' : ''}`, picker + `<div class="ins-tiles">${tiles}</div>`,
        B ? (toDate ? `vs ${B} to the same date` : `vs ${B}, full years`) : '');
}

// ── 2. Year pace lines ─────────────────────────────────────────────────────
// One cumulative line per year, every year by default. This year is the
// accent; earlier years are one blue, fading with age, so the newest stand
// out without needing a hue per year. Legend chips under the chart hide or
// show a year (and hovering one picks out its line).
const INS_PACE_BLUE = [57, 135, 229];

function insPaceColor(year, years, today) {
    if (year === today.year) return 'var(--ins-accent, #3ddc84)';
    const older = years.filter(y => y !== today.year);
    const k = older.indexOf(year);
    const op = older.length > 1 ? 0.95 - (k / (older.length - 1)) * 0.65 : 0.95;
    return `rgba(${INS_PACE_BLUE.join(',')},${op.toFixed(2)})`;
}

function insPaceCard(list, today) {
    const m = insMetric();
    const years = insYears(list).map(Number);
    if (!years.length) return '';
    const shown = years.filter(y => !insState.paceHidden.has(String(y)));
    const todayIdx = insDayOfYear(today.iso);
    // cumulative total per day of year (0..365)
    const series = shown.map(y => {
        const perDay = new Array(366).fill(0);
        list.forEach(a => { if (a.d.startsWith(String(y))) perDay[insDayOfYear(a.d)] += m.val(a); });
        const last = y === today.year ? todayIdx : 365;
        const cum = [];
        let run = 0;
        for (let i = 0; i <= last; i++) { run += perDay[i]; cum.push(run); }
        return cum;
    });
    const colors = shown.map(y => insPaceColor(y, years, today));

    const W = 340, H = 190, L = 34, R = 50, T = 10, B = 22;
    const max = Math.max(0, ...series.map(s => s[s.length - 1])) || 1;
    const yMax = insNiceMax(max);
    const x = i => L + (i / 365) * (W - L - R);
    const y = v => T + (1 - v / yMax) * (H - T - B);

    let grid = '';
    for (let k = 0; k <= 4; k++) {
        const v = (yMax / 4) * k;
        grid += `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
        grid += `<text class="ins-axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${insShort(v)}</text>`;
    }
    [0, 3, 6, 9].forEach(mo => {
        const idx = insDayOfYear(`${today.year}-${String(mo + 1).padStart(2, '0')}-01`);
        grid += `<text class="ins-axis" x="${x(idx)}" y="${H - 6}">${INS_MONTHS[mo]}</text>`;
    });

    // Direct labels only for this year and the year that finished highest,
    // so a dozen lines don't bury the chart in numbers.
    const ends = series.map(s => s[s.length - 1] || 0);
    const bestK = ends.indexOf(Math.max(...ends));
    const curK = shown.indexOf(today.year);
    const labelled = new Set([curK, bestK].filter(k => k >= 0 && ends[k] > 0));

    // Oldest first so newer years sit on top; this year last of all.
    const order = shown.map((_, k) => k).sort((a, b) => (shown[a] === today.year) - (shown[b] === today.year) || shown[a] - shown[b]);
    let lines = '', labels = '';
    const labelYs = [];
    order.forEach(k => {
        const s = series[k];
        if (!s.length || s[s.length - 1] <= 0) return;
        const pts = [];
        for (let i = 0; i < s.length; i += 2) pts.push(`${x(i).toFixed(1)},${y(s[i]).toFixed(1)}`);
        pts.push(`${x(s.length - 1).toFixed(1)},${y(s[s.length - 1]).toFixed(1)}`);
        const main = shown[k] === today.year;
        lines += `<polyline class="ins-line${main ? ' ins-line-main' : ''}" data-year="${shown[k]}" points="${pts.join(' ')}" stroke="${colors[k]}"/>`;
    });
    [...labelled].forEach(k => {
        const s = series[k];
        let ly = y(s[s.length - 1]) + 3;
        labelYs.forEach(o => { if (Math.abs(o - ly) < 11) ly = o + (ly >= o ? 11 : -11); });
        labelYs.push(ly);
        const main = shown[k] === today.year;
        const lx = main ? x(s.length - 1) + 4 : W - R + 4;
        labels += `<text class="ins-line-label" x="${lx}" y="${ly}" ${main ? 'style="font-weight:650"' : ''}>${shown[k]}</text>`;
    });
    // today marker
    const s0 = curK >= 0 ? series[curK] : [];
    const dot = s0.length && ends[curK] > 0 ? `<circle cx="${x(s0.length - 1)}" cy="${y(s0[s0.length - 1])}" r="4" fill="${colors[curK]}" stroke="var(--ins-surface, #131715)" stroke-width="2"/>` : '';

    let note = '';
    if (curK >= 0 && ends[curK] > 0) {
        const cur = ends[curK];
        const projected = cur / (todayIdx + 1) * 365;
        note = `On pace for <strong>${insWithUnit(projected, m)}</strong> in ${today.year}`;
        const atDate = series.map((s, k) => (k === curK ? cur : s[Math.min(todayIdx, s.length - 1)] || 0));
        if (shown.length > 1) {
            const rank = atDate.filter(v => v > cur).length + 1;
            note += ` · #${rank} of ${shown.length} years at this date`;
        }
        const prevK = shown.indexOf(today.year - 1);
        if (prevK >= 0 && atDate[prevK] > 0) {
            const diff = cur - atDate[prevK];
            note += ` · ${insWithUnit(Math.abs(diff), m)} ${diff >= 0 ? 'ahead of' : 'behind'} ${today.year - 1}`;
        }
    } else if (shown.length && ends[bestK] > 0) {
        note = `Best year shown: <strong>${shown[bestK]}</strong> with ${insWithUnit(ends[bestK], m)}`;
    } else {
        note = 'Pick a year below to draw its line.';
    }

    const data = JSON.stringify({ years: shown, colors, unit: m.unit || m.noun, series: series.map(s => s.map(v => Math.round(v))) });
    const svg = `<svg class="ins-svg ins-pace" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative ${m.noun} by day of year for ${shown.join(', ')}" data-pace='${insEsc(data)}' data-geom="${L},${R},${W}">
        ${grid}${lines}${dot}${labels}
        <line class="ins-crosshair" y1="${T}" y2="${H - B}" x1="0" x2="0" style="display:none"/>
    </svg>`;
    const chips = years.map(yr => {
        const on = !insState.paceHidden.has(String(yr));
        const color = insPaceColor(yr, years, today);
        return `<button type="button" class="ins-chip${on ? ' active' : ''}" aria-pressed="${on}" data-pace-year="${yr}" onclick="insTogglePaceYear('${yr}')"><span class="ins-swatch" style="background:${color}"></span>${yr}</button>`;
    }).join('');
    const allOn = shown.length === years.length;
    const legend = years.length > 1
        ? `<div class="ins-chips">${chips}<button type="button" class="ins-chip ins-chip-all" onclick="insSetPaceYears(${allOn ? 'false' : 'true'})">${allOn ? 'Hide all' : 'Show all'}</button></div>`
        : '';
    return insCard('Year pace', `${svg}${legend}<p class="ins-note">${note}</p>`, `cumulative ${m.noun}`);
}

function insTogglePaceYear(y) {
    if (insState.paceHidden.has(y)) insState.paceHidden.delete(y);
    else insState.paceHidden.add(y);
    renderInsights(insState.lastFiltered);
}

function insSetPaceYears(show) {
    insState.paceHidden.clear();
    if (!show) insYears(insState.lastFiltered.filter(a => a.d)).forEach(y => insState.paceHidden.add(y));
    renderInsights(insState.lastFiltered);
}

// Axis top for 4 gridlines at round steps (1, 2, 2.5 or 5 × 10ⁿ).
function insNiceMax(v) {
    const raw = Math.max(v, 1) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * p * 4;
}

// ── 3. Year by year ────────────────────────────────────────────────────────
function insYearsCard(list, today) {
    const byYear = {};
    list.forEach(a => {
        const y = a.d.slice(0, 4);
        const b = byYear[y] || (byYear[y] = { count: 0, dist: 0, hours: 0, elev: 0 });
        b.count++;
        b.dist += (a.di || 0) / INS_M_PER_MI;
        b.hours += (a.m || 0) / 3600;
        b.elev += (a.e || 0) * INS_FT_PER_M;
    });
    let years = Object.keys(byYear).sort();
    // Skip a nearly empty first year (an account opened in late autumn).
    if (years.length > 3 && byYear[years[0]].count < 5) years = years.slice(1);
    if (!years.length) return '';
    const m = insMetric();
    const metric = m.key;
    const vals = years.map(y => byYear[y][metric]);
    const max = Math.max(...vals) || 1;
    const yMax = insNiceMax(max);

    const W = 340, H = 170, L = 34, R = 6, T = 14, B = 20;
    const slot = (W - L - R) / years.length;
    const bw = Math.max(4, Math.min(26, slot - 4));
    const y = v => T + (1 - v / yMax) * (H - T - B);
    let grid = '';
    for (let k = 0; k <= 4; k++) {
        const v = (yMax / 4) * k;
        grid += `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
        grid += `<text class="ins-axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${insShort(v)}</text>`;
    }
    const maxIdx = vals.indexOf(max);
    let bars = '';
    years.forEach((yr, i) => {
        const v = vals[i];
        const cx = L + slot * i + slot / 2;
        const top = y(v);
        const h = Math.max(0, H - B - top);
        const isCur = Number(yr) === today.year;
        const r = Math.min(4, bw / 2, h);
        // rounded top, square base on the baseline
        const x0 = cx - bw / 2, x1 = cx + bw / 2, base = H - B;
        const path = h > 0
            ? `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`
            : '';
        const tip = `${yr}${isCur ? ' (so far)' : ''}: ${insWithUnit(v, m)}`;
        bars += `<g class="ins-hit" data-tip="${insEsc(tip)}">
            <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>
            ${path ? `<path d="${path}" class="ins-bar${isCur ? ' ins-bar-cur' : ''}"/>` : ''}
        </g>`;
        if (i === maxIdx || isCur) bars += `<text class="ins-bar-label" x="${cx}" y="${top - 4}" text-anchor="middle">${insShort(v)}</text>`;
        if (years.length <= 12 || i % 2 === (years.length - 1) % 2) {
            bars += `<text class="ins-axis" x="${cx}" y="${H - 6}" text-anchor="middle">'${yr.slice(2)}</text>`;
        }
    });
    const svg = `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${insEsc(m.label)} per year">${grid}${bars}</svg>`;
    return insCard('Year by year', svg, m.noun);
}

// ── 4. Sport mix donut ─────────────────────────────────────────────────────
function insDonutCard(list, today) {
    const years = insYears(list);
    if (!years.length) return '';
    let sel = insState.donutYear || String(today.year);
    if (sel !== 'all' && !years.includes(sel)) sel = years[0];
    const pool = sel === 'all' ? list : list.filter(a => a.d.startsWith(sel));
    // By the chosen metric; by activity count when it has nothing to show
    // (e.g. moving time before the worker stored it).
    let m = insMetric();
    if (!pool.some(a => m.val(a) > 0)) m = { key: 'count', ...INS_METRICS.count };
    const totals = new Map(INS_FAMILIES.map(f => [f.key, { v: 0, n: 0 }]));
    pool.forEach(a => {
        const t = totals.get(insFamily(a.t).key);
        t.v += m.val(a);
        t.n++;
    });
    const sum = [...totals.values()].reduce((s, t) => s + t.v, 0);
    const slices = INS_FAMILIES.filter(f => totals.get(f.key).v > 0)
        .map(f => ({ ...f, ...totals.get(f.key) }))
        .sort((a, b) => b.v - a.v);

    // Hovering a slice pops it out (--dx/--dy, along its middle) and shows it
    // in the centre (insDonutCentre); the ring leaves room for the pop.
    const R = 66, r = 44, C = 75, POP = 4;
    const unitWord = { count: 'activities', dist: 'miles', hours: 'hours', elev: 'feet' }[m.key];
    let angle = -Math.PI / 2;
    let arcs = '';
    const gap = slices.length > 1 ? 0.025 : 0; // 2px-ish surface gap between slices
    slices.forEach(s => {
        const frac = s.v / (sum || 1);
        const a0 = angle + gap / 2, a1 = angle + frac * Math.PI * 2 - gap / 2;
        angle += frac * Math.PI * 2;
        const tip = m.key === 'count'
            ? `${s.key}: ${insFmt(s.v)} activities · ${insPct(frac)}`
            : `${s.key}: ${insWithUnit(s.v, m)} · ${insPct(frac)} · ${s.n} activities`;
        const mid = (a0 + a1) / 2;
        const attrs = `class="ins-hit" data-tip="${insEsc(tip)}" data-sport="${s.key}" data-color="${s.color}" data-num="${insShort(s.v)}" data-pct="${insPct(frac)}"`;
        if (frac >= 0.999) {
            arcs += `<g ${attrs}><circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${s.color}" stroke-width="${R - r}"/></g>`;
            return;
        }
        if (a1 <= a0) return;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
        arcs += `<g ${attrs} style="--dx:${(POP * Math.cos(mid)).toFixed(2)}px;--dy:${(POP * Math.sin(mid)).toFixed(2)}px"><path fill="${s.color}" d="M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z"/></g>`;
    });
    const allLabel = insYearFiltered() ? 'All selected' : 'All time';
    const label = sel === 'all' ? allLabel : sel;
    const centre = `<text class="ins-donut-label" x="${C}" y="${C - 17}" text-anchor="middle">${label}</text>
        <text class="ins-donut-num" x="${C}" y="${C + 7}" text-anchor="middle">${insShort(sum)}</text>
        <text class="ins-donut-unit" x="${C}" y="${C + 21}" text-anchor="middle">${unitWord}</text>`;
    // The share bar and amount show on the website, where the legend has room.
    const legend = slices.map(s => {
        const frac = s.v / (sum || 1);
        const amt = m.key === 'count' ? insFmt(s.v) : insWithUnit(s.v, m);
        return `<li><span class="ins-swatch" style="background:${s.color}"></span><span class="ins-legend-name">${s.key}</span><span class="ins-legend-amt">${amt}</span><span class="ins-legend-val">${insPct(frac)}</span>`
            + `<span class="ins-legend-bar"><span style="width:${(frac * 100).toFixed(1)}%;background:${s.color}"></span></span></li>`;
    }).join('');

    // Every year, newest first; the row scrolls sideways.
    const body = `${insYearPills('donutYear', years, sel, allLabel)}
        <div class="ins-donut-wrap">
            <svg class="ins-svg ins-donut" viewBox="0 0 150 150" role="img" aria-label="Sport mix by ${m.noun}" data-label="${label}" data-num="${insShort(sum)}" data-unit="${unitWord}">${arcs}${centre}</svg>
            <ul class="ins-legend">${legend}</ul>
        </div>`;
    return insCard('Sport mix', body, `by ${m.noun}`);
}

// A share as a whole percent; a sliver shows as "<1%" rather than "0%".
function insPct(f) {
    return f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`;
}

// The donut's centre: the hovered slice (its sport, amount and share), or the
// total when hit is null.
function insDonutCentre(svg, hit) {
    const [label, num, unit] = svg.querySelectorAll('text');
    if (!label) return;
    const d = svg.dataset;
    label.textContent = hit ? hit.dataset.sport : d.label;
    label.style.fill = hit ? hit.dataset.color : '';
    num.textContent = hit ? hit.dataset.num : d.num;
    unit.textContent = hit ? `${hit.dataset.pct} of total` : d.unit;
}

// ── 5. Consistency calendar ────────────────────────────────────────────────
function insCalendarCard(list, today) {
    const m = insMetric();
    const perDay = new Map();
    list.forEach(a => {
        const d = a.d.slice(0, 10);
        const e = perDay.get(d) || { n: 0, sec: 0, mi: 0, v: 0 };
        e.n++;
        e.sec += a.m || 0;
        e.mi += (a.di || 0) / INS_M_PER_MI;
        e.v += m.val(a);
        perDay.set(d, e);
    });

    // Streaks over all filtered history.
    const days = [...perDay.keys()].sort();
    let best = 0, run = 0, prev = null, bestEnd = null;
    days.forEach(d => {
        run = prev && insAddDays(prev, 1) === d ? run + 1 : 1;
        if (run > best) { best = run; bestEnd = d; }
        prev = d;
    });
    // Current streak counts back from today (or yesterday, so a streak isn't
    // "broken" before today's activity is done).
    let cur = 0;
    let probe = perDay.has(today.iso) ? today.iso : insAddDays(today.iso, -1);
    while (perDay.has(probe)) { cur++; probe = insAddDays(probe, -1); }

    // The last 12 months (52 full weeks + this partial one), or one calendar
    // year; weeks start Monday.
    const years = insYears(list);
    let view = insState.calYear;
    if (view !== 'last' && !years.includes(view)) view = 'last';
    const mondayOf = iso => insAddDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
    let first, end, weeks, start;
    if (view === 'last') {
        end = today.iso;
        weeks = 53;
        start = insAddDays(mondayOf(end), -(weeks - 1) * 7);
        first = start;
    } else {
        first = `${view}-01-01`;
        end = view === String(today.year) ? today.iso : `${view}-12-31`;
        start = mondayOf(first);
        weeks = Math.floor((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000 / 7) + 1;
    }
    const cell = 6, g = 1.5, L = 14, T = 12;
    const W = L + weeks * (cell + g), H = T + 7 * (cell + g);
    // Four shades by the chosen metric: activity count as-is (1, 2, 3, 4+);
    // amounts by quartile of the active days in view, so the scale fits
    // whatever is measured. A day with activity but none of the amount (a
    // swim on a climbing view) still gets the lightest shade.
    let cuts = null;
    if (m.key !== 'count') {
        const inView = [];
        perDay.forEach((e, d) => { if (d >= first && d <= end && e.v > 0) inView.push(e.v); });
        inView.sort((a, b) => a - b);
        const q = f => inView[Math.min(inView.length - 1, Math.floor(f * inView.length))];
        if (inView.length) cuts = [q(0.25), q(0.5), q(0.75)];
    }
    const level = e => {
        if (!e) return 0;
        if (!cuts) return Math.min(4, e.n);
        return e.v <= cuts[0] ? 1 : e.v <= cuts[1] ? 2 : e.v <= cuts[2] ? 3 : 4;
    };
    let cells = '', months = '', active = 0, lastMonth = -1, lastLabelW = -9;
    for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
            const iso = insAddDays(start, w * 7 + d);
            if (iso > end || iso < first) continue;
            const e = perDay.get(iso);
            if (e) active++;
            const dayName = `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}, ${insShortDate(iso, today)}`;
            const tip = e
                ? `${dayName}: ${e.n} activit${e.n === 1 ? 'y' : 'ies'} · ${insFmt(e.mi, 1)} mi · ${insFmt(e.sec / 3600, 1)} h${m.key === 'elev' ? ` · ${insFmt(e.v)} ft` : ''}`
                : `${dayName}: rest day`;
            cells += `<rect class="ins-hit ins-cell l${level(e)}" x="${L + w * (cell + g)}" y="${T + d * (cell + g)}" width="${cell}" height="${cell}" rx="1.5" data-tip="${insEsc(tip)}"/>`;
            if (d === 0) {
                const mon = Number(iso.slice(5, 7)) - 1;
                // Label a month at its first week, if the last label is far
                // enough left not to collide.
                if (mon !== lastMonth && Number(iso.slice(8, 10)) <= 7 && w < weeks - 2 && w - lastLabelW >= 3) {
                    months += `<text class="ins-axis" x="${L + w * (cell + g)}" y="${T - 4}">${INS_MONTHS[mon]}</text>`;
                    lastLabelW = w;
                }
                lastMonth = mon;
            }
        }
    }
    const dayLabels = ['M', '', 'W', '', 'F', '', ''].map((t, d) => t ? `<text class="ins-axis" x="0" y="${T + d * (cell + g) + cell - 0.5}">${t}</text>` : '').join('');
    const svg = `<svg class="ins-svg ins-calendar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Active days ${view === 'last' ? 'over the last year' : `in ${view}`}">${months}${dayLabels}${cells}</svg>`;
    const legend = `<div class="ins-cal-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="ins-cell-key l${l}"></i>`).join('')}<span>More</span></div>`;
    const bestNote = bestEnd ? ` <span class="ins-tile-foot">ended ${insShortDate(bestEnd, today)}</span>` : '';
    const stats = `<div class="ins-tiles ins-tiles-3">
        <div class="ins-tile"><span class="ins-tile-label">Current streak</span><span class="ins-tile-value">${cur}<small> d</small></span></div>
        <div class="ins-tile"><span class="ins-tile-label">Best streak</span><span class="ins-tile-value">${best}<small> d</small></span>${bestNote}</div>
        <div class="ins-tile"><span class="ins-tile-label">Active days</span><span class="ins-tile-value">${active}</span><span class="ins-tile-foot">${view === 'last' ? 'last 12 months' : `in ${view}`}</span></div>
    </div>`;
    const picker = insYearPills('calYear', years, view, 'Last 12 months', 'last');
    return insCard('Consistency', picker + stats + svg + legend, `shade = ${m.noun}`);
}

// "May 27" this year, "May 27, 2025" otherwise.
function insShortDate(iso, today) {
    const label = `${INS_MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
    return iso.startsWith(String(today.year)) ? label : `${label}, ${iso.slice(0, 4)}`;
}

// ── 6. Eddington number ────────────────────────────────────────────────────
// E = the largest number such that you have E days of at least E miles.
function insEddington(types, year = 'all') {
    const perDay = new Map();
    const pool = typeof currentSlim !== 'undefined' ? currentSlim : [];
    pool.forEach(a => {
        if (!types.includes(a.t) || !a.d || (year !== 'all' && !a.d.startsWith(year))) return;
        const d = a.d.slice(0, 10);
        perDay.set(d, (perDay.get(d) || 0) + (a.di || 0) / INS_M_PER_MI);
    });
    const vals = [...perDay.values()].sort((a, b) => b - a);
    let E = 0;
    while (E < vals.length && vals[E] >= E + 1) E++;
    const have = vals.filter(v => v >= E + 1).length;
    return { E, next: E + 1, need: E + 1 - have };
}

function insEddingtonCard() {
    const pool = (typeof currentSlim !== 'undefined' ? currentSlim : []).filter(a => a.d && INS_EDDINGTON.some(g => g.types.includes(a.t)));
    const years = insYears(pool);
    const year = insState.eddYear === 'all' || years.includes(insState.eddYear) ? insState.eddYear : 'all';
    const tiles = INS_EDDINGTON.map(({ label, types }) => {
        const { E, next, need } = insEddington(types, year);
        return `<div class="ins-tile ins-tile-hero">
            <span class="ins-tile-label">${label}</span>
            <span class="ins-tile-value">${E}</span>
            <span class="ins-tile-foot">${need} more day${need === 1 ? '' : 's'} of ${next}+ mi for ${next}</span>
        </div>`;
    }).join('');
    return insCard('Eddington number', `${insYearPills('eddYear', years, year)}<div class="ins-tiles">${tiles}</div>
        <p class="ins-note">E days with at least E miles in a day${year === 'all' ? '' : `, counting only ${year}`}. Ride counts road, gravel and mountain bike rides; Run counts road and trail runs.</p>`);
}

// ── 7. Best Efforts ────────────────────────────────────────────────────────
// Like Strava's leaderboards for yourself: per sport, the top 5 activities by
// distance, moving time and climbing, for all time or any one year. Fixed
// sport groups, so it ignores the Dashboard's filters.
function insDuration(sec) {
    const h = Math.floor(sec / 3600), mm = Math.round((sec % 3600) / 60);
    if (mm === 60) return `${h + 1}h 00m`;
    return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
}

function insBestValue(cat, v) {
    if (cat === 'dist') return `${insFmt(v, 1)} mi`;
    if (cat === 'time') return insDuration(v);
    return `${insFmt(v)} ft`;
}

function insBestCard(today) {
    const all = (typeof currentSlim !== 'undefined' ? currentSlim : []).filter(a => a.d);
    const sports = INS_BEST_SPORTS.map(sp => ({ ...sp, acts: all.filter(a => sp.types.includes(a.t)) }));
    const present = sports.filter(sp => sp.acts.length);
    if (!present.length) return '';
    const sport = present.find(sp => sp.key === insState.bestSport) || present[0];
    const years = insYears(sport.acts);
    const cy = String(today.year);
    let year = insState.bestYear || (sport.acts.some(a => a.d.startsWith(cy)) ? cy : 'all');
    if (year !== 'all' && !years.includes(year)) year = 'all';
    const pool = year === 'all' ? sport.acts : sport.acts.filter(a => a.d.startsWith(year));

    const cols = INS_BEST_CATS.map(cat => {
        const top = pool.filter(a => cat.val(a) > 0)
            .sort((a, b) => cat.val(b) - cat.val(a) || (a.d < b.d ? -1 : 1))
            .slice(0, INS_BEST_TOP);
        const rows = top.map((a, i) => {
            const others = INS_BEST_CATS.filter(c => c.key !== cat.key && c.val(a) > 0).map(c => insBestValue(c.key, c.val(a)));
            const name = insEsc(a.n || 'Untitled');
            const link = a.i ? `<a href="https://www.strava.com/activities/${encodeURIComponent(a.i)}" target="_blank" rel="noopener">${name}</a>` : name;
            return `<li class="ins-best-row${i === 0 ? ' is-first' : ''}">
                <span class="ins-best-rank">${i + 1}</span>
                <span class="ins-best-main"><span class="ins-best-name">${link}</span><span class="ins-best-meta">${insShortDate(a.d, today)}${others.length ? ` · ${others.join(' · ')}` : ''}</span></span>
                <strong class="ins-best-val">${insBestValue(cat.key, cat.val(a))}</strong>
            </li>`;
        }).join('');
        return `<div class="ins-best-col"><h3>${cat.label}</h3>${rows ? `<ol class="ins-best-list">${rows}</ol>` : '<p class="ins-note">None yet.</p>'}</div>`;
    }).join('');

    const sportPills = insPills('bestSport', present.map(sp => [sp.key, sp.label]), sport.key);
    const yearPills = insYearPills('bestYear', years, year);
    const sub = `${year === 'all' ? 'all time' : year} · ${insFmt(pool.length)} ${sport.label.replace(/^\S+\s/, '').toLowerCase()} activities`;
    const note = { run: 'Run includes trail runs.', ride: 'Ride includes gravel and mountain bike rides (no e-bike or virtual rides).' }[sport.key] || '';
    return insCard('Best Efforts', `${sportPills}${yearPills}<div class="ins-best">${cols}</div>${note ? `<p class="ins-note">${note}</p>` : ''}`, sub, 'ins-best');
}

// ── 8. Goal progress ───────────────────────────────────────────────────────
async function insLoadGoals() {
    insState.goalsLoading = true;
    const base = typeof WORKER_URL !== 'undefined' ? WORKER_URL : 'https://strava-worker.justinguyette.workers.dev';
    const get = path => fetch(`${base}${path}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [summary, metros, states, countries, highpoints, parks, adk, co14] = await Promise.all([
        typeof fetchHunterSummary === 'function' ? fetchHunterSummary() : get('/summary'),
        get('/travel/metros'),
        get('/travel/visited-states'),
        get('/travel/countries'),
        get('/travel/highpoints'),
        get('/travel/parks'),
        get('/travel/adk46ers'),
        get('/travel/colorado14ers'),
    ]);
    const goals = [];
    const arr = v => (Array.isArray(v) ? v : []);
    const add = (label, done, total, note = '') => { if (total > 0) goals.push({ label, done, total, note }); };

    const top100 = arr(metros).filter(m => m.rank <= 100);
    add('🏙️ Top 100 metros', top100.filter(m => m.visited).length, top100.length,
        metros ? `${arr(metros).filter(m => m.visited).length} of ${arr(metros).length} in the top 200` : '');
    if (states) add('🗽 US states', Object.values(states).filter(Boolean).length, Object.keys(states).length);
    add('🏞️ National parks', arr(parks).filter(p => p.visited).length, arr(parks).length);
    add('⛰️ State high points', arr(highpoints).filter(p => p.visited).length, arr(highpoints).length);
    add('🏔️ ADK 46ers', arr(adk).filter(p => p.climbed).length, arr(adk).length);
    add('🏔️ Colorado 14ers', arr(co14).filter(p => p.climbed).length, arr(co14).length);
    if (countries) {
        const all = Object.values(countries).flat().filter(c => c && c.name);
        add('🌐 Countries', all.filter(c => c.visited).length, all.length);
    }
    if (summary?.county?.total) add('🗺️ US counties', summary.county.visited, summary.county.total);
    if (summary?.ecoregion?.l3Total) add('🌿 Ecoregions (Level III)', summary.ecoregion.l3Visited, summary.ecoregion.l3Total);
    if (summary?.pass?.total) add('🛣️ Mountain passes', summary.pass.climbed, summary.pass.total);

    insState.goals = {
        list: goals,
        extra: [
            summary?.mountain?.summited != null ? ['Peaks summited', summary.mountain.summited] : null,
            summary?.tile?.visited != null ? ['Tiles', summary.tile.visited] : null,
            summary?.tile?.maxSquare ? ['Max square', `${summary.tile.maxSquare}×${summary.tile.maxSquare}`] : null,
        ].filter(Boolean),
    };
    insState.goalsLoading = false;
    const el = document.getElementById('ins-goals');
    if (el) el.outerHTML = insGoalsCard();
    const mount = document.getElementById('strava-insights');
    if (mount) insBindTooltips(mount);
}

function insGoalsCard() {
    const g = insState.goals;
    if (!g) return `<div id="ins-goals">${insCard('Goals', '<p class="ins-note">Loading…</p>')}</div>`;
    if (!g.list.length) return `<div id="ins-goals">${insCard('Goals', '<p class="ins-note">Couldn\'t reach the worker.</p>')}</div>`;
    const rows = g.list.map(({ label, done, total, note }) => {
        const pct = Math.min(100, (done / total) * 100);
        const tip = `${label.replace(/^\S+\s/, '')}: ${insFmt(done)} of ${insFmt(total)} (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%)${note ? ` · ${note}` : ''}`;
        return `<li class="ins-goal ins-hit${done >= total ? ' done' : ''}" data-tip="${insEsc(tip)}">
            <div class="ins-goal-top"><span>${label}</span><span class="ins-goal-val"><strong>${insFmt(done)}</strong> / ${insFmt(total)}</span></div>
            <div class="ins-goal-track"><div class="ins-goal-fill" style="width:${Math.max(pct, done > 0 ? 1.5 : 0)}%"></div></div>
        </li>`;
    }).join('');
    const extra = g.extra.length
        ? `<div class="ins-goal-extra">${g.extra.map(([k, v]) => `<span><strong>${typeof v === 'number' ? insFmt(v) : v}</strong> ${k}</span>`).join('')}</div>`
        : '';
    return `<div id="ins-goals">${insCard('Goals', `<ul class="ins-goals">${rows}</ul>${extra}`)}</div>`;
}

// ── Tooltips ───────────────────────────────────────────────────────────────
// One floating tooltip; any element with data-tip shows it on hover / tap.
// The pace chart gets a crosshair that reads every year at that day.
function insTooltipEl() {
    let tip = document.getElementById('ins-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'ins-tooltip';
        tip.className = 'ins-tooltip';
        tip.hidden = true;
        document.body.appendChild(tip);
    }
    return tip;
}

// Places the tooltip centred on `x`, its bottom edge just above `top` (the top
// of the mark being read). A finger covers ~40px around the touch point, so on
// touch it also stays clear of the finger; with no room above it drops below
// `bottom` (or below the finger).
const INS_FINGER = 44;
function insShowTip(html, x, top, { bottom = top, touchY = null } = {}) {
    const tip = insTooltipEl();
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 10, gap = 8;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(pad, Math.min(window.innerWidth - w - pad, x - w / 2));
    const above = touchY == null ? top : Math.min(top, touchY - INS_FINGER);
    let y = above - h - gap;
    if (y < pad) y = Math.max(bottom, touchY == null ? bottom : touchY + INS_FINGER) + gap;
    tip.style.left = `${left}px`;
    tip.style.top = `${y}px`;
}

function insHideTip() {
    const tip = document.getElementById('ins-tooltip');
    if (tip) tip.hidden = true;
}

function insBindTooltips(root) {
    if (root.dataset.insBound) return;
    root.dataset.insBound = '1';
    const onMove = ev => {
        const hit = ev.target.closest?.('[data-tip]');
        const pace = ev.target.closest?.('.ins-pace');
        // A pace legend chip picks out its year's line.
        const chip = ev.target.closest?.('[data-pace-year]');
        root.querySelectorAll('.ins-pace').forEach(svg => insPaceFocus(svg, chip ? chip.dataset.paceYear : null));
        if (pace) { insPaceHover(pace, ev); return; }
        // In the donut's gaps or hole, keep the last slice until the pointer
        // leaves the chart, so sweeping across it doesn't flicker to the total.
        if (!hit && ev.target.closest?.('.ins-donut')) return;
        root.querySelectorAll('.ins-hit.is-hover').forEach(el => el.classList.remove('is-hover'));
        root.querySelectorAll('.ins-donut').forEach(svg => insDonutCentre(svg, hit && svg.contains(hit) ? hit : null));
        if (hit && root.contains(hit)) {
            hit.classList.add('is-hover');
            // The website's big donut shows the slice in its centre instead.
            if (!document.body.classList.contains('app-page') && hit.closest('.ins-donut')) { insHideTip(); return; }
            // Anchor on the drawn mark (a bar's rounded top, a cell, a goal
            // row), not the pointer, so the tip sits above what you touch.
            const mark = hit.querySelector('path, circle') || hit;
            const r = mark.getBoundingClientRect();
            insShowTip(insEsc(hit.dataset.tip), r.left + r.width / 2, r.top, {
                bottom: r.bottom,
                touchY: ev.pointerType === 'mouse' ? null : ev.clientY,
            });
        } else {
            insHideTip();
        }
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerdown', onMove);
    // A touch pointer "leaves" as the finger lifts, so on touch the tip stays
    // up after the tap and goes on the next tap elsewhere or a scroll.
    const clear = () => {
        insHideTip();
        root.querySelectorAll('.ins-crosshair').forEach(c => { c.style.display = 'none'; });
        root.querySelectorAll('.ins-hit.is-hover').forEach(el => el.classList.remove('is-hover'));
        root.querySelectorAll('.ins-donut').forEach(svg => insDonutCentre(svg, null));
        root.querySelectorAll('.ins-pace').forEach(svg => insPaceFocus(svg, null));
    };
    root.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') clear(); });
    document.addEventListener('pointerdown', ev => { if (!root.contains(ev.target)) clear(); });
    window.addEventListener('scroll', clear, { passive: true });
}

function insPaceFocus(svg, year) {
    svg.classList.toggle('has-focus', !!year && !!svg.querySelector(`.ins-line[data-year="${year}"]`));
    svg.querySelectorAll('.ins-line').forEach(l => l.classList.toggle('is-focus', l.dataset.year === year));
}

function insPaceHover(svg, ev) {
    let data;
    try { data = JSON.parse(svg.dataset.pace); } catch { return; }
    const [L, R, W] = svg.dataset.geom.split(',').map(Number);
    const box = svg.getBoundingClientRect();
    const vx = (ev.clientX - box.left) / box.width * W;
    const day = Math.round(Math.max(0, Math.min(365, (vx - L) / (W - L - R) * 365)));
    const cross = svg.querySelector('.ins-crosshair');
    const cx = L + day / 365 * (W - L - R);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.style.display = '';
    const d = new Date(Date.UTC(2001, 0, 1 + day)); // a non-leap year for the label
    const label = `${INS_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    // Every year that has reached this day, highest first.
    const rows = data.years.map((y, k) => ({ y, k, v: data.series[k][day] }))
        .filter(r => r.v != null)
        .sort((a, b) => b.v - a.v)
        .map(({ y, k, v }) => `<div><span class="ins-swatch" style="background:${data.colors[k]}"></span>${y}: <strong>${insFmt(v)} ${data.unit}</strong></div>`)
        .join('');
    insShowTip(`<div class="ins-tooltip-head">${label}</div>${rows}`, ev.clientX, box.top + 10, {
        bottom: box.bottom,
        touchY: ev.pointerType === 'mouse' ? null : ev.clientY,
    });
}
