// Dashboard insights: the app Dashboard's at-a-glance charts.
//
// strava.js calls renderInsights(filtered) from applyFilters() whenever the
// activity list or the sport filters change; it draws into #strava-insights
// when the page has that mount point (only /app/ does) and does nothing
// otherwise. Charts are hand-written SVG — no chart library.
//
// Cards, top to bottom:
//   1. This year vs the same date last year (distance, hours, climbing, days)
//   2. Year pace: cumulative distance this year vs the two before
//   3. Year by year bars (activities / distance / hours / climbing)
//   4. Sport mix donut by hours, for one year or all time
//   5. Consistency calendar (last 52 weeks) + current / best streak
//   6. Eddington numbers (ride + run, in miles) — ignore the sport filter
//   7. Goal progress bars from the worker's /summary and travel lists
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

const INS_BAR_METRICS = [
    ['count', 'Activities'],
    ['dist',  'Miles'],
    ['hours', 'Hours'],
    ['elev',  'Climbing'],
];

const insState = {
    barMetric: 'dist',
    donutYear: null,      // null = this year
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
        insGoalsCard(),
    ].join('');

    insBindTooltips(mount);
    if (!insState.goals && !insState.goalsLoading) insLoadGoals();
}

function insCard(title, body, sub = '') {
    return `<section class="ins-card"><header class="ins-card-head"><h2>${title}</h2>${sub ? `<span class="ins-card-sub">${sub}</span>` : ''}</header>${body}</section>`;
}

// ── 1. This year vs last year ──────────────────────────────────────────────
function insCompareCard(list, today) {
    const ytd = y => list.filter(a => a.d.startsWith(String(y)) && a.d.slice(5, 10) <= today.md);
    const cur = insTotals(ytd(today.year));
    const prev = insTotals(ytd(today.year - 1));
    const tiles = [
        ['Distance', cur.mi, prev.mi, 'mi'],
        ['Moving time', cur.hours, prev.hours, 'h'],
        ['Climbing', cur.ft, prev.ft, 'ft'],
        ['Active days', cur.days, prev.days, ''],
    ].map(([label, v, p, unit]) => {
        let delta = '<span class="ins-delta">no data last year</span>';
        if (p > 0) {
            const pct = Math.round((v / p - 1) * 100);
            const cls = pct >= 0 ? 'up' : 'down';
            delta = `<span class="ins-delta ${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span> <span class="ins-delta-ref">vs ${insShort(p)}</span>`;
        }
        return `<div class="ins-tile">
            <span class="ins-tile-label">${label}</span>
            <span class="ins-tile-value">${insShort(v)}${unit ? `<small> ${unit}</small>` : ''}</span>
            <span class="ins-tile-foot">${delta}</span>
        </div>`;
    }).join('');
    return insCard(`${today.year} so far`, `<div class="ins-tiles">${tiles}</div>`, `vs ${today.year - 1} to the same date`);
}

