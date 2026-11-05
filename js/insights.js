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
//   5b. Heart rate zones by week (last 12 months or any year), and by year
//      (hours, share, or one zone month by month with a line per year);
//      hidden until the worker has collected some heart rate history
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
    { key: 'nordic', label: '⛷️ Nordic Ski',      types: ['NordicSki'] },
    { key: 'bc',     label: '🏔️ Backcountry Ski', types: ['BackcountrySki'] },
];
const INS_BEST_CATS = [
    { key: 'dist', label: 'Furthest Distance', val: a => (a.di || 0) / INS_M_PER_MI },
    { key: 'time', label: 'Longest Time',     val: a => a.m || 0 },
    { key: 'elev', label: 'Most Climbing',    val: a => (a.e || 0) * INS_FT_PER_M },
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
    hrYear: 'last',       // heart rate weeks: 'last' = last 12 months, or a year
    hrView: 'hours',      // heart rate by year: 'hours' | 'share' | 'month'
    hrZone: '1',          // the zone drawn month by month (0 = Z1)
    hr: null,             // /hr/all, loaded once
    hrLoading: false,
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

    // Filters that match nothing would otherwise just make the charts vanish.
    const empty = list.length ? '' : insCard('No activities match the filters',
        '<p class="ins-note">Switch on a sport or a year above to bring the charts back. Eddington, Best Efforts and Goals below don\'t follow the filters.</p>', '', 'ins-empty');
    // Each card is tagged with a name so insKeepPlace can find it again.
    const cards = [
        ['empty', empty],
        ['compare', insCompareCard(list, today)],
        ['pace', insPaceCard(list, today)],
        ['years', insYearsCard(list, today)],
        ['donut', insDonutCard(list, today)],
        ['calendar', insCalendarCard(list, today)],
        ['hr-weeks', insHrWeeksCard(list, today)],
        ['hr-years', insHrYearsCard(list, today)],
        ['eddington', insEddingtonCard(today)],
        ['best', insBestCard(today)],
        ['goals', insGoalsCard()],
    ].map(([key, html]) => html.replace('<section class="ins-card"', `<section data-ins="${key}" class="ins-card"`));
    insKeepPlace(mount, () => { mount.innerHTML = cards.join(''); });

    insBindTooltips(mount);
    insRevealActivePills(mount);
    if (!insState.goals && !insState.goalsLoading) insLoadGoals();
    if (!insState.hr && !insState.hrLoading) insLoadHr();
}

