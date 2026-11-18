// ── Travel for invited users (/app/?user=1) ──────────────────────────────
//
// The owner's Travel tab opens his hand-kept travel pages (US Travel, World
// Travel, Peaks). An invited person has no hand-kept lists, so their Travel
// tab is worked out from their own Strava activities instead:
//
//   US States  — a state counts once an activity starts in it (the geocoded
//                start cell, the same data as the Dashboard's Regions table).
//   Countries  — likewise for countries, out of the 195 in data/countries.json.
//   Peaks      — the site's peak lists (US state high points, Colorado 14ers,
//                Adirondack 46ers, British Isles High Five, country high
//                points) matched against Mountain Hunter's summits with the
//                Peaks dashboard's own matching (PeakMatch, js/peak-match.js).
//
// Each gets its own screen (#states, #countries, #peaks), opened from Home's
// Travel cards or the Travel tab. Everything is computed on the page from
// strava.js's globals (currentSlim, currentCache, mountainPeaks, …); strava.js
// calls renderUserTravel() whenever its activities or places change and when
// Mountain Hunter finishes a scan. Without ?user this file does nothing.

const UT_ENABLED = Boolean(window.STRAVA_USER);

const UT_STATE_ABBR = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
    Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
    Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
    Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
    Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
    'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
    Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
    'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
    Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
const UT_ABBR_STATE = Object.fromEntries(Object.entries(UT_STATE_ABBR).map(([n, a]) => [a, n]));

// A tile-grid map of the states: each row lists its tiles from the left edge,
// '' for a gap.
const UT_STATE_GRID = [
    ['', '', '', '', '', '', '', '', '', '', '', 'ME'],
    ['AK', '', '', '', '', '', '', '', '', '', 'VT', 'NH'],
    ['', 'WA', 'ID', 'MT', 'ND', 'MN', 'IL', 'WI', 'MI', 'NY', 'RI', 'MA'],
    ['', 'OR', 'NV', 'WY', 'SD', 'IA', 'IN', 'OH', 'PA', 'NJ', 'CT'],
    ['', 'CA', 'UT', 'CO', 'NE', 'MO', 'KY', 'WV', 'VA', 'MD', 'DE'],
    ['', '', 'AZ', 'NM', 'KS', 'AR', 'TN', 'NC', 'SC', 'DC'],
    ['', '', '', '', 'OK', 'LA', 'MS', 'AL', 'GA'],
    ['HI', '', '', '', 'TX', '', '', '', '', 'FL'],
];

// Nominatim's English country names (and territories) → data/countries.json.
const UT_COUNTRY_ALIASES = {
    'United States': 'United States of America', 'Puerto Rico': 'United States of America',
    'United States Virgin Islands': 'United States of America', Guam: 'United States of America',
    'Northern Mariana Islands': 'United States of America', 'American Samoa': 'United States of America',
    Czechia: 'Czech Republic', 'Democratic Republic of the Congo': 'DR Congo',
    'Congo-Kinshasa': 'DR Congo', 'Congo-Brazzaville': 'Congo', 'Republic of the Congo': 'Congo',
    "Côte d'Ivoire": 'Ivory Coast', "Cote d'Ivoire": 'Ivory Coast', Türkiye: 'Turkey',
    'Cabo Verde': 'Cape Verde', 'Federated States of Micronesia': 'Micronesia',
    'Palestinian Territory': 'Palestine', 'Palestinian Territories': 'Palestine',
    'East Timor': 'Timor-Leste', 'The Bahamas': 'Bahamas', 'The Gambia': 'Gambia',
    'Holy See': 'Vatican City', 'Vatican': 'Vatican City', Burma: 'Myanmar',
    'Hong Kong': 'China', Macau: 'China', Macao: 'China', 'Republic of Korea': 'South Korea',
    "Democratic People's Republic of Korea": 'North Korea', 'Russian Federation': 'Russia',
    'Lao PDR': 'Laos', 'Viet Nam': 'Vietnam', 'Brunei Darussalam': 'Brunei',
    'Syrian Arab Republic': 'Syria', 'Republic of Moldova': 'Moldova', 'Macedonia': 'North Macedonia',
    'Greenland': 'Denmark', 'Faroe Islands': 'Denmark', 'Aruba': 'Netherlands', 'Curaçao': 'Netherlands',
    'Sint Maarten': 'Netherlands', 'Caribbean Netherlands': 'Netherlands',
    'French Polynesia': 'France', 'New Caledonia': 'France', 'Martinique': 'France',
    'Guadeloupe': 'France', 'Réunion': 'France', 'French Guiana': 'France', 'Mayotte': 'France',
    'Saint Martin': 'France', 'Saint Barthélemy': 'France',
    'Gibraltar': 'United Kingdom', 'Bermuda': 'United Kingdom', 'Cayman Islands': 'United Kingdom',
    'British Virgin Islands': 'United Kingdom', 'Turks and Caicos Islands': 'United Kingdom',
    'Isle of Man': 'United Kingdom', 'Jersey': 'United Kingdom', 'Guernsey': 'United Kingdom',
    'Christmas Island': 'Australia', 'Norfolk Island': 'Australia', 'Cook Islands': 'New Zealand',
};