// ── 2. Year pace line ──────────────────────────────────────────────────────
function insPaceCard(list, today) {
    const years = [today.year, today.year - 1, today.year - 2];
    const colors = ['var(--app-accent, #3ddc84)', '#3987e5', '#898781'];
    const todayIdx = insDayOfYear(today.iso);
    // cumulative miles per day of year (0..365)
    const series = years.map(y => {
        const perDay = new Array(366).fill(0);
        list.forEach(a => { if (a.d.startsWith(String(y))) perDay[insDayOfYear(a.d)] += (a.di || 0) / INS_M_PER_MI; });
        const last = y === today.year ? todayIdx : 365;
        const cum = [];
        let run = 0;
        for (let i = 0; i <= last; i++) { run += perDay[i]; cum.push(run); }
        return cum;
    });
    if (!series.some(s => s[s.length - 1] > 0)) return '';

    const W = 340, H = 190, L = 34, R = 50, T = 10, B = 22;
    const max = Math.max(...series.map(s => s[s.length - 1])) || 1;
    const yMax = insNiceMax(max);
    const x = i => L + (i / 365) * (W - L - R);
    const y = v => T + (1 - v / yMax) * (H - T - B);

    let grid = '';
    for (let k = 0; k <= 4; k++) {
        const v = (yMax / 4) * k;
        grid += `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
        grid += `<text class="ins-axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${insShort(v)}</text>`;
    }
    [0, 3, 6, 9].forEach(m => {
        const idx = insDayOfYear(`${today.year}-${String(m + 1).padStart(2, '0')}-01`);
        grid += `<text class="ins-axis" x="${x(idx)}" y="${H - 6}">${INS_MONTHS[m]}</text>`;
    });

    // Draw older years first so this year sits on top.
    let lines = '';
    let labels = '';
    const labelYs = [];
    [2, 1, 0].forEach(k => {
        const s = series[k];
        if (!s.length || s[s.length - 1] <= 0) return;
        const step = 2;
        const pts = [];
        for (let i = 0; i < s.length; i += step) pts.push(`${x(i).toFixed(1)},${y(s[i]).toFixed(1)}`);
        pts.push(`${x(s.length - 1).toFixed(1)},${y(s[s.length - 1]).toFixed(1)}`);
        lines += `<polyline class="ins-line${k === 0 ? ' ins-line-main' : ''}" points="${pts.join(' ')}" stroke="${colors[k]}"/>`;
        // direct label at the line's end, nudged apart when ends collide
        let ly = y(s[s.length - 1]) + 3;
        labelYs.forEach(o => { if (Math.abs(o - ly) < 11) ly = o + (ly >= o ? 11 : -11); });
        labelYs.push(ly);
        const lx = k === 0 ? x(s.length - 1) + 4 : W - R + 4;
        labels += `<text class="ins-line-label" x="${lx}" y="${ly}" ${k === 0 ? 'style="font-weight:650"' : ''}>${years[k]}</text>`;
    });
    // today marker
    const s0 = series[0];
    const dot = s0.length ? `<circle cx="${x(s0.length - 1)}" cy="${y(s0[s0.length - 1])}" r="4" fill="${colors[0]}" stroke="var(--app-surface, #131715)" stroke-width="2"/>` : '';

    const cur = s0[s0.length - 1] || 0;
    const prevSame = series[1][Math.min(todayIdx, series[1].length - 1)] || 0;
    const projected = cur / (todayIdx + 1) * 365;
    let note = `On pace for <strong>${insFmt(projected)} mi</strong> in ${today.year}`;
    if (prevSame > 0) {
        const diff = cur - prevSame;
        note += ` · ${insFmt(Math.abs(diff))} mi ${diff >= 0 ? 'ahead of' : 'behind'} ${today.year - 1}`;
    }

    const data = JSON.stringify({ years, colors, series: series.map(s => s.map(v => Math.round(v))) });
    const svg = `<svg class="ins-svg ins-pace" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative miles by day of year for ${years.join(', ')}" data-pace='${insEsc(data)}' data-geom="${L},${R},${W}">
        ${grid}${lines}${dot}${labels}
        <line class="ins-crosshair" y1="${T}" y2="${H - B}" x1="0" x2="0" style="display:none"/>
    </svg>`;
    return insCard('Year pace', `${svg}<p class="ins-note">${note}</p>`, 'cumulative miles');
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
    const metric = insState.barMetric;
    const unit = { count: '', dist: ' mi', hours: ' h', elev: ' ft' }[metric];
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
        const tip = `${yr}${isCur ? ' (so far)' : ''}: ${insFmt(v)}${unit}`;
        bars += `<g class="ins-hit" data-tip="${insEsc(tip)}">
            <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>
            ${path ? `<path d="${path}" class="ins-bar${isCur ? ' ins-bar-cur' : ''}"/>` : ''}
        </g>`;
        if (i === maxIdx || isCur) bars += `<text class="ins-bar-label" x="${cx}" y="${top - 4}" text-anchor="middle">${insShort(v)}</text>`;
        if (years.length <= 12 || i % 2 === (years.length - 1) % 2) {
            bars += `<text class="ins-axis" x="${cx}" y="${H - 6}" text-anchor="middle">'${yr.slice(2)}</text>`;
        }
    });
    const toggle = `<div class="metric-toggle ins-toggle" role="group" aria-label="Year metric">${INS_BAR_METRICS.map(([m, label]) =>
        `<button type="button" class="metric-toggle-btn${metric === m ? ' active' : ''}" aria-pressed="${metric === m}" onclick="insSetBarMetric('${m}')">${label}</button>`).join('')}</div>`;
    const svg = `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${insEsc(INS_BAR_METRICS.find(m => m[0] === metric)[1])} per year">${grid}${bars}</svg>`;
    return insCard('Year by year', toggle + svg);
}

function insSetBarMetric(m) {
    insState.barMetric = m;
    renderInsights(insState.lastFiltered);
}