// Every tap on a card (a year pill, a legend chip, a bar) redraws all the
// cards from scratch. Chrome keeps your place through that by itself, but
// iPhone Safari doesn't, and it put the page back at the top. So note where
// the tapped card (or the first card on screen) sits, redraw, and scroll it
// back to the same spot.
function insKeepPlace(mount, draw) {
    const tapped = insState.lastTap && mount.contains(insState.lastTap)
        ? insState.lastTap.closest('.ins-card[data-ins]') : null;
    const anchor = tapped || [...mount.querySelectorAll('.ins-card[data-ins]')]
        .find(c => c.getBoundingClientRect().bottom > 0);
    const key = anchor?.dataset.ins;
    const top = anchor ? anchor.getBoundingClientRect().top : 0;
    const y = window.scrollY;
    draw();
    const now = key && mount.querySelector(`.ins-card[data-ins="${key}"]`);
    if (now) {
        const d = now.getBoundingClientRect().top - top;
        if (Math.abs(d) > 0.5) window.scrollBy(0, d);
    } else if (Math.abs(window.scrollY - y) > 0.5) {
        window.scrollTo(0, y);
    }
    // Safari can still jump once the tap finishes; put it back if it does.
    const want = window.scrollY;
    if (!(want > 0)) return;
    const check = () => { if (window.scrollY < want - 40) window.scrollTo(0, want); };
    requestAnimationFrame(() => { check(); requestAnimationFrame(check); });
    setTimeout(check, 120);
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
function insYearPills(key, years, sel, allLabel = 'All Time', allValue = 'all') {
    return insPills(key, [[allValue, allLabel], ...years.map(y => [y, y])], sel);
}

// Picking a year on one card picks it on every one-year card (and as the
// first year of the comparison); "All Time" carries across the cards that
// have it. "Last 12 Months" is the calendar's alone.
const INS_YEAR_KEYS = ['donutYear', 'calYear', 'eddYear', 'bestYear', 'hrYear'];

function insSet(key, value) {
    if (INS_YEAR_KEYS.includes(key) && /^\d{4}$/.test(value)) {
        INS_YEAR_KEYS.forEach(k => { insState[k] = value; });
        insState.compareA = value;
        insState.compareB = null;
    } else if (INS_YEAR_KEYS.includes(key) && value === 'all') {
        ['donutYear', 'eddYear', 'bestYear'].forEach(k => { insState[k] = 'all'; });
    } else {
        insState[key] = value;
    }
    renderInsights(insState.lastFiltered);
}

// Each picker row was just redrawn scrolled to its start; bring its chosen
// pill into view so a pick far down the row stays visible.
// Rows that scroll fade at the edge with more to see (insScrollFade).
function insRevealActivePills(root) {
    root.querySelectorAll('.ins-pills').forEach(row => {
        const pill = row.querySelector('.active');
        if (pill && row.scrollWidth > row.clientWidth) {
            const off = pill.getBoundingClientRect().left - row.getBoundingClientRect().left;
            if (off + pill.offsetWidth > row.clientWidth - 24) row.scrollLeft = off - row.clientWidth / 2 + pill.offsetWidth / 2;
        }
    });
    root.querySelectorAll('.ins-cal-scroll').forEach(box => {
        if (box.dataset.end === 'right') box.scrollLeft = box.scrollWidth;
    });
    root.querySelectorAll('.ins-pills, .ins-cal-scroll').forEach(el => {
        insScrollFade(el);
        el.addEventListener('scroll', () => insScrollFade(el), { passive: true });
    });
}

function insScrollFade(el) {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-left', max > 2 && el.scrollLeft > 2);
    el.classList.toggle('fade-right', max > 2 && el.scrollLeft < max - 2);
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
        ['hours', 'Moving Time', 'hours', 'h'],
        ['elev', 'Climbing', 'ft', 'ft'],
    ].map(([key, label, f, unit]) => {
        const v = cur[f], p = prev ? prev[f] : 0;
        let delta = `<span class="ins-delta">${B ? `no data in ${B}` : 'only one year in the filter'}</span>`;
        if (p > 0) {
            const pct = Math.round((v / p - 1) * 100);
            const arrow = pct > 0 ? '<span class="ins-delta up">▲ ' : pct < 0 ? '<span class="ins-delta down">▼ ' : '<span class="ins-delta">±';
            delta = `${arrow}${Math.abs(pct)}%</span> <span class="ins-delta-ref">vs ${insShort(p)}</span>`;
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
    return insCard(`${A}${A === cy ? ' so far' : ''}`, picker + `<div class="ins-tiles">${tiles}</div>` + insMonthBars(list, years, A, B, today),
        B ? (toDate ? `vs ${B} to the same date` : `vs ${B}, full years`) : '');
}

// Month by month, the two compared years side by side (each in its Year
// Pace colour), by the chosen metric.
function insMonthBars(list, years, A, B, today) {
    const m = insMetric();
    const nums = years.map(Number);
    const sums = y => {
        const out = new Array(12).fill(0);
        list.forEach(a => { if (a.d.startsWith(y)) out[Number(a.d.slice(5, 7)) - 1] += m.val(a); });
        return out;
    };
    const a = sums(A), b = B ? sums(B) : null;
    const lastA = A === String(today.year) ? Number(today.iso.slice(5, 7)) - 1 : 11;
    const max = Math.max(...a, ...(b || [0])) || 1;
    const yMax = insNiceMax(max);
    const W = 340, H = 120, L = 34, R = 6, T = 8, Bm = 18;
    const slot = (W - L - R) / 12;
    const bw = Math.min(10, (slot - 4) / (b ? 2 : 1));
    const y = v => T + (1 - v / yMax) * (H - T - Bm);
    const cA = insPaceColor(Number(A), nums, today), cB = B ? insPaceColor(Number(B), nums, today) : '';
    const bar = (x0, v, color) => {
        const top = y(v), h = H - Bm - top;
        if (h <= 0) return '';
        const r = Math.min(2.5, bw / 2, h);
        return `<path style="fill:${color}" d="M${x0},${H - Bm} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${H - Bm} Z"/>`;
    };
    let grid = '';
    [0, 2, 4].forEach(k => {
        const v = (yMax / 4) * k;
        grid += `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
        grid += `<text class="ins-axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${insShort(v)}</text>`;
    });
    let marks = '';
    for (let i = 0; i < 12; i++) {
        const cx = L + slot * i + slot / 2;
        const gap = b ? 1 : 0;
        const xA = b ? cx - bw - gap / 2 : cx - bw / 2;
        const tipA = i > lastA ? `${A}: —` : `${A}: ${insWithUnit(a[i], m)}${i === lastA && A === String(today.year) ? ' (so far)' : ''}`;
        const tip = `${INS_MONTHS[i]} · ${tipA}${b ? ` · ${B}: ${insWithUnit(b[i], m)}` : ''}`;
        marks += `<g class="ins-hit" data-tip="${insEsc(tip)}"><rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - Bm}" fill="transparent"/>`
            + (i <= lastA ? bar(xA, a[i], cA) : '')
            + (b ? bar(cx + gap / 2, b[i], cB) : '')
            + '</g>';
        marks += `<text class="ins-axis" x="${cx}" y="${H - 5}" text-anchor="middle">${INS_MONTHS[i][0]}</text>`;
    }
    const key = `<div class="ins-month-key"><span><i class="ins-swatch" style="background:${cA}"></i>${A}</span>${b ? `<span><i class="ins-swatch" style="background:${cB}"></i>${B}</span>` : ''}<span class="ins-month-key-unit">${m.noun} per month</span></div>`;
    return `<div class="ins-months">${key}<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${insEsc(m.noun)} per month, ${A}${B ? ` and ${B}` : ''}">${grid}${marks}</svg></div>`;
}

// ── 2. Year pace lines ─────────────────────────────────────────────────────
// One cumulative line per year, every year by default. This year is the
// accent green; the five years before it each get their own hue (the
// validated dark categorical slots, in an order that keeps neighbouring years
// distinguishable, without aqua / green so nothing passes for this year);
// older years are grey, fading with age, since a dozen hues can't be told
// apart. Colour follows the year: hiding one never repaints the others.
// Legend chips under the chart hide or show a year (hovering one picks out
// its line).
const INS_PACE_HUES = ['#3987e5', '#d95926', '#9085e9', '#c98500', '#d55181'];

function insPaceColor(year, years, today) {
    if (year === today.year) return 'var(--ins-accent, #3ddc84)';
    const back = today.year - year - 1;           // 0 = last year
    if (back >= 0 && back < INS_PACE_HUES.length) return INS_PACE_HUES[back];
    const older = years.filter(y => today.year - y - 1 >= INS_PACE_HUES.length);
    const k = older.indexOf(year);
    const op = older.length > 1 ? 0.8 - (k / (older.length - 1)) * 0.45 : 0.8;
    return `rgba(137,135,129,${op.toFixed(2)})`;
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
    // This year's pace carried on to Dec 31, drawn dashed.
    const ck = shown.indexOf(today.year);
    const curEnd = ck >= 0 ? series[ck][series[ck].length - 1] : 0;
    const projection = ck >= 0 && curEnd > 0 && todayIdx < 364 ? curEnd / (todayIdx + 1) * 365 : 0;
    const max = Math.max(0, projection, ...series.map(s => s[s.length - 1])) || 1;
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

    // Direct labels only for this year, last year and the year that finished
    // highest, so a dozen lines don't bury the chart in numbers.
    const ends = series.map(s => s[s.length - 1] || 0);
    const bestK = ends.indexOf(Math.max(...ends));
    const curK = shown.indexOf(today.year);
    const prevK = shown.indexOf(today.year - 1);
    const labelled = new Set([curK, prevK, bestK].filter(k => k >= 0 && ends[k] > 0));

    // Oldest first so newer years sit on top; this year last of all.
    const order = shown.map((_, k) => k).sort((a, b) => (shown[a] === today.year) - (shown[b] === today.year) || shown[a] - shown[b]);
    let lines = '', labels = '';
    order.forEach(k => {
        const s = series[k];
        if (!s.length || s[s.length - 1] <= 0) return;
        const pts = [];
        for (let i = 0; i < s.length; i += 2) pts.push(`${x(i).toFixed(1)},${y(s[i]).toFixed(1)}`);
        pts.push(`${x(s.length - 1).toFixed(1)},${y(s[s.length - 1]).toFixed(1)}`);
        const main = shown[k] === today.year;
        lines += `<polyline class="ins-line${main ? ' ins-line-main' : ''}" data-year="${shown[k]}" points="${pts.join(' ')}" style="stroke:${colors[k]}"/>`;
    });
    // Labels sit at each line's end (this year's mid-chart, the rest past the
    // right edge); top to bottom, a label that would touch the one above
    // (same column) moves down, and the column is pulled back up if it ran
    // off the bottom.
    const LH = 12, LW = 26;
    const labs = [...labelled].map(k => {
        const s = series[k];
        const main = shown[k] === today.year;
        return { k, main, x: main ? x(s.length - 1) + 6 : W - R + 4, y: y(s[s.length - 1]) + 3 };
    }).sort((a, b) => a.y - b.y);
    const clash = (a, b) => Math.abs(a.x - b.x) < LW;
    labs.forEach((l, i) => labs.slice(0, i).forEach(o => { if (clash(l, o) && l.y < o.y + LH) l.y = o.y + LH; }));
    for (let i = labs.length - 1; i >= 0; i--) {
        const l = labs[i];
        if (l.y > H - B) l.y = H - B;
        labs.slice(i + 1).forEach(o => { if (clash(l, o) && l.y > o.y - LH) l.y = o.y - LH; });
    }
    labs.forEach(({ k, main, x: lx, y: ly }) => {
        labels += `<text class="ins-line-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" ${main ? 'style="font-weight:650"' : ''}>${shown[k]}</text>`;
    });
    // today marker
    const s0 = curK >= 0 ? series[curK] : [];
    const proj = projection
        ? `<line class="ins-projection" x1="${x(todayIdx).toFixed(1)}" y1="${y(curEnd).toFixed(1)}" x2="${x(365).toFixed(1)}" y2="${y(projection).toFixed(1)}" style="stroke:${colors[ck]}"/>`
        : '';
    const dot = s0.length && ends[curK] > 0 ? `<circle cx="${x(s0.length - 1)}" cy="${y(s0[s0.length - 1])}" r="4" style="fill:${colors[curK]};stroke:var(--ins-surface, #131715)" stroke-width="2"/>` : '';

    let note = '';
    if (curK >= 0 && ends[curK] > 0) {
        const cur = ends[curK];
        const projected = cur / (todayIdx + 1) * 365;
        note = `On pace for <strong>${insWithUnit(projected, m)}</strong> in ${today.year}${projection ? ' (dashed)' : ''}`;
        const atDate = series.map((s, k) => (k === curK ? cur : s[Math.min(todayIdx, s.length - 1)] || 0));
        if (shown.length > 1) {
            const rank = atDate.filter(v => v > cur).length + 1;
            note += ` · #${rank} of ${shown.length} years at this date`;
        }
        const prevK = shown.indexOf(today.year - 1);
        if (prevK >= 0 && atDate[prevK] > 0) {
            const diff = cur - atDate[prevK];
            note += Math.round(Math.abs(diff)) === 0
                ? ` · level with ${today.year - 1}`
                : ` · ${insWithUnit(Math.abs(diff), m)} ${diff >= 0 ? 'ahead of' : 'behind'} ${today.year - 1}`;
        }
    } else if (shown.length && ends[bestK] > 0) {
        note = `Best year shown: <strong>${shown[bestK]}</strong> with ${insWithUnit(ends[bestK], m)}`;
    } else {
        note = 'Pick a year below to draw its line.';
    }

    const data = JSON.stringify({ years: shown, colors, unit: m.unit || m.noun, series: series.map(s => s.map(v => Math.round(v))) });
    const svg = `<svg class="ins-svg ins-pace" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative ${m.noun} by day of year for ${shown.join(', ')}" data-pace='${insEsc(data)}' data-geom="${L},${R},${W}">
        ${grid}${lines}${proj}${dot}${labels}
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
    return insCard('Year Pace', `${svg}${legend}<p class="ins-note">${note}</p>`, `cumulative ${m.noun}`);
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
    const picks = insState.donutYear;   // the year the one-year cards show
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
        const tip = `${yr}${isCur ? ' (so far)' : ''}: ${insWithUnit(v, m)} · tap to view ${yr} on every card`;
        const picked = yr === picks && !isCur;
        bars += `<g class="ins-hit ins-bar-hit" data-tip="${insEsc(tip)}" onclick="insSet('donutYear', '${yr}')">
            <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>
            ${path ? `<path d="${path}" class="ins-bar${isCur ? ' ins-bar-cur' : ''}${picked ? ' ins-bar-picked' : ''}"/>` : ''}
        </g>`;
        if (i === maxIdx || isCur || yr === picks) bars += `<text class="ins-bar-label" x="${cx}" y="${top - 4}" text-anchor="middle">${insShort(v)}</text>`;
        if (years.length <= 12 || i % 2 === (years.length - 1) % 2) {
            bars += `<text class="ins-axis" x="${cx}" y="${H - 6}" text-anchor="middle">'${yr.slice(2)}</text>`;
        }
    });
    const svg = `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${insEsc(m.label)} per year">${grid}${bars}</svg>`;
    return insCard('Year by Year', svg, m.noun);
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
    const allLabel = insYearFiltered() ? 'All Selected' : 'All Time';
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
    return insCard('Sport Mix', body, `by ${m.noun}`);
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
    // On a narrow card the calendar keeps a readable size and scrolls
    // sideways instead (opened at its newest weeks, insRevealActivePills).
    const svg = `<div class="ins-cal-scroll" data-end="${view === 'last' || view === String(today.year) ? 'right' : 'left'}"><svg class="ins-svg ins-calendar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Active days ${view === 'last' ? 'over the last year' : `in ${view}`}">${months}${dayLabels}${cells}</svg></div>`;
    const legend = `<div class="ins-cal-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="ins-cell-key l${l}"></i>`).join('')}<span>More</span></div>`;
    const bestNote = bestEnd ? ` <span class="ins-tile-foot">ended ${insShortDate(bestEnd, today)}</span>` : '';
    const stats = `<div class="ins-tiles ins-tiles-3">
        <div class="ins-tile"><span class="ins-tile-label">Current Streak</span><span class="ins-tile-value">${cur}<small> d</small></span></div>
        <div class="ins-tile"><span class="ins-tile-label">Best Streak</span><span class="ins-tile-value">${best}<small> d</small></span>${bestNote}</div>
        <div class="ins-tile"><span class="ins-tile-label">Active Days</span><span class="ins-tile-value">${active}</span><span class="ins-tile-foot">${view === 'last' ? 'last 12 months' : `in ${view}`}</span></div>
    </div>`;
    const picker = insYearPills('calYear', years, view, 'Last 12 Months', 'last');
    return insCard('Consistency', picker + stats + svg + legend, `shade = ${m.noun}`);
}

// "May 27" this year, "May 27, 2025" otherwise.
function insShortDate(iso, today) {
    const label = `${INS_MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
    return iso.startsWith(String(today.year)) ? label : `${label}, ${iso.slice(0, 4)}`;
}

