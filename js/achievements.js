// Latest Achievements cards (the worker's /achievements, see "Achievements"
// in worker.js): the homepage (js/homepage.js) and the app's Home screen
// (js/app.js) both call mountAchievements(). Styles in css/achievements.css.

function achEsc(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

// One entry per achievement type the worker reports (see "Achievements" in
// worker.js), most notable first: a row is coloured and linked by its first
// type, and its badges follow this order.
const ACH_TYPES = {
    country:       { one: 'New Country',     many: 'New Countries',     color: '#42a5f5', href: '/world-dashboard.html' },
    state:         { one: 'New State',       many: 'New States',        color: '#ef5350', href: '/us-dashboard.html?table=states' },
    world_capital: { one: 'World Capital',   many: 'World Capitals',    color: '#ffd54f', href: '/world-dashboard.html?table=capitals' },
    capital:       { one: 'State Capital',   many: 'State Capitals',    color: '#ffa726', href: '/us-dashboard.html?table=capitals' },
    forbes:        { one: 'Forbes 100 City', many: 'Forbes 100 Cities', color: '#f06292', href: '/world-dashboard.html?table=forbes100' },
    metro:         { one: 'Top 100 Metro',   many: 'Top 100 Metros',    color: '#ba68c8', href: '/us-dashboard.html?table=metros' },
    peak:          { one: 'New Peak',        many: 'New Peaks',         color: '#ff7043', href: '/peaks-dashboard.html' },
    best:          { one: 'All-Time Best',   many: 'All-Time Bests',    color: '#26c6da', href: '/strava.html#ins-best' },
    ecoregion:     { one: 'New Ecoregion',   many: 'New Ecoregions',    color: '#9ccc65', href: '/us-dashboard.html?table=ecoregions' },
    tile:          { one: 'Tile Record',     many: 'Tile Records',      color: '#7986cb', href: '/strava.html#tile' },
    county:        { one: 'New County',      many: 'New Counties',      color: '#4caf50', href: '/strava.html#county' },
};
const ACH_ORDER = Object.keys(ACH_TYPES);
// In the app (mountAchievements({ app: true })) a hunter opens its own screen
// and a travel page opens with ?app=1 (its menu becomes a back bar).
const ACH_APP_ROUTES = { county: '#county', tile: '#tile', ecoregion: '#ecoregion', best: '#dashboard' };
let achInApp = false;
function achHref(type) {
    const href = ACH_TYPES[type].href;
    if (!achInApp) return href;
    if (ACH_APP_ROUTES[type]) return ACH_APP_ROUTES[type];
    const [path, hash = ''] = href.split('#');
    return `${path}${path.includes('?') ? '&' : '?'}app=1${hash ? `#${hash}` : ''}`;
}
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
function achRowHtml(row, index) {
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
        return `<li><a class="ach-item" href="${achHref(type)}" style="--ach: ${cfg.color}"
                   title="${achEsc(list.map(achItemTitle).join('\n'))}">
                <span class="ach-type">${achEsc(label)}</span>
                <span class="ach-name">${achEsc(shown + more)}</span>
            </a></li>`;
    }).join('');

    const acts = row.acts || [];
    const actName = acts.length ? (acts[0].n || 'Untitled activity') : 'Checked off the lists';
    const extra = acts.length > 1 ? ` +${acts.length - 1} more` : '';
    // Several activities: the footer opens a pop-up listing each one with what
    // it checked off (achOpenActs); one activity links straight to Strava.
    const strava = acts.length > 1
        ? `<button type="button" class="ach-strava ach-acts-btn" data-ach-row="${index}">${acts.length} activities <span aria-hidden="true">&#9656;</span></button>`
        : acts.length
        ? `<a class="ach-strava" href="https://www.strava.com/activities/${encodeURIComponent(acts[0].i)}" target="_blank" rel="noopener" aria-label="Open ${achEsc(actName)} on Strava">Strava <span aria-hidden="true">&#8599;</span></a>`
        : '';
    const meta = row.place ? achEsc(row.place) : '';
    const first = byType.get(types[0]);

    return `
        <li class="ach-row" style="--ach: ${lead.color}">
            <a class="ach-link" href="${achHref(types[0])}" aria-label="${achEsc(`${lead.one}: ${first.map(i => i.name).join(', ')}`)}"></a>
            <div class="ach-top">
                <ul class="ach-items">${lines}</ul>
                <time class="ach-date" datetime="${achEsc(row.date)}">${achEsc(achDateLabel(row.date))}</time>
            </div>
            <p class="ach-act">
                ${acts.length > 1
                    ? `<button type="button" class="ach-act-name ach-acts-btn" data-ach-row="${index}">${achEsc(actName)}${extra}</button>`
                    : `<span class="ach-act-name">${achEsc(actName)}</span>`}
                <span class="ach-act-meta">${meta}</span>
                ${strava}
            </p>
        </li>`;
}

