// Peaks dashboard. Every list lives in Cloudflare KV (/travel/<type>) and falls
// back to its static /data copy until it has been seeded; the owner's first
// edit of an unseeded list seeds it from that copy. Each list is also matched
// against Mountain Hunter's Strava summits (/summits/peaks) so the page shows
// where the hand-kept list and Strava disagree, the step before the lists are
// ticked off from Strava directly.

// key: the field /travel/toggle identifies an entry by; done: the completion
// flag (state highpoints are shared with the US dashboard, which uses
// `visited`); unit: the elevation unit stored in the file (shown in feet).
const PEAK_LISTS = {
    adk46ers:          { label: 'Adirondack 46ers',        url: 'data/adirondack46ers.json',        csv: 'adirondack-46ers.csv',         key: 'name',    done: 'climbed' },
    colorado14ers:     { label: 'Colorado 14ers',          url: 'data/colorado14ers.json',          csv: 'colorado-14ers.csv',           key: 'name',    done: 'climbed' },
    highpoints:        { label: 'US State High Points',    url: 'data/highPoints.json',             csv: 'state-highpoints.csv',         key: 'state',   done: 'visited', region: 'state',   regionLabel: 'State' },
    britishIsles:      { label: 'British Isles High Five', url: 'data/british-isles-high-five.json', csv: 'british-isles-high-five.csv', key: 'name',    done: 'climbed', region: 'country', regionLabel: 'Country', unit: 'm' },
    countryHighpoints: { label: 'Country High Points',     url: 'data/country-highpoints.json',     csv: 'country-highpoints.csv',       key: 'country', done: 'climbed', region: 'country', regionLabel: 'Country' },
};

// A summited OSM peak this close to a list peak is that peak. Further out
// (list coordinates are rougher than OSM's, especially abroad) it only counts
// when the names agree; OSM names are often in local script, so distance has
// to carry the match on its own for those.
const STRAVA_NEAR_M = 400;
const STRAVA_NAMED_M = 3000;
const NAME_STOPWORDS = new Set(['mount', 'mt', 'mont', 'monte', 'mountain', 'pico', 'pic', 'peak',
    'cerro', 'gora', 'volcan', 'nevado', 'the', 'de', 'del', 'la', 'jabal', 'jebel', 'hill', 'doi', 'bukit', 'puncak']);

const lists = {};          // type → { data, source, reason }
const sortState = {};      // type → { col, dir }
let summitedPeaks = null;  // from /summits/peaks; null while loading
let stravaError = null;
let editMode = false;
let refreshOwnerUI = () => {};

document.addEventListener('DOMContentLoaded', async function () {
    const types = Object.keys(PEAK_LISTS);
    try {
        const results = await Promise.all(types.map(t => TravelAPI.fetchPeakList(t, PEAK_LISTS[t].url)));
        types.forEach((t, i) => {
            lists[t] = results[i];
            sortState[t] = { col: 'elevation', dir: 'desc' };
        });
        await Promise.all(types.map(t => useStaticReference(t)));
    } catch (error) {
        console.error('Error loading peak data:', error);
        return;
    }
    const selector = document.getElementById('table-selector');
    selector.addEventListener('change', () => render());
    setupEditMode();
    setupCsvExport();
    render();

    try {
        summitedPeaks = await TravelAPI.fetchSummitedPeaks();
    } catch (err) {
        stravaError = err.message;
        summitedPeaks = [];
    }
    render();
});

// A seeded list keeps the coordinates and names it was seeded with, and
// nothing on the page edits them, so a coordinate fixed in the /data file would
// never reach the Strava matching, nor a renamed peak (Clingmans Dome → Kuwohi)
// the table. Both are reference data: take them from the file. A list keyed by
// name can't be renamed this way — its name is what the toggle matches.
async function useStaticReference(type) {
    const list = lists[type];
    if (list.source !== 'cloudflare') return;
    const cfg = PEAK_LISTS[type];
    try {
        const res = await fetch(cfg.url);
        if (!res.ok) return;
        const byKey = new Map((await res.json()).map(item => [item[cfg.key], item]));
        list.data.forEach(item => {
            const ref = byKey.get(item[cfg.key]);
            if (!ref) return;
            if (Array.isArray(ref.coords)) item.coords = ref.coords;
            if (cfg.key !== 'name' && ref.name) item.name = ref.name;
        });
    } catch { /* keep the seeded coordinates and names */ }
}