// ── 4. Sport mix donut ─────────────────────────────────────────────────────
function insDonutCard(list, today) {
    const years = [...new Set(list.map(a => a.d.slice(0, 4)))].sort().reverse();
    if (!years.length) return '';
    let sel = insState.donutYear || String(today.year);
    if (sel !== 'all' && !years.includes(sel)) sel = years[0];
    const pool = sel === 'all' ? list : list.filter(a => a.d.startsWith(sel));
    // Hours when moving time is known, activity count otherwise.
    const useHours = pool.some(a => a.m);
    const totals = new Map(INS_FAMILIES.map(f => [f.key, { v: 0, n: 0 }]));
    pool.forEach(a => {
        const t = totals.get(insFamily(a.t).key);
        t.v += useHours ? (a.m || 0) / 3600 : 1;
        t.n++;
    });
    const sum = [...totals.values()].reduce((s, t) => s + t.v, 0);
    const slices = INS_FAMILIES.filter(f => totals.get(f.key).v > 0)
        .map(f => ({ ...f, ...totals.get(f.key) }))
        .sort((a, b) => b.v - a.v);

    const R = 64, r = 42, C = 75;
    let angle = -Math.PI / 2;
    let arcs = '';
    const gap = slices.length > 1 ? 0.025 : 0; // 2px-ish surface gap between slices
    slices.forEach(s => {
        const frac = s.v / (sum || 1);
        const a0 = angle + gap / 2, a1 = angle + frac * Math.PI * 2 - gap / 2;
        angle += frac * Math.PI * 2;
        const tip = `${s.key}: ${insFmt(s.v, useHours ? 0 : 0)}${useHours ? ' h' : ''} · ${Math.round(frac * 100)}% · ${s.n} activities`;
        if (frac >= 0.999) {
            arcs += `<g class="ins-hit" data-tip="${insEsc(tip)}"><circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${s.color}" stroke-width="${R - r}"/></g>`;
            return;
        }
        if (a1 <= a0) return;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
        arcs += `<g class="ins-hit" data-tip="${insEsc(tip)}"><path fill="${s.color}" d="M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z"/></g>`;
    });
    const centre = `<text class="ins-donut-num" x="${C}" y="${C + 2}" text-anchor="middle">${insShort(sum)}</text>
        <text class="ins-donut-unit" x="${C}" y="${C + 16}" text-anchor="middle">${useHours ? 'hours' : 'activities'}</text>`;
    const legend = slices.map(s => `<li><span class="ins-swatch" style="background:${s.color}"></span><span class="ins-legend-name">${s.key}</span><span class="ins-legend-val">${Math.round(s.v / (sum || 1) * 100)}%</span></li>`).join('');

    const pills = ['all', ...years].slice(0, 9).map(y =>
        `<button type="button" class="filter-pill ins-year-pill${y === sel ? ' active' : ''}" onclick="insSetDonutYear('${y}')">${y === 'all' ? 'All time' : y}</button>`).join('');
    const body = `<div class="ins-pills">${pills}</div>
        <div class="ins-donut-wrap">
            <svg class="ins-svg ins-donut" viewBox="0 0 150 150" role="img" aria-label="Sport mix by ${useHours ? 'hours' : 'activities'}">${arcs}${centre}</svg>
            <ul class="ins-legend">${legend}</ul>
        </div>`;
    return insCard('Sport mix', body, useHours ? 'by moving time' : 'by activities');
}

function insSetDonutYear(y) {
    insState.donutYear = y;
    renderInsights(insState.lastFiltered);
}