const UT_CONTINENTS = [
    ['northAmericanCountries', 'North America'],
    ['southAmericanCountries', 'South America'],
    ['europeanCountries', 'Europe'],
    ['africanCountries', 'Africa'],
    ['asianCountries', 'Asia'],
    ['oceaniaCountries', 'Oceania'],
];

// The Peaks dashboard's lists (PEAK_LISTS in js/peaks-dashboard.js); only the
// reference data is used, never the owner's visited flags.
const UT_PEAK_LISTS = [
    { id: 'highpoints',        label: 'US State High Points',    url: '/data/highPoints.json',             region: p => UT_ABBR_STATE[p.state] || p.state },
    { id: 'colorado14ers',     label: 'Colorado 14ers',          url: '/data/colorado14ers.json' },
    { id: 'adk46ers',          label: 'Adirondack 46ers',        url: '/data/adirondack46ers.json' },
    { id: 'britishIsles',      label: 'British Isles High Five', url: '/data/british-isles-high-five.json', region: p => p.country, unit: 'm' },
    { id: 'countryHighpoints', label: 'Country High Points',     url: '/data/country-highpoints.json',     region: p => p.country },
];

const utRef = { countries: null, flags: null, peakLists: null, loading: null };
let utServerSummits = null;     // /summits/peaks, until Mountain Hunter has scanned on this page
const utOpen = new Set();       // peak list ids expanded on the Peaks screen