function currentType() {
    return document.getElementById('table-selector').value;
}

function render() {
    displayPeaksSummary();
    updateTable(currentType());
    renderSourceNote(currentType());
    renderComparison(currentType());
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isDone(type, item) {
    return Boolean(item[PEAK_LISTS[type].done]);
}

function elevationFt(type, item) {
    return PEAK_LISTS[type].unit === 'm' ? Math.round(item.elevation * 3.28084) : item.elevation;
}

function regionOf(type, item) {
    const field = PEAK_LISTS[type].region;
    return field ? item[field] || '' : '';
}

function stravaLink(visit) {
    return `<a href="https://www.strava.com/activities/${encodeURIComponent(visit.actId)}" target="_blank" rel="noopener" title="${esc(visit.actName)}">${esc(visit.date || 'Strava')}</a>`;
}

function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const dφ = (lat2 - lat1) * Math.PI / 180;
    const dλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// "Mount Stanley (Margherita Peak)" / "Corrán Tuathail / Carrauntoohil" →
// ['stanley', 'margherita'] / ['corran tuathail', 'carrauntoohil']
function nameKeys(name) {
    return String(name || '').split(/[\/();,]/)
        .map(part => part.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
            .filter(w => w && !NAME_STOPWORDS.has(w)).join(' '))
        .filter(k => k.length >= 2);
}

function namesAgree(a, b) {
    const ka = nameKeys(a), kb = nameKeys(b);
    return ka.some(x => kb.some(y => x === y ||
        (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))));
}

// ── Strava matching ─────────────────────────────────────────────────────────

const matchCache = new Map();  // type → Map(item → { peak, distance })

// One summited peak confirms at most one list peak, so two list peaks a few
// hundred metres apart (North Maroon / Maroon) can't both claim one summit.
// Name-confirmed pairs are assigned first, then the closest.
function stravaMatches(type) {
    if (!summitedPeaks) return null;
    if (matchCache.has(type)) return matchCache.get(type);
    const pairs = [];
    lists[type].data.forEach(item => {
        if (!Array.isArray(item.coords)) return;
        const [lng, lat] = item.coords;
        summitedPeaks.forEach(peak => {
            const d = haversineM(lat, lng, peak.lat, peak.lng);
            if (d > STRAVA_NAMED_M) return;
            const named = namesAgree(item.name, peak.name);
            if (named || d <= STRAVA_NEAR_M) pairs.push({ item, peak, d, named });
        });
    });
    pairs.sort((a, b) => (b.named - a.named) || (a.d - b.d));
    const matches = new Map();
    const usedPeaks = new Set();
    pairs.forEach(({ item, peak, d }) => {
        if (matches.has(item) || usedPeaks.has(peak.id)) return;
        matches.set(item, { peak, distance: Math.round(d) });
        usedPeaks.add(peak.id);
    });
    matchCache.set(type, matches);
    return matches;
}

// ── Owner controls ──────────────────────────────────────────────────────────

function setupEditMode() {
    const btn = document.getElementById('edit-mode-btn');
    // Edit Mode / Export CSV are owner-only; visitors just see the lock.
    refreshOwnerUI = TravelAdmin.initControls(
        document.getElementById('owner-login-btn'),
        loggedIn => { if (!loggedIn && editMode) setEditMode(false); }
    );
    btn.addEventListener('click', () => setEditMode(!editMode));
}

function setEditMode(on) {
    const btn = document.getElementById('edit-mode-btn');
    editMode = on;
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Exit Edit Mode' : 'Edit Mode';
    render();
}