// Fills `list` from the worker's /achievements and shows `section`; it stays
// hidden when the worker can't be reached and nothing is cached (in the app,
// app/sw.js serves the last copy offline). `first` rows show, then `step`
// more per tap of `more`.
async function mountAchievements({ section, list, more, url, first = ACH_FIRST_ROWS, step = ACH_MORE_ROWS, app = false }) {
    if (!section || !list || !url) return;
    achInApp = app;
    let data;
    try {
        const res = await fetch(`${url}/achievements`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (e) {
        console.warn('Achievements unavailable', e);
        return;
    }
    const dataRows = data.rows || [];
    const rows = dataRows.map((row, i) => achRowHtml(row, i)).filter(Boolean);
    if (!rows.length) return;
    list.addEventListener('click', e => {
        const btn = e.target.closest('.ach-acts-btn');
        if (btn) achOpenActs(dataRows[Number(btn.dataset.achRow)]);
    });

    let shown = 0;
    const showMore = (n) => {
        list.insertAdjacentHTML('beforeend', rows.slice(shown, shown + n).join(''));
        shown = Math.min(rows.length, shown + n);
        if (more) more.hidden = shown >= rows.length;
    };
    showMore(first);
    if (more) more.addEventListener('click', () => showMore(step));
    section.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Pop-up: every activity of a multi-activity achievement row          */
/* ------------------------------------------------------------------ */

// Same look as the World Travel page's Strava pop-up (openStravaDialog in
// js/world-dashboard.js); each activity lists what it checked off.
const ACH_SPORT_ICONS = [
    [/Ride$/, '🚴'], [/Run$/, '🏃'], [/^(Hike|Walk|Snowshoe)$/, '🥾'], [/Ski|Snowboard/, '⛷️'],
    [/Swim/, '🏊'], [/Kayak|Canoe|Row|Paddl|Sail|Surf/, '🛶'],
];
const achSportIcon = t => (ACH_SPORT_ICONS.find(([re]) => re.test(t || '')) || [null, '💪'])[1];
const achSportLabel = t => String(t || 'Activity').replace(/([a-z])([A-Z])/g, '$1 $2').replace('E Bike', 'E-Bike');

function achActStats(a) {
    const stats = [];
    if (a.m) {
        const mins = Math.round(a.m / 60);
        stats.push(mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`);
    }
    if (a.di) stats.push(`${(a.di / 1609.344).toFixed(1)} mi`);
    if (a.e) stats.push(`${Math.round(a.e * 3.28084).toLocaleString('en-US')} ft`);
    return stats.join(' · ');
}

function achOpenActs(row) {
    if (!row || !(row.acts || []).length) return;
    const tags = a => {
        const mine = row.items.filter(it => Number(it.a) === Number(a.i) && ACH_TYPES[it.type]);
        return ACH_ORDER.filter(t => mine.some(it => it.type === t)).map(t => {
            const cfg = ACH_TYPES[t];
            const list = mine.filter(it => it.type === t);
            const names = list.slice(0, ACH_NAMES_SHOWN).map(achItemText).join(', ')
                + (list.length > ACH_NAMES_SHOWN ? ` +${list.length - ACH_NAMES_SHOWN}` : '');
            return `<span class="ach-tag" style="--ach: ${cfg.color}" title="${achEsc(list.map(achItemTitle).join('\n'))}"><b>${achEsc(list.length > 1 ? `${list.length} ${cfg.many}` : cfg.one)}</b> ${achEsc(names)}</span>`;
        }).join('');
    };
    const dialog = document.createElement('dialog');
    dialog.className = 'ach-dialog';
    dialog.setAttribute('aria-label', `Activities on ${achDateLabel(row.date)}`);
    dialog.innerHTML = `
        <div class="ach-dialog-head">
            <h3>${achEsc(achDateLabel(row.date))}${row.place ? ` · ${achEsc(row.place)}` : ''}</h3>
            <button type="button" class="ach-dialog-close" aria-label="Close">×</button>
        </div>
        <p class="ach-dialog-sub">${row.acts.length} activities</p>
        <ul class="ach-dialog-list">${row.acts.map(a => {
            const t = tags(a);
            return `<li><a class="ach-dialog-act" href="https://www.strava.com/activities/${encodeURIComponent(a.i)}" target="_blank" rel="noopener">
                <span class="ach-dialog-icon" aria-hidden="true">${achSportIcon(a.t)}</span>
                <span class="ach-dialog-main">
                    <span class="ach-dialog-name">${achEsc(a.n || 'Activity')} <span class="ach-dialog-ext" aria-hidden="true">&#8599;</span></span>
                    <span class="ach-dialog-meta">${achEsc(achSportLabel(a.t))}${achActStats(a) ? ` · ${achEsc(achActStats(a))}` : ''}</span>
                    ${t ? `<span class="ach-dialog-tags">${t}</span>` : ''}
                </span>
            </a></li>`;
        }).join('')}</ul>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.ach-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
}