// ── Heart rate zones ───────────────────────────────────────────────────────
// The worker collects each activity's time per 5 bpm (/hr/all, a few hundred
// activities a day within Strava's rate limit), so zone limits are applied
// here: the athlete's Strava zones when the worker could read them, or zones
// from max HR otherwise. Both cards follow the sport + year filters and stay
// hidden until some heart rate history has arrived.
const INS_HR_ZONES = [
    { label: 'Z1', name: 'Endurance', color: '#8a96a3' },
    { label: 'Z2', name: 'Moderate',  color: '#3987e5' },
    { label: 'Z3', name: 'Tempo',     color: '#199e70' },
    { label: 'Z4', name: 'Threshold', color: '#c98500' },
    { label: 'Z5', name: 'Anaerobic', color: '#d95926' },
];
// Fallback zone floors as a share of max HR (Z2 … Z5).
const INS_HR_FALLBACK = [0.6, 0.7, 0.8, 0.9];

async function insLoadHr() {
    insState.hrLoading = true;
    const base = typeof WORKER_URL !== 'undefined' ? WORKER_URL : 'https://strava-worker.justinguyette.workers.dev';
    const data = await fetch(`${base}/hr/all`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    insState.hr = data && data.h ? data : { h: {}, withHr: 0, pending: 0 };
    insState.hrSecs = new Map();
    insState.hrFloors = insHrFloors(insState.hr);
    if (Object.keys(insState.hr.h).length) renderInsights(insState.lastFiltered);
}

// Lower bpm of Z2 … Z5, and where they came from.
function insHrFloors(hr) {
    const z = hr.zones;
    if (Array.isArray(z) && z.length === 5 && z.every(x => typeof x.min === 'number')) {
        return { floors: z.slice(1).map(x => x.min), source: 'Strava zones' };
    }
    // Max HR: the third-highest activity max, so one sensor spike doesn't set it.
    const all = typeof currentSlim !== 'undefined' ? currentSlim : insState.lastFiltered;
    const maxes = all.map(a => a.hm || 0).filter(v => v > 100 && v < 230).sort((a, b) => b - a);
    const max = maxes[Math.min(2, maxes.length - 1)] || 190;
    return { floors: INS_HR_FALLBACK.map(f => Math.round(max * f)), source: `zones from max HR ${max} bpm` };
}

// Seconds in each zone for one activity, or null without heart rate data.
// A 5 bpm bin that straddles a zone floor is split between the two zones.
function insHrSecs(a) {
    const hr = insState.hr;
    if (!hr || !a.hr) return null;
    if (insState.hrSecs.has(a.i)) return insState.hrSecs.get(a.i);
    const hist = hr.h[a.i];
    let out = null;
    if (Array.isArray(hist) && hist.length > 1) {
        const { floors } = insState.hrFloors;
        const bin = hr.bin || 5, base = hr.base || 40;
        out = [0, 0, 0, 0, 0];
        for (let k = 1; k < hist.length; k++) {
            const sec = hist[k];
            if (!sec) continue;
            const lo = base + (hist[0] + k - 1) * bin, hi = lo + bin;
            let from = lo;
            for (let z = 0; z < 5 && from < hi; z++) {
                const top = z < 4 ? Math.min(hi, Math.max(from, floors[z])) : hi;
                if (top > from) { out[z] += sec * (top - from) / bin; from = top; }
            }
        }
    }
    insState.hrSecs.set(a.i, out);
    return out;
}

function insHrHours(v) {
    return v >= 10 ? `${Math.round(v)} h` : v >= 1 ? `${v.toFixed(1)} h` : `${Math.round(v * 60)} min`;
}

function insHrLegend(sums) {
    const total = sums.reduce((s, v) => s + v, 0) || 1;
    return `<ul class="ins-legend ins-hr-legend">${INS_HR_ZONES.map((z, k) =>
        `<li><span class="ins-swatch" style="background:${z.color}"></span><span class="ins-legend-name">${z.label} ${z.name}</span><span class="ins-legend-amt">${insHrHours(sums[k] / 3600)}</span><span class="ins-legend-val">${insPct(sums[k] / total)}</span></li>`).join('')}</ul>`;
}

// How much of the view has heart rate data, and whether history is still loading.
function insHrNote(pool) {
    const withHr = pool.filter(a => a.hr);
    const done = withHr.filter(a => insHrSecs(a)).length;
    const hr = insState.hr;
    let note = `${insFmt(done)} of ${insFmt(pool.length)} activities with heart rate · ${insState.hrFloors.source}`;
    if (hr.pending > 0) note += ` · still collecting ${insFmt(hr.pending)} older activities`;
    return `<p class="ins-note">${note}</p>`;
}

// A stacked bar of zone hours (or shares, in %); returns SVG rects.
function insHrStack(cx, bw, secs, y, share = false) {
    const total = secs.reduce((s, v) => s + v, 0);
    if (!total) return '';
    let acc = 0, rects = '';
    secs.forEach((v, z) => {
        if (!v) return;
        const a = share ? acc / total * 100 : acc / 3600;
        const b = share ? (acc + v) / total * 100 : (acc + v) / 3600;
        acc += v;
        rects += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(b).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(a) - y(b)).toFixed(1)}" fill="${INS_HR_ZONES[z].color}"/>`;
    });
    return rects;
}