function setupCsvExport() {
    document.getElementById('export-csv-btn').addEventListener('click', () => {
        const type = currentType();
        const cfg = PEAK_LISTS[type];
        const matches = stravaMatches(type);
        const headers = ['Rank', 'Peak Name']
            .concat(cfg.region ? [cfg.regionLabel] : [])
            .concat(['Elevation (ft)', 'Status', 'Strava First Summit']);
        const rows = sortedData(type).map((item, i) => [i + 1, item.name]
            .concat(cfg.region ? [regionOf(type, item)] : [])
            .concat([elevationFt(type, item), isDone(type, item) ? 'Summited' : 'Not Summited',
                matches?.get(item)?.peak.first.date || '']));
        downloadCsv(headers, rows, cfg.csv);
    });
}

function downloadCsv(headers, rows, filename) {
    const escape = val => {
        const str = String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
            ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const csv = [headers.map(escape).join(',')]
        .concat(rows.map(row => row.map(escape).join(',')))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// A list that isn't in Cloudflare yet is seeded from the static copy the page
// is showing before its first edit, so the edit lands on top of it.
async function ensureSeeded(type, password) {
    const list = lists[type];
    if (list.source === 'cloudflare') return;
    if (list.reason !== 'unseeded') throw new Error('Cloudflare is unreachable — reload and try again');
    await TravelAPI.seed(type, list.data, password);
    list.source = 'cloudflare';
    delete list.reason;
}

async function handleToggle(type, item) {
    const password = TravelAdmin.getPassword();
    if (!password) return;
    const cfg = PEAK_LISTS[type];

    try {
        await ensureSeeded(type, password);
        await TravelAPI.toggleVisited(type, item[cfg.key], password);
        item[cfg.done] = !item[cfg.done];
        render();
    } catch (err) {
        alert('Toggle failed: ' + err.message);
        if (err.message.includes('Invalid password')) {
            TravelAdmin.logout();
            refreshOwnerUI();
            setEditMode(false);
        }
    }
}

// ── Rendering ───────────────────────────────────────────────────────────────

function displayPeaksSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const selected = currentType();

    const cards = Object.entries(PEAK_LISTS).map(([type, cfg]) => {
        const data = lists[type].data;
        const done = data.filter(item => isDone(type, item)).length;
        const pct = data.length ? ((done / data.length) * 100).toFixed(0) : 0;
        const matches = stravaMatches(type);
        const strava = matches ? `<span class="stat-sub">${matches.size} on Strava</span>` : '';
        return `
            <button type="button" class="summary-stat peaks-card${type === selected ? ' active' : ''}" data-type="${type}">
                <div class="stat-number-container">
                    <span class="stat-number">${done}</span>
                    <span class="stat-total">/${data.length}</span>
                    <span class="stat-percentage">(${pct}%)</span>
                </div>
                <span class="stat-label">${cfg.label}</span>
                ${strava}
            </button>`;
    }).join('');

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="other-stats peaks-cards">${cards}</div>
        </div>`;

    summaryContainer.querySelectorAll('.peaks-card').forEach(card => {
        card.addEventListener('click', () => {
            document.getElementById('table-selector').value = card.dataset.type;
            render();
        });
    });
}

function renderSourceNote(type) {
    const el = document.getElementById('peaks-source');
    const list = lists[type];
    if (list.source === 'cloudflare') {
        el.textContent = '';
        el.hidden = true;
        return;
    }
    el.hidden = false;
    el.textContent = list.reason === 'unseeded'
        ? 'This list isn’t saved in Cloudflare yet — showing the copy bundled with the site. Your first edit saves it to Cloudflare.'
        : 'Couldn’t reach Cloudflare — showing the copy bundled with the site, which may be out of date.';
}

function sortValue(type, item, col) {
    switch (col) {
        case 'elevation': return elevationFt(type, item);
        case 'name':      return item.name;
        case 'region':    return regionOf(type, item);
        case 'strava':    return stravaMatches(type)?.get(item)?.peak.first.date || '';
        case 'done':      return isDone(type, item) ? 1 : 0;
        default:          return 0;
    }
}

function sortedData(type) {
    const { col, dir } = sortState[type];
    const sign = dir === 'asc' ? 1 : -1;
    return [...lists[type].data].sort((a, b) => {
        const av = sortValue(type, a, col), bv = sortValue(type, b, col);
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        return sign * cmp || elevationFt(type, b) - elevationFt(type, a);
    });
}

function updateTable(type) {
    const cfg = PEAK_LISTS[type];
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = '';

    const matches = stravaMatches(type);
    const showStrava = !stravaError;

    const columns = [
        { label: 'Rank', key: 'elevation', cls: 'col-rank' },
        { label: 'Peak Name', key: 'name', cls: 'col-name' },
        cfg.region && { label: cfg.regionLabel, key: 'region', cls: 'col-region' },
        { label: 'Elevation (ft)', key: 'elevation', cls: 'col-num' },
        showStrava && { label: 'Strava', key: 'strava', cls: 'col-strava' },
        { label: 'Status', key: 'done', cls: 'col-status' },
    ].filter(Boolean);

    const table = document.createElement('table');
    table.className = 'travel-table travel-table--fit';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const { col, dir } = sortState[type];
    columns.forEach(({ label, key, cls }) => {
        const th = document.createElement('th');
        const isActive = col === key;
        th.classList.add('sortable', cls);
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
        th.appendChild(document.createTextNode(label));
        th.appendChild(indicator);

        th.addEventListener('click', () => {
            const state = sortState[type];
            if (state.col === key) {
                state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                const defaultDir = (key === 'done' || key === 'elevation' || key === 'strava') ? 'desc' : 'asc';
                sortState[type] = { col: key, dir: defaultDir };
            }
            updateTable(type);
        });
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    sortedData(type).forEach((item, index) => {
        const done = isDone(type, item);
        const row = document.createElement('tr');
        row.className = done ? 'visited' : 'not-visited';

        const match = matches?.get(item);
        let stravaCell = '';
        if (showStrava) {
            const content = !matches ? '…'
                : match ? stravaLink(match.peak.first) : '—';
            const cls = match && !done ? ' strava-only' : '';
            const title = match
                ? ` title="${esc(`${match.peak.name || 'OSM peak'} · ${match.peak.activities} activit${match.peak.activities === 1 ? 'y' : 'ies'} · ${match.distance} m from the list point`)}"`
                : '';
            stravaCell = `<td class="col-strava${cls}"${title}>${content}</td>`;
        }

        row.innerHTML = `
            <td class="col-rank">${index + 1}</td>
            <td class="col-name">${esc(item.name)}</td>
            ${cfg.region ? `<td class="col-region">${esc(regionOf(type, item))}</td>` : ''}
            <td class="col-num">${elevationFt(type, item).toLocaleString()}</td>
            ${stravaCell}
            <td class="col-status ${editMode ? 'status-toggle' : ''}">${done ? '✅' : '⬜'}</td>
        `;
        if (item.note) row.querySelector('.col-name').title = item.note;

        if (editMode) {
            row.querySelector('.col-status').addEventListener('click', () => handleToggle(type, item));
        }
        tbody.appendChild(row);
    });
    table.appendChild(tbody);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrapper';
    wrapper.appendChild(table);
    tableContainer.appendChild(wrapper);

    // Detect horizontal overflow and show/hide scroll hint
    function checkScroll() {
        const hasScroll = wrapper.scrollWidth > wrapper.clientWidth + 1;
        wrapper.classList.toggle('has-scroll', hasScroll);
        const atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 1;
        wrapper.classList.toggle('scrolled-end', atEnd);
    }
    wrapper.addEventListener('scroll', checkScroll);
    checkScroll();
}

// Where the hand-kept list and Strava disagree, like Metro Hunter's
// comparison on strava.html: marked but never summited on Strava (climbed
// before Strava, not recorded, or coordinates too far from OSM's) and summited
// on Strava but not marked yet.
function renderComparison(type) {
    const el = document.getElementById('strava-comparison');
    const cfg = PEAK_LISTS[type];

    if (stravaError) {
        el.innerHTML = `<h3>Marked vs. Strava</h3>
            <p class="peaks-compare-note">Couldn’t load Strava summits (${esc(stravaError)}).</p>`;
        return;
    }
    const matches = stravaMatches(type);
    if (!matches) {
        el.innerHTML = `<h3>Marked vs. Strava</h3><p class="peaks-compare-note">Loading Strava summits…</p>`;
        return;
    }

    const byElevation = (a, b) => elevationFt(type, b) - elevationFt(type, a);
    const data = lists[type].data;
    const marked = data.filter(item => isDone(type, item));
    const confirmed = marked.filter(item => matches.has(item));
    const markedOnly = marked.filter(item => !matches.has(item)).sort(byElevation);
    const stravaOnly = data.filter(item => !isDone(type, item) && matches.has(item)).sort(byElevation);

    const stat = (n, label, cls = '') =>
        `<div class="peaks-compare-stat ${cls}"><span class="peaks-compare-number">${n}</span><span class="peaks-compare-label">${label}</span></div>`;

    el.innerHTML = `
        <h3>Marked vs. Strava</h3>
        <p class="peaks-compare-note">Strava summits come from
            <a href="strava.html#mountain">Mountain Hunter</a>: a hike, run, walk, ski tour or bike ride that passes
            within 50&nbsp;m of an OpenStreetMap summit (or a hiker summit, where the true one is closed). Activities count
            once Mountain Hunter has processed them on the Strava page.</p>
        <div class="peaks-compare-stats">
            ${stat(marked.length, 'Marked')}
            ${stat(matches.size, 'On Strava')}
            ${stat(confirmed.length, 'Both', 'is-confirmed')}
            ${stat(markedOnly.length, 'Marked only', 'is-marked-only')}
            ${stat(stravaOnly.length, 'Strava only', 'is-strava-only')}
        </div>`;

    const section = (title, cls, items, withStrava) => {
        if (!items.length) return;
        const h = document.createElement('h4');
        h.className = `peaks-compare-heading ${cls}`;
        h.textContent = title;
        el.appendChild(h);

        const showAction = withStrava && editMode;
        const table = document.createElement('table');
        table.className = 'travel-table travel-table--fit';
        table.innerHTML = `<thead><tr>
            <th class="col-name">Peak Name</th>
            ${cfg.region ? `<th class="col-region">${cfg.regionLabel}</th>` : ''}
            <th class="col-num">Elevation (ft)</th>
            ${withStrava ? '<th class="col-strava">First summit</th><th class="col-num">Activities</th>' : ''}
            ${showAction ? '<th class="col-status"></th>' : ''}
        </tr></thead>`;
        const tbody = document.createElement('tbody');
        items.forEach(item => {
            const match = matches.get(item);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-name">${esc(item.name)}</td>
                ${cfg.region ? `<td class="col-region">${esc(regionOf(type, item))}</td>` : ''}
                <td class="col-num">${elevationFt(type, item).toLocaleString()}</td>
                ${withStrava ? `<td class="col-strava">${stravaLink(match.peak.first)}</td><td class="col-num">${match.peak.activities}</td>` : ''}
                ${showAction ? '<td class="col-status"><button type="button" class="table-action-btn">Mark climbed</button></td>' : ''}`;
            if (showAction) tr.querySelector('button').addEventListener('click', () => handleToggle(type, item));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        const wrapper = document.createElement('div');
        wrapper.className = 'table-scroll-wrapper';
        wrapper.appendChild(table);
        el.appendChild(wrapper);
    };

    section(`Marked but not on Strava (${markedOnly.length}) — climbed before Strava, or not recorded`,
        'is-marked-only', markedOnly, false);
    section(`On Strava but not marked (${stravaOnly.length}) — summited on a recorded activity`,
        'is-strava-only', stravaOnly, true);
    if (!markedOnly.length && !stravaOnly.length) {
        const p = document.createElement('p');
        p.className = 'peaks-compare-note';
        p.textContent = 'The list and Strava agree.';
        el.appendChild(p);
    }
}
