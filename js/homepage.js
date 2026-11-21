document.addEventListener('DOMContentLoaded', function () {

    // Stagger the title words' entrance animation
    const letters = document.querySelectorAll('.content h1 span');
    letters.forEach((letter, index) => {
        letter.style.animationDelay = `${index * 0.08}s`;
    });

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    setupBackgroundRotation(reducedMotion);
    setupScrollCue(reducedMotion);
    loadAchievements();
    renderLatestTrips();
    loadTravelStats();
});

/* ------------------------------------------------------------------ */
/* Background slideshow                                                */
/* ------------------------------------------------------------------ */

// Only the photo on screen and the one about to be shown are ever
// downloaded: the next photo is fetched shortly before its turn and the
// swap waits until it has actually loaded, so there is never a blank frame.
function setupBackgroundRotation(reducedMotion) {
    const FIRST_IMAGE = 4;
    const LAST_IMAGE = 34;
    const INTERVAL_MS = 7000;   // time each photo stays on screen
    const PRELOAD_LEAD_MS = 2500; // start fetching the next photo this long before its turn
    const FADE_MS = 1200;       // must match .home-bg-layer transition in homepage.css

    const layers = document.querySelectorAll('.home-bg-layer');
    if (layers.length < 2) return;

    const images = [];
    for (let i = FIRST_IMAGE; i <= LAST_IMAGE; i++) images.push(`images/img${i}.jpg`);

    const saveData = !!(navigator.connection && navigator.connection.saveData);

    let current = 0;   // index into images of the photo on screen
    let front = 0;     // index into layers of the visible layer
    let timer = null;
    let generation = 0; // bumped to cancel any in-flight preload/swap

    function canRotate() {
        return !saveData && !reducedMotion.matches && !document.hidden;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Decode off the main thread where supported so the fade is smooth
                const decoded = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
                decoded.then(() => resolve(img));
            };
            img.onerror = reject;
            img.src = src;
        });
    }

    function show(index) {
        const incoming = layers[1 - front];
        const outgoing = layers[front];
        incoming.style.backgroundImage = `url('${images[index]}')`;
        incoming.classList.add('is-top', 'is-visible');
        outgoing.classList.remove('is-top');
        // Hide the old layer only once the new one has faded in over it
        setTimeout(() => {
            if (!outgoing.classList.contains('is-top')) outgoing.classList.remove('is-visible');
        }, FADE_MS + 100);
        front = 1 - front;
        current = index;
    }

    function stop() {
        generation++;
        clearTimeout(timer);
        timer = null;
    }

    function scheduleNext() {
        stop();
        if (!canRotate()) return;

        const gen = generation;
        const shownAt = Date.now();
        const next = (current + 1) % images.length;

        timer = setTimeout(() => {
            loadImage(images[next]).then(() => {
                if (gen !== generation || !canRotate()) return;
                const wait = Math.max(0, INTERVAL_MS - (Date.now() - shownAt));
                timer = setTimeout(() => {
                    if (gen !== generation || !canRotate()) return;
                    show(next);
                    scheduleNext();
                }, wait);
            }, () => {
                // Broken image: skip it and try the one after on the next turn
                if (gen !== generation) return;
                current = next;
                scheduleNext();
            });
        }, INTERVAL_MS - PRELOAD_LEAD_MS);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop();
        else scheduleNext();
    });

    const onMotionChange = () => scheduleNext();
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
    else if (reducedMotion.addListener) reducedMotion.addListener(onMotionChange);

    // Don't compete with the first photo for bandwidth: start the clock once
    // it is on screen (it is already requested by the inline style in index.html).
    loadImage(images[0]).then(scheduleNext, scheduleNext);
}

/* ------------------------------------------------------------------ */
/* Scroll cue                                                          */
/* ------------------------------------------------------------------ */