function utEsc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function utDate(d) {
    if (!d) return '';
    const date = new Date(`${String(d).slice(0, 10)}T12:00:00`);
    return isNaN(date) ? String(d) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function utActLink(act) {
    if (!act?.actId && !act?.id) return '';
    const id = act.actId || act.id;
    const name = act.actName || act.name || 'Activity';
    return `<a href="https://www.strava.com/activities/${encodeURIComponent(id)}" target="_blank" rel="noopener">${utEsc(name)}</a>`;
}

function utLoadReference() {
    if (utRef.loading) return utRef.loading;
    const get = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    utRef.loading = Promise.all([
        get('/data/countries.json'),
        get('/data/country-flags.json'),
        Promise.all(UT_PEAK_LISTS.map(l => get(l.url))),
    ]).then(([countries, flags, lists]) => {
        utRef.countries = countries;
        utRef.flags = flags || {};
        utRef.peakLists = lists.map(l => (Array.isArray(l) ? l : []));
        renderUserTravel();
    });
    return utRef.loading;
}

// ── Places from activities ──────────────────────────────────────────────────

// Every activity's start place, oldest first, so the first one seen in a
// state / country is its first visit.
function utPlaces() {
    if (typeof currentSlim === 'undefined' || !currentSlim.length) return null;
    const states = new Map();     // state name → { first, count }
    const countries = new Map();  // countries.json name (or the geocoded name) → { first, count, raw }
    [...currentSlim].sort(byStartTime).forEach(a => {
        if (!Array.isArray(a.l)) return;
        const geo = currentCache[gridKey(a.l)];
        if (!geo || !geo.c || geo.c === 'Unknown') return;
        const country = UT_COUNTRY_ALIASES[geo.c] || geo.c;
        const c = countries.get(country) || { first: a, count: 0 };
        c.count++;
        countries.set(country, c);
        if (SUBDIVISION_BY_COUNTRY[geo.c]?.id === 'us' && UT_STATE_ABBR[geo.s]) {
            const s = states.get(geo.s) || { first: a, count: 0 };
            s.count++;
            states.set(geo.s, s);
        }
    });
    return { states, countries };
}

// countries.json name → { name, continent }
function utCountryIndex() {
    const map = new Map();
    if (!utRef.countries) return map;
    UT_CONTINENTS.forEach(([key, continent]) => {
        (utRef.countries[key] || []).forEach(c => map.set(c.name, { name: c.name, continent }));
    });
    return map;
}

function utFlag(name) {
    const code = utRef.flags?.[name];
    return code ? `<img class="ut-flag" src="/images/flags/${code}.png" alt="" loading="lazy">` : '<span class="ut-flag ut-flag-none" aria-hidden="true">🏳️</span>';
}

// ── Summits ─────────────────────────────────────────────────────────────────

// The person's summits in /summits/peaks form. Once Mountain Hunter has
// scanned on this page its in-memory result is newer than the saved one.
function utSummits() {
    if (typeof mountainHunterReady !== 'undefined' && mountainHunterReady && mountainPeaks.length) {
        const out = [];
        mountainPeaks.forEach(p => {
            const id = Number(p.id);
            const visits = mountainVisits.get(id);
            if (!visits?.length || hiddenPeakIds.has(id)) return;
            const first = [...visits].sort((a, b) => String(a.date).localeCompare(String(b.date))
                || (Number(a.actId) || 0) - (Number(b.actId) || 0))[0];
            out.push({ id, name: p.name || '', lat: p.lat, lng: p.lng, ele: p.ele, first });
        });
        return out;
    }
    return utServerSummits;
}

function utFetchServerSummits() {
    fetch(`${WORKER_URL}/summits/peaks`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
            utServerSummits = data?.peaks || [];
            renderUserTravel();
        })
        .catch(() => { utServerSummits = []; renderUserTravel(); });
}

function utPeakResults() {
    const summits = utSummits();
    if (!utRef.peakLists || !summits || typeof PeakMatch === 'undefined') return null;
    return UT_PEAK_LISTS.map((cfg, i) => {
        const items = utRef.peakLists[i];
        const matches = PeakMatch.match(items, summits);
        return { cfg, items, matches };
    });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function utStat(value, label) {
    return `<div class="county-stat-item"><span class="county-stat-number">${value}</span><span class="county-stat-label">${label}</span></div>`;
}

function utBar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `<div class="ut-bar" role="presentation"><div class="ut-bar-fill" style="width:${pct}%"></div></div>`;
}

function utLoading(text) {
    return `<p class="no-location-note">${utEsc(text)}</p>`;
}