function insHrTip(head, secs) {
    const total = secs.reduce((s, v) => s + v, 0);
    return `${head}: ${insHrHours(total / 3600)} · ` + INS_HR_ZONES.map((z, k) => `${z.label} ${insHrHours(secs[k] / 3600)}`).join(', ');
}

// Weekly time in each zone: the last 12 months, or any year.
function insHrWeeksCard(list, today) {
    if (!insState.hr || !Object.keys(insState.hr.h).length) return '';
    const years = insYears(list.filter(a => a.hr));
    if (!years.length) return '';
    let view = insState.hrYear;
    if (view !== 'last' && !years.includes(view)) view = 'last';
    const mondayOf = iso => insAddDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
    let start, weeks;
    if (view === 'last') {
        weeks = 53;
        start = insAddDays(mondayOf(today.iso), -(weeks - 1) * 7);
    } else {
        start = mondayOf(`${view}-01-01`);
        const last = view === String(today.year) ? today.iso : `${view}-12-31`;
        weeks = Math.round((Date.parse(mondayOf(last)) - Date.parse(start)) / (7 * 864e5)) + 1;
    }
    const startMs = Date.parse(`${start}T12:00:00Z`);
    const buckets = Array.from({ length: weeks }, () => [0, 0, 0, 0, 0]);
    const pool = list.filter(a => {
        const d = a.d.slice(0, 10);
        return view === 'last' ? d >= start : d.startsWith(view);
    });
    const sums = [0, 0, 0, 0, 0];
    pool.forEach(a => {
        const s = insHrSecs(a);
        if (!s) return;
        const w = Math.floor((Date.parse(`${a.d.slice(0, 10)}T12:00:00Z`) - startMs) / (7 * 864e5));
        if (w < 0 || w >= weeks) return;
        s.forEach((v, z) => { buckets[w][z] += v; sums[z] += v; });
    });
    const totals = buckets.map(b => b.reduce((s, v) => s + v, 0) / 3600);
    const yMax = insNiceMax(Math.max(...totals, 1));

    const W = 340, H = 170, L = 30, R = 6, T = 10, B = 20;
    const slot = (W - L - R) / weeks;
    const bw = Math.max(2, slot - (slot > 4 ? 1.5 : 0.6));
    const y = v => T + (1 - v / yMax) * (H - T - B);
    let grid = '';
    for (let k = 0; k <= 4; k++) {
        const v = (yMax / 4) * k;
        grid += `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
        grid += `<text class="ins-axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${insShort(v)}</text>`;
    }
    let bars = '', lastMonth = -1;
    buckets.forEach((secs, w) => {
        const wk = insAddDays(start, w * 7);
        const cx = L + slot * w + slot / 2;
        const tip = insHrTip(`Week of ${insShortDate(wk, today)}`, secs);
        bars += `<g class="ins-hit" data-tip="${insEsc(tip)}"><rect x="${(cx - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(2)}" height="${H - T - B}" fill="transparent"/>${insHrStack(cx, bw, secs, y)}</g>`;
        const mo = Number(wk.slice(5, 7)) - 1;
        if (mo !== lastMonth) {
            if (w > 0 || view !== 'last') bars += `<text class="ins-axis" x="${cx}" y="${H - 6}" text-anchor="start">${INS_MONTHS[mo].slice(0, 1)}</text>`;
            lastMonth = mo;
        }
    });
    const svg = `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours per week in each heart rate zone">${grid}${bars}</svg>`;
    const pills = insPills('hrYear', [['last', 'Last 12 Months'], ...years.map(yr => [yr, yr])], view);
    const avg = totals.reduce((s, v) => s + v, 0) / weeks;
    return insCard('Heart Rate Zones by Week', `${pills}${svg}${insHrLegend(sums)}<p class="ins-note">Average <strong>${insHrHours(avg)}</strong> a week with heart rate</p>${insHrNote(pool)}`, 'hours per week');
}