function setupScrollCue(reducedMotion) {
    const cue = document.querySelector('.scroll-cue');
    const target = document.getElementById('explore');
    if (!cue || !target) return;
    cue.addEventListener('click', (e) => {
        e.preventDefault();
        target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

/* ------------------------------------------------------------------ */
/* Latest trip reports (data/adventures.js)                            */
/* ------------------------------------------------------------------ */

function renderLatestTrips() {
    const section = document.getElementById('home-trips');
    const grid = document.getElementById('home-trips-grid');
    if (!section || !grid || typeof adventureData === 'undefined' || !adventureData.categories) return;

    // Every dated adventure that has a real trip report page, newest year first.
    // Array.prototype.sort is stable, so within a year the data file's order holds.
    const seen = new Set();
    const reports = Object.values(adventureData.categories)
        .flat()
        .filter(a => a && a.link && a.link !== '#' && /^\d{4}$/.test(String(a.date || '')))
        .filter(a => (seen.has(a.id) ? false : seen.add(a.id)))
        .sort((a, b) => Number(b.date) - Number(a.date));

    // Dates are years only, so many reports tie for "latest". Prefer one per
    // category for variety, then fill any remaining slots newest-first.
    const picks = [];
    const categories = new Set();
    for (const r of reports) {
        if (picks.length === 3) break;
        if (!categories.has(r.category)) { picks.push(r); categories.add(r.category); }
    }
    for (const r of reports) {
        if (picks.length === 3) break;
        if (!picks.includes(r)) picks.push(r);
    }
    picks.sort((a, b) => Number(b.date) - Number(a.date));
    if (!picks.length) return;

    grid.innerHTML = picks.map(r => `
        <a class="home-card home-trip-card" href="${escapeHtml(r.link)}">
            <img class="home-trip-image" src="${escapeHtml(r.image)}" alt="${escapeHtml(r.title)}"
                 loading="lazy" decoding="async" width="640" height="400"
                 onerror="this.onerror=null;this.src='images/placeholder-adventure.svg'">
            <div class="home-trip-body">
                <span class="home-trip-category">${escapeHtml(r.category)}</span>
                <h3 class="home-trip-title">${escapeHtml(r.title)}</h3>
                <span class="home-trip-year">${escapeHtml(r.date)}</span>
            </div>
        </a>
    `).join('');
    section.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Headline travel stats (Worker /travel/* via js/travel-api.js)       */
/* ------------------------------------------------------------------ */

// Counted exactly as js/dashboard.js (displayTravelSummary) and
// js/world-dashboard.js (displayWorldTravelSummary) count them, so the
// numbers here always match the dashboards.
const CONTINENT_KEYS = [
    'northAmericanCountries', 'southAmericanCountries', 'europeanCountries',
    'asianCountries', 'africanCountries', 'oceaniaCountries'
];

const HOME_STATS = [
    {
        label: 'US States',
        href: 'us-dashboard.html',
        fetch: () => TravelAPI.fetchVisitedStates(),
        count: data => {
            if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
            return { count: Object.values(data).filter(v => v).length, total: 50 };
        }
    },
    {
        label: 'Countries',
        href: 'world-dashboard.html',
        fetch: () => TravelAPI.fetchCountries(),
        count: data => {
            if (!data || !CONTINENT_KEYS.every(k => Array.isArray(data[k]))) return null;
            let count = 0, total = 0;
            CONTINENT_KEYS.forEach(k => {
                total += data[k].length;
                count += data[k].filter(c => c.visited).length;
            });
            return { count, total };
        }
    },
    {
        label: 'State High Points',
        href: 'us-dashboard.html',
        fetch: () => TravelAPI.fetchHighPoints(),
        count: data => Array.isArray(data)
            ? { count: data.filter(p => p.visited).length, total: 50 }
            : null
    },
    {
        label: 'National Parks',
        href: 'us-dashboard.html',
        fetch: () => TravelAPI.fetchNationalParks(),
        count: data => Array.isArray(data) && data.length
            ? { count: data.filter(p => p.visited).length, total: data.length }
            : null
    },
    {
        label: 'Top 100 Metros',
        href: 'us-dashboard.html',
        fetch: () => TravelAPI.fetchMetros(),
        count: data => Array.isArray(data)
            ? { count: data.filter(c => c.rank <= 100 && c.visited).length, total: 100 }
            : null
    }
];

async function loadTravelStats() {
    const section = document.getElementById('home-stats');
    const grid = document.getElementById('home-stats-grid');
    if (!section || !grid || typeof TravelAPI === 'undefined') return;

    const results = await Promise.allSettled(HOME_STATS.map(s => s.fetch()));

    // Only stats whose payload arrived and looks right are shown; if none
    // did, the whole row stays hidden rather than showing broken zeros.
    const stats = [];
    results.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        let counted = null;
        try { counted = HOME_STATS[i].count(result.value); } catch (e) { counted = null; }
        if (counted && counted.total > 0) stats.push({ ...HOME_STATS[i], ...counted });
    });

    if (!stats.length) {
        console.warn('Homepage stats unavailable');
        return;
    }

    grid.innerHTML = stats.map(s => {
        const pct = Math.round((s.count / s.total) * 100);
        return `
            <a class="home-card home-stat" href="${s.href}"
               aria-label="${escapeHtml(`${s.label}: ${s.count} of ${s.total}`)}">
                <span class="home-stat-value">${s.count}<span class="home-stat-total">/${s.total}</span></span>
                <span class="home-stat-label">${escapeHtml(s.label)}</span>
                <span class="home-stat-bar" aria-hidden="true"><span style="width: ${pct}%"></span></span>
            </a>
        `;
    }).join('');
    section.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Latest achievements (Worker /achievements)                          */
/* ------------------------------------------------------------------ */

// One entry per achievement type the worker reports (see "Achievements" in
// worker.js), most notable first: a row is coloured and linked by its first
// type, and its badges follow this order.
const ACH_TYPES = {
    country:       { one: 'New Country',     many: 'New Countries',     color: '#42a5f5', href: 'world-dashboard.html' },
    state:         { one: 'New State',       many: 'New States',        color: '#ef5350', href: 'us-dashboard.html?table=states' },
    world_capital: { one: 'World Capital',   many: 'World Capitals',    color: '#ffd54f', href: 'world-dashboard.html?table=capitals' },
    capital:       { one: 'State Capital',   many: 'State Capitals',    color: '#ffa726', href: 'us-dashboard.html?table=capitals' },
    forbes:        { one: 'Forbes 100 City', many: 'Forbes 100 Cities', color: '#f06292', href: 'world-dashboard.html?table=forbes100' },
    metro:         { one: 'Top 100 Metro',   many: 'Top 100 Metros',    color: '#ba68c8', href: 'us-dashboard.html?table=metros' },
    peak:          { one: 'New Peak',        many: 'New Peaks',         color: '#ff7043', href: 'peaks-dashboard.html' },
    best:          { one: 'All-Time Best',   many: 'All-Time Bests',    color: '#26c6da', href: 'strava.html#ins-best' },
    ecoregion:     { one: 'New Ecoregion',   many: 'New Ecoregions',    color: '#9ccc65', href: 'us-dashboard.html?table=ecoregions' },
    tile:          { one: 'Tile Record',     many: 'Tile Records',      color: '#7986cb', href: 'strava.html#tile' },
    county:        { one: 'New County',      many: 'New Counties',      color: '#4caf50', href: 'strava.html#county' },
};
const ACH_ORDER = Object.keys(ACH_TYPES);
const ACH_FIRST_ROWS = 6;   // rows shown before "Show more"
const ACH_MORE_ROWS = 10;   // rows each "Show more" adds
const ACH_NAMES_SHOWN = 3;  // names listed on a badge before "+N"

// "Today", "Yesterday", "Nov 20" this year, else "Nov 20, 2025".
function achDateLabel(date) {
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (date === iso(today)) return 'Today';
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    if (date === iso(y)) return 'Yesterday';
    const d = new Date(`${date}T12:00:00`);
    if (isNaN(d)) return date;
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
}

// "Providence County" → "Providence" once the badge already says counties.
const achShortName = (type, name) => type === 'county'
    ? String(name).replace(/ (County|Parish|Borough|Census Area|Municipality|city)$/i, '')
    : String(name);

function achItemText(it) {
    const name = achShortName(it.type, it.name);
    return it.detail ? `${name} ${it.detail}` : name;
}

function achItemTitle(it) {
    return [it.name, it.detail, it.sub].filter(Boolean).join(' · ');
}

// The achievements lead each card (one line per type, the most notable first
// and largest); the activity that earned them is the small line underneath.
function achRowHtml(row) {
    const byType = new Map();
    row.items.forEach(it => {
        if (!ACH_TYPES[it.type]) return;
        if (!byType.has(it.type)) byType.set(it.type, []);
        byType.get(it.type).push(it);
    });
    const types = ACH_ORDER.filter(t => byType.has(t));
    if (!types.length) return '';
    const lead = ACH_TYPES[types[0]];

    const lines = types.map(type => {
        const cfg = ACH_TYPES[type];
        const list = byType.get(type);
        const shown = list.slice(0, ACH_NAMES_SHOWN).map(achItemText).join(', ');
        const more = list.length > ACH_NAMES_SHOWN ? ` +${list.length - ACH_NAMES_SHOWN} more` : '';
        const label = list.length > 1 ? `${list.length} ${cfg.many}` : cfg.one;
        return `<li><a class="home-ach-item" href="${cfg.href}" style="--ach: ${cfg.color}"
                   title="${escapeHtml(list.map(achItemTitle).join('\n'))}">
                <span class="home-ach-type">${escapeHtml(label)}</span>
                <span class="home-ach-name">${escapeHtml(shown + more)}</span>
            </a></li>`;
    }).join('');

    const acts = row.acts || [];
    const actName = acts.length ? (acts[0].n || 'Untitled activity') : 'Checked off the lists';
    const extra = acts.length > 1 ? ` +${acts.length - 1} more` : '';
    const strava = acts.length
        ? `<a class="home-ach-strava" href="https://www.strava.com/activities/${encodeURIComponent(acts[0].i)}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(actName)} on Strava">Strava <span aria-hidden="true">&#8599;</span></a>`
        : '';
    const meta = [achDateLabel(row.date), row.place].filter(Boolean).map(escapeHtml).join(' · ');
    const first = byType.get(types[0]);

    return `
        <li class="home-card home-ach-row" style="--ach: ${lead.color}">
            <a class="home-ach-link" href="${lead.href}" aria-label="${escapeHtml(`${lead.one}: ${first.map(i => i.name).join(', ')}`)}"></a>
            <ul class="home-ach-items">${lines}</ul>
            <p class="home-ach-act">
                <span class="home-ach-act-name">${escapeHtml(actName)}${extra}</span>
                <span class="home-ach-act-meta">${meta}</span>
                ${strava}
            </p>
        </li>`;
}

async function loadAchievements() {
    const section = document.getElementById('home-achievements');
    const list = document.getElementById('home-ach-list');
    const moreBtn = document.getElementById('home-ach-more');
    if (!section || !list || typeof TRAVEL_WORKER_URL === 'undefined') return;

    let data;
    try {
        const res = await fetch(`${TRAVEL_WORKER_URL}/achievements`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (e) {
        console.warn('Achievements unavailable', e);
        return;
    }
    const rows = (data.rows || []).map(achRowHtml).filter(Boolean);
    if (!rows.length) return;

    let shown = 0;
    const showMore = (n) => {
        list.insertAdjacentHTML('beforeend', rows.slice(shown, shown + n).join(''));
        shown = Math.min(rows.length, shown + n);
        if (moreBtn) moreBtn.hidden = shown >= rows.length;
    };
    showMore(ACH_FIRST_ROWS);
    if (moreBtn) moreBtn.addEventListener('click', () => showMore(ACH_MORE_ROWS));
    section.hidden = false;
}