function renderStates(places) {
    const el = document.getElementById('ut-states');
    if (!el) return;
    if (!places) { el.innerHTML = utLoading('Loading activities…'); return; }
    const { states } = places;
    const fifty = [...states.keys()].filter(s => s !== 'District of Columbia').length;
    const recent = [...states.entries()].sort((a, b) => byStartTime(b[1].first, a[1].first))[0];

    const grid = UT_STATE_GRID.map(row => row.map(abbr => {
        if (!abbr) return '<span class="ut-tile ut-tile-gap"></span>';
        const name = UT_ABBR_STATE[abbr];
        const s = states.get(name);
        const title = s ? `${name}: first ${utDate(s.first.d)}` : `${name}: not yet`;
        return `<span class="ut-tile${s ? ' ut-tile-done' : ''}" title="${utEsc(title)}">${abbr}</span>`;
    }).join('') + '<span class="ut-tile ut-tile-gap"></span>'.repeat(12 - row.length)).join('');

    const visited = [...states.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const remaining = Object.keys(UT_STATE_ABBR).filter(n => !states.has(n));

    el.innerHTML = `
        <div class="county-stats-bar">
            ${utStat(`${fifty} / 50`, 'States')}
            ${utStat(`${Math.round((fifty / 50) * 100)}%`, 'Done')}
            ${utStat(recent ? UT_STATE_ABBR[recent[0]] : '—', 'Newest')}
        </div>
        <div class="ut-state-grid" aria-label="US states map">${grid}</div>
        <p class="ut-note">A state counts once an activity starts there.${states.has('District of Columbia') ? ' DC is on the map but not in the 50.' : ''}</p>
        <h3 class="ut-h">Visited <span>${visited.length}</span></h3>
        <ul class="ut-list">${visited.map(([name, s]) => `
            <li><span class="ut-abbr">${UT_STATE_ABBR[name]}</span>
                <span class="ut-main"><strong>${utEsc(name)}</strong><small>First ${utDate(s.first.d)} · ${utActLink({ id: s.first.i, name: s.first.n })}</small></span>
                <span class="ut-count">${s.count.toLocaleString()}</span></li>`).join('')}
        </ul>
        ${remaining.length ? `<h3 class="ut-h">Not yet <span>${remaining.length}</span></h3>
        <div class="ut-chips">${remaining.map(n => `<span class="ut-chip">${utEsc(n)}</span>`).join('')}</div>` : ''}`;
}

function renderCountries(places) {
    const el = document.getElementById('ut-countries');
    if (!el) return;
    if (!places || !utRef.countries) { el.innerHTML = utLoading('Loading activities…'); return; }
    const index = utCountryIndex();
    const total = index.size;
    const byContinent = new Map(UT_CONTINENTS.map(([, name]) => [name, []]));
    const other = [];
    places.countries.forEach((c, name) => {
        const ref = index.get(name);
        if (ref) byContinent.get(ref.continent).push([name, c]);
        else other.push([name, c]);
    });
    const counted = [...byContinent.values()].reduce((n, list) => n + list.length, 0);
    const continentsReached = [...byContinent.values()].filter(l => l.length).length;

    const row = ([name, c]) => `
        <li>${utFlag(name)}
            <span class="ut-main"><strong>${utEsc(name)}</strong><small>First ${utDate(c.first.d)} · ${utActLink({ id: c.first.i, name: c.first.n })}</small></span>
            <span class="ut-count">${c.count.toLocaleString()}</span></li>`;

    const continentTotals = Object.fromEntries(UT_CONTINENTS.map(([key, name]) => [name, (utRef.countries[key] || []).length]));
    el.innerHTML = `
        <div class="county-stats-bar">
            ${utStat(`${counted} / ${total}`, 'Countries')}
            ${utStat(`${continentsReached} / 6`, 'Continents')}
            ${utStat(`${total ? Math.round((counted / total) * 100) : 0}%`, 'Of the world')}
        </div>
        <ul class="ut-progress">${[...byContinent.entries()].map(([name, list]) => `
            <li><span>${name}</span>${utBar(list.length, continentTotals[name])}<em>${list.length} / ${continentTotals[name]}</em></li>`).join('')}
        </ul>
        <p class="ut-note">A country counts once an activity starts there; territories count for their country (Puerto Rico for the US, Hong Kong for China).</p>
        ${[...byContinent.entries()].filter(([, l]) => l.length).map(([name, list]) => `
            <h3 class="ut-h">${name} <span>${list.length}</span></h3>
            <ul class="ut-list">${list.sort((a, b) => a[0].localeCompare(b[0])).map(row).join('')}</ul>`).join('')}
        ${other.length ? `<h3 class="ut-h">Other places <span>${other.length}</span></h3>
            <ul class="ut-list">${other.map(row).join('')}</ul>` : ''}
        ${counted ? '' : '<p class="no-location-note">No countries yet — places fill in as your activities are located.</p>'}`;
}

function renderPeaks() {
    const el = document.getElementById('ut-peaks');
    if (!el) return;
    const results = utPeakResults();
    if (!results) { el.innerHTML = utLoading('Loading summits…'); return; }
    const summits = utSummits() || [];
    const listDone = results.reduce((n, r) => n + r.matches.size, 0);
    const hp = results.find(r => r.cfg.id === 'highpoints');

    el.innerHTML = `
        <div class="county-stats-bar">
            ${utStat(summits.length.toLocaleString(), 'Summits')}
            ${utStat(`${hp ? hp.matches.size : 0} / ${hp ? hp.items.length : 50}`, 'High points')}
            ${utStat(listDone.toLocaleString(), 'List peaks')}
        </div>
        <p class="ut-note">Peaks are confirmed from your Strava routes by Mountain Hunter${typeof mountainHunterReady !== 'undefined' && !mountainHunterReady ? ' (still scanning — this fills in as it goes)' : ''}.</p>
        ${results.map(({ cfg, items, matches }) => {
            const open = utOpen.has(cfg.id);
            const unit = cfg.unit || 'ft';
            const peakRow = (item, m) => `
                <li class="${m ? 'ut-done' : ''}">
                    <span class="ut-check" aria-hidden="true">${m ? '✓' : ''}</span>
                    <span class="ut-main"><strong>${utEsc(item.name)}</strong>
                        <small>${[cfg.region ? utEsc(cfg.region(item)) : '', item.elevation ? `${Number(item.elevation).toLocaleString()} ${unit}` : '',
                            m ? `${utDate(m.peak.first?.date)} · ${utActLink(m.peak.first)}` : ''].filter(Boolean).join(' · ')}</small></span></li>`;
            const sorted = [...items].sort((a, b) => (Boolean(matches.get(b)) - Boolean(matches.get(a)))
                || (Number(b.elevation) || 0) - (Number(a.elevation) || 0));
            return `
            <section class="ut-peak-list${open ? ' open' : ''}">
                <button type="button" class="ut-peak-head" data-list="${cfg.id}" aria-expanded="${open}">
                    <span class="ut-main"><strong>${cfg.label}</strong>${utBar(matches.size, items.length)}</span>
                    <em>${matches.size} / ${items.length}</em>
                    <span class="ut-chev" aria-hidden="true">›</span>
                </button>
                ${open ? `<ul class="ut-list ut-peak-items">${sorted.map(item => peakRow(item, matches.get(item))).join('')}</ul>` : ''}
            </section>`;
        }).join('')}`;
}

function setUserTravelStats(places) {
    const set = (key, text) => document.querySelectorAll(`[data-stat="${key}"]`).forEach(el => { if (text) el.textContent = text; });
    if (places) {
        const fifty = [...places.states.keys()].filter(s => s !== 'District of Columbia').length;
        set('u-states', `${fifty} / 50 states`);
        if (utRef.countries) {
            const index = utCountryIndex();
            const n = [...places.countries.keys()].filter(c => index.has(c)).length;
            set('u-countries', `${n} countr${n === 1 ? 'y' : 'ies'}`);
        }
    }
    const results = utPeakResults();
    const hp = results?.find(r => r.cfg.id === 'highpoints');
    if (hp) set('u-peaks', `${hp.matches.size} / ${hp.items.length} high points`);
}

let utRenderQueued = false;
function renderUserTravel() {
    if (!UT_ENABLED || utRenderQueued) return;
    utRenderQueued = true;
    requestAnimationFrame(() => {
        utRenderQueued = false;
        const places = utPlaces();
        setUserTravelStats(places);
        // Only the screen on show is drawn; the others draw when opened.
        const shown = screen => !document.getElementById(`screen-${screen}`)?.hidden;
        if (shown('states')) renderStates(places);
        if (shown('countries')) renderCountries(places);
        if (shown('peaks')) renderPeaks();
    });
}

if (UT_ENABLED) {
    document.addEventListener('DOMContentLoaded', () => {
        utLoadReference();
        utFetchServerSummits();
        document.getElementById('ut-peaks')?.addEventListener('click', e => {
            const head = e.target.closest('.ut-peak-head');
            if (!head) return;
            const id = head.dataset.list;
            if (utOpen.has(id)) utOpen.delete(id); else utOpen.add(id);
            renderPeaks();
        });
    });
    window.addEventListener('hashchange', renderUserTravel);
    document.addEventListener('stravaload', renderUserTravel);
}