// Year to year: hours or share per zone each year, or one zone month by month
// with a line per year.
function insHrYearsCard(list, today) {
    if (!insState.hr || !Object.keys(insState.hr.h).length) return '';
    const hrList = list.filter(a => insHrSecs(a));
    if (!hrList.length) return '';
    const view = insState.hrView || 'hours';
    const byYear = {}, byMonth = {};
    hrList.forEach(a => {
        const yr = a.d.slice(0, 4), mo = Number(a.d.slice(5, 7)) - 1;
        const s = insHrSecs(a);
        const yb = byYear[yr] || (byYear[yr] = [0, 0, 0, 0, 0]);
        const mb = byMonth[yr] || (byMonth[yr] = Array.from({ length: 12 }, () => [0, 0, 0, 0, 0]));
        s.forEach((v, z) => { yb[z] += v; mb[mo][z] += v; });
    });
    const years = Object.keys(byYear).sort();
    const W = 340, H = 170, L = 30, R = 6, T = 10, B = 20;
    const y = (v, max) => T + (1 - v / max) * (H - T - B);
    const gridFor = (max, fmt) => {
        let g = '';
        for (let k = 0; k <= 4; k++) {
            const v = (max / 4) * k;
            g += `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v, max)}" y2="${y(v, max)}"/>`;
            g += `<text class="ins-axis" x="${L - 5}" y="${y(v, max) + 3}" text-anchor="end">${fmt(v)}</text>`;
        }
        return g;
    };
    let svg = '', extra = '';
    if (view === 'month') {
        const zone = Number(insState.hrZone ?? 1);
        const series = years.map(yr => byMonth[yr].map(m => m[zone] / 3600));
        const max = insNiceMax(Math.max(...series.flat(), 1));
        const slot = (W - L - R) / 12;
        const x = mo => L + slot * mo + slot / 2;
        const nums = years.map(Number);
        let lines = '', hits = '', labels = '';
        series.forEach((s, k) => {
            const yr = nums[k];
            // This year stops at last month (this month isn't over yet).
            const upto = yr === today.year ? Number(today.iso.slice(5, 7)) - 1 : 12;
            const pts = s.slice(0, upto).map((v, mo) => `${x(mo).toFixed(1)},${y(v, max).toFixed(1)}`);
            lines += `<polyline class="ins-line${yr === today.year ? ' ins-line-main' : ''}" points="${pts.join(' ')}" style="stroke:${insPaceColor(yr, nums, today)}"/>`;
        });
        for (let mo = 0; mo < 12; mo++) {
            const tip = `${INS_MONTHS[mo]} · ${INS_HR_ZONES[zone].label}: ` + years.map((yr, k) =>
                (Number(yr) === today.year && mo >= Number(today.iso.slice(5, 7)) - 1) ? null : `${yr} ${insHrHours(series[k][mo])}`).filter(Boolean).reverse().join(', ');
            hits += `<g class="ins-hit" data-tip="${insEsc(tip)}"><rect x="${(x(mo) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" fill="transparent"/></g>`;
            labels += `<text class="ins-axis" x="${x(mo)}" y="${H - 6}" text-anchor="middle">${INS_MONTHS[mo].slice(0, 1)}</text>`;
        }
        svg = `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${INS_HR_ZONES[zone].label} hours by month, one line per year">${gridFor(max, insShort)}${lines}${labels}${hits}</svg>`;
        const chips = [...nums].reverse().map(yr => `<span class="ins-chip active"><span class="ins-swatch" style="background:${insPaceColor(yr, nums, today)}"></span>${yr}</span>`).join('');
        extra = insPills('hrZone', INS_HR_ZONES.map((z, k) => [String(k), `${z.label} ${z.name}`]), String(zone))
            + svg + `<div class="ins-chips">${chips}</div>`;
    } else {
        const share = view === 'share';
        const totals = years.map(yr => byYear[yr].reduce((s, v) => s + v, 0) / 3600);
        const max = share ? 100 : insNiceMax(Math.max(...totals, 1));
        const slot = (W - L - R) / years.length;
        const bw = Math.max(4, Math.min(26, slot - 4));
        let bars = '';
        years.forEach((yr, i) => {
            const cx = L + slot * i + slot / 2;
            const secs = byYear[yr];
            const total = secs.reduce((s, v) => s + v, 0) || 1;
            const head = `${yr}${Number(yr) === today.year ? ' (so far)' : ''}`;
            const tip = share
                ? `${head}: ` + INS_HR_ZONES.map((z, k) => `${z.label} ${insPct(secs[k] / total)}`).join(', ')
                : insHrTip(head, secs);
            bars += `<g class="ins-hit" data-tip="${insEsc(tip)}"><rect x="${(cx - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" fill="transparent"/>${insHrStack(cx, bw, secs, v => y(v, max), share)}</g>`;
            if (years.length <= 12 || i % 2 === (years.length - 1) % 2) {
                bars += `<text class="ins-axis" x="${cx}" y="${H - 6}" text-anchor="middle">'${yr.slice(2)}</text>`;
            }
        });
        svg = `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Heart rate zone ${share ? 'share' : 'hours'} per year">${gridFor(max, share ? v => `${Math.round(v)}%` : insShort)}${bars}</svg>`;
        const sums = [0, 0, 0, 0, 0];
        years.forEach(yr => byYear[yr].forEach((v, z) => { sums[z] += v; }));
        extra = svg + insHrLegend(sums);
    }
    const pills = insPills('hrView', [['hours', 'Hours'], ['share', 'Share'], ['month', 'Month by Month']], view);
    const sub = view === 'month' ? 'hours per month, by year' : view === 'share' ? 'share of time per year' : 'hours per year';
    return insCard('Heart Rate Zones by Year', `${pills}${extra}${insHrNote(list)}`, sub);
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
    return insCard('Eddington Number', `${insYearPills('eddYear', years, year)}<div class="ins-tiles">${tiles}</div>
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
        const ranked = list => list.filter(a => cat.val(a) > 0)
            .sort((a, b) => cat.val(b) - cat.val(a) || (a.d < b.d ? -1 : 1))
            .slice(0, INS_BEST_TOP);
        const top = ranked(pool);
        // Viewing one year: flag the efforts that are also in the all-time top 5.
        const allTime = year === 'all' ? [] : ranked(sport.acts);
        const rows = top.map((a, i) => {
            const at = allTime.indexOf(a);
            const badge = at < 0 ? '' : `<span class="ins-best-badge${at === 0 ? ' is-best' : ''}">★ ${at === 0 ? 'All-time best' : `All-time #${at + 1}`}</span>`;
            const others = INS_BEST_CATS.filter(c => c.key !== cat.key && c.val(a) > 0).map(c => insBestValue(c.key, c.val(a)));
            const name = insEsc(a.n || 'Untitled');
            const link = a.i ? `<a href="https://www.strava.com/activities/${encodeURIComponent(a.i)}" target="_blank" rel="noopener">${name}</a>` : name;
            return `<li class="ins-best-row${i === 0 ? ' is-first' : ''}">
                <span class="ins-best-rank">${i + 1}</span>
                <span class="ins-best-main"><span class="ins-best-name" title="${name}">${link}</span><span class="ins-best-meta">${badge}${insShortDate(a.d, today)}${others.length ? ` · ${others.join(' · ')}` : ''}</span></span>
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
    add('🏙️ Top 100 Metros', top100.filter(m => m.visited).length, top100.length,
        metros ? `${arr(metros).filter(m => m.visited).length} of ${arr(metros).length} in the top 200` : '');
    if (states) add('🗽 US States', Object.values(states).filter(Boolean).length, Object.keys(states).length);
    add('🏞️ National Parks', arr(parks).filter(p => p.visited).length, arr(parks).length);
    add('⛰️ State High Points', arr(highpoints).filter(p => p.visited).length, arr(highpoints).length);
    add('🏔️ ADK 46ers', arr(adk).filter(p => p.climbed).length, arr(adk).length);
    add('🏔️ Colorado 14ers', arr(co14).filter(p => p.climbed).length, arr(co14).length);
    if (countries) {
        const all = Object.values(countries).flat().filter(c => c && c.name);
        add('🌐 Countries', all.filter(c => c.visited).length, all.length);
    }
    if (summary?.county?.total) add('🗺️ US Counties', summary.county.visited, summary.county.total);
    if (summary?.ecoregion?.l3Total) add('🌿 Ecoregions (Level III)', summary.ecoregion.l3Visited, summary.ecoregion.l3Total);
    if (summary?.pass?.total) add('🛣️ Mountain Passes', summary.pass.climbed, summary.pass.total);

    insState.goals = {
        list: goals,
        extra: [
            summary?.mountain?.summited != null ? ['Peaks Summited', summary.mountain.summited] : null,
            summary?.tile?.visited != null ? ['Tiles', summary.tile.visited] : null,
            summary?.tile?.maxSquare ? ['Max Square', `${summary.tile.maxSquare}×${summary.tile.maxSquare}`] : null,
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

// Screen box around what a tip points at: the drawn marks of a bar group,
// or the element itself (a calendar cell, a goal row). null when a group
// draws nothing.
function insMarkBox(hit) {
    if (hit.tagName.toLowerCase() !== 'g') return hit.getBoundingClientRect();
    const marks = [...hit.querySelectorAll('path, circle, rect')]
        .filter(el => el.getAttribute('fill') !== 'transparent')
        .map(el => el.getBoundingClientRect())
        .filter(r => r.width || r.height);
    if (!marks.length) return null;
    const left = Math.min(...marks.map(r => r.left)), right = Math.max(...marks.map(r => r.right));
    return { left, width: right - left, top: Math.min(...marks.map(r => r.top)), bottom: Math.max(...marks.map(r => r.bottom)) };
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
            // A bar group holds a full-height transparent hit area plus the
            // bar(s): anchor on the bars (a heart rate stack's top segment
            // included), never the hit area, or the tip sits at the top of
            // the chart, far from the bar. A group with nothing drawn (the
            // heart rate month lines) anchors on the finger / pointer.
            const touchY = ev.pointerType === 'mouse' ? null : ev.clientY;
            const r = insMarkBox(hit) || { left: ev.clientX, width: 0, top: ev.clientY, bottom: ev.clientY };
            insShowTip(insEsc(hit.dataset.tip), r.left + r.width / 2, r.top, { bottom: r.bottom, touchY });
        } else {
            insHideTip();
        }
    };
    // Remember what was tapped, so a redraw keeps that card in place.
    root.addEventListener('pointerdown', ev => { insState.lastTap = ev.target; }, true);
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