// ── 5. Consistency calendar ────────────────────────────────────────────────
function insCalendarCard(list, today) {
    const perDay = new Map();
    list.forEach(a => {
        const d = a.d.slice(0, 10);
        const e = perDay.get(d) || { n: 0, sec: 0, mi: 0 };
        e.n++;
        e.sec += a.m || 0;
        e.mi += (a.di || 0) / INS_M_PER_MI;
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

    // 52 full weeks + this partial one, weeks starting Monday.
    const todayDow = (new Date(`${today.iso}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
    const weeks = 53;
    const start = insAddDays(today.iso, -(todayDow + (weeks - 1) * 7));
    const cell = 6, g = 1.5, L = 14, T = 12;
    const W = L + weeks * (cell + g), H = T + 7 * (cell + g);
    // Levels by moving time (or activity count when durations are missing).
    const level = e => {
        if (!e) return 0;
        const h = e.sec / 3600;
        if (!e.sec) return Math.min(4, e.n);
        return h < 0.75 ? 1 : h < 1.5 ? 2 : h < 3 ? 3 : 4;
    };
    let cells = '', months = '', active = 0, lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
            const iso = insAddDays(start, w * 7 + d);
            if (iso > today.iso) continue;
            const e = perDay.get(iso);
            if (e) active++;
            const tip = e
                ? `${iso}: ${e.n} activit${e.n === 1 ? 'y' : 'ies'} · ${insFmt(e.mi, 1)} mi · ${insFmt(e.sec / 3600, 1)} h`
                : `${iso}: rest day`;
            cells += `<rect class="ins-hit ins-cell l${level(e)}" x="${L + w * (cell + g)}" y="${T + d * (cell + g)}" width="${cell}" height="${cell}" rx="1.5" data-tip="${insEsc(tip)}"/>`;
            if (d === 0) {
                const m = Number(iso.slice(5, 7)) - 1;
                if (m !== lastMonth && Number(iso.slice(8, 10)) <= 7 && w < weeks - 2) {
                    months += `<text class="ins-axis" x="${L + w * (cell + g)}" y="${T - 4}">${INS_MONTHS[m]}</text>`;
                }
                lastMonth = m;
            }
        }
    }
    const dayLabels = ['M', '', 'W', '', 'F', '', ''].map((t, d) => t ? `<text class="ins-axis" x="0" y="${T + d * (cell + g) + cell - 0.5}">${t}</text>` : '').join('');
    const svg = `<svg class="ins-svg ins-calendar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Active days over the last year">${months}${dayLabels}${cells}</svg>`;
    const legend = `<div class="ins-cal-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="ins-cell-key l${l}"></i>`).join('')}<span>More</span></div>`;
    const bestNote = bestEnd ? ` <span class="ins-tile-foot">ended ${bestEnd}</span>` : '';
    const stats = `<div class="ins-tiles ins-tiles-3">
        <div class="ins-tile"><span class="ins-tile-label">Current streak</span><span class="ins-tile-value">${cur}<small> d</small></span></div>
        <div class="ins-tile"><span class="ins-tile-label">Best streak</span><span class="ins-tile-value">${best}<small> d</small></span>${bestNote}</div>
        <div class="ins-tile"><span class="ins-tile-label">Active days</span><span class="ins-tile-value">${active}</span><span class="ins-tile-foot">last 12 months</span></div>
    </div>`;
    return insCard('Consistency', stats + svg + legend, 'shade = moving time');
}

// ── 6. Eddington number ────────────────────────────────────────────────────
// E = the largest number such that you have E days of at least E miles.
function insEddington(types) {
    const perDay = new Map();
    const pool = typeof currentSlim !== 'undefined' ? currentSlim : [];
    pool.forEach(a => {
        if (!types.includes(a.t) || !a.d) return;
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
    const tiles = INS_EDDINGTON.map(({ label, types }) => {
        const { E, next, need } = insEddington(types);
        return `<div class="ins-tile ins-tile-hero">
            <span class="ins-tile-label">${label}</span>
            <span class="ins-tile-value">${E}</span>
            <span class="ins-tile-foot">${need} more day${need === 1 ? '' : 's'} of ${next}+ mi for ${next}</span>
        </div>`;
    }).join('');
    return insCard('Eddington number', `<div class="ins-tiles">${tiles}</div>
        <p class="ins-note">E days with at least E miles in a day. Ride counts road, gravel and mountain bike rides; Run counts road and trail runs.</p>`);
}

// ── 7. Goal progress ───────────────────────────────────────────────────────
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
        if (pace) { insPaceHover(pace, ev); return; }
        root.querySelectorAll('.ins-hit.is-hover').forEach(el => el.classList.remove('is-hover'));
        if (hit && root.contains(hit)) {
            hit.classList.add('is-hover');
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
    };
    root.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') clear(); });
    document.addEventListener('pointerdown', ev => { if (!root.contains(ev.target)) clear(); });
    window.addEventListener('scroll', clear, { passive: true });
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
    const rows = data.years.map((y, k) => {
        const s = data.series[k];
        if (!s.length || day >= s.length) return '';
        return `<div><span class="ins-swatch" style="background:${data.colors[k]}"></span>${y}: <strong>${insFmt(s[day])} mi</strong></div>`;
    }).join('');
    insShowTip(`<div class="ins-tooltip-head">${label}</div>${rows}`, ev.clientX, box.top + 10, {
        bottom: box.bottom,
        touchY: ev.pointerType === 'mouse' ? null : ev.clientY,
    });
}
