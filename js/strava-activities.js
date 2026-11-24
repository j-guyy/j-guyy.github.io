// Strava activities in a place: the count cell and the pop-up behind it,
// shared by the World Travel Countries table and the US Travel States table.
// Both read the worker's /activities/by-country, which places activities by
// their start point (the geocode cache's Nominatim names): a place's totals
// are { count, sec, di, longest, latest }, where longest is the activity with
// the most moving time (not distance, so a long day on foot outranks a longer,
// faster ride). The pop-up fetches every activity there when it opens.
const StravaActivities = (() => {
    const WORKER = typeof TRAVEL_WORKER_URL === 'string' ? TRAVEL_WORKER_URL : 'https://strava-worker.justinguyette.workers.dev';

    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const SPORT_ICONS = [
        [/Ride$/, '🚴'], [/Run$/, '🏃'], [/^(Hike|Walk|Snowshoe)$/, '🥾'], [/Ski|Snowboard/, '⛷️'],
        [/Swim/, '🏊'], [/Kayak|Canoe|Row|Paddl|Sail|Surf/, '🛶'],
    ];
    const sportIcon = t => (SPORT_ICONS.find(([re]) => re.test(t || '')) || [null, '💪'])[1];
    const sportLabel = t => String(t || 'Activity').replace(/([a-z])([A-Z])/g, '$1 $2').replace('E Bike', 'E-Bike');

    // 32h 36m, 2h 05m, 48m (2,782h past 100 hours)
    function formatDuration(sec) {
        const mins = Math.round((sec || 0) / 60);
        const h = Math.floor(mins / 60), m = mins % 60;
        if (h >= 100) return `${Math.round(sec / 3600).toLocaleString()}h`;
        return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    }

    const formatMiles = m => {
        const mi = (m || 0) / 1609.344;
        return `${mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString()} mi`;
    };

    function formatActDate(d) {
        const date = new Date(`${String(d || '').slice(0, 10)}T12:00:00`);
        return isNaN(date) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const stravaUrl = a => `https://www.strava.com/activities/${encodeURIComponent(a.i)}`;

    // Fetches the totals per place. by: { country } for every country, or
    // { country: 'United States', group: 'region' } for its states. Resolves
    // to the worker's { countries | regions } map.
    function fetchTotals({ group = null, country = null } = {}) {
        const qs = group ? `?group=${encodeURIComponent(group)}&country=${encodeURIComponent(country)}` : '';
        return fetch(`${WORKER}/activities/by-country${qs}`)
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => (group ? data.regions : data.countries) || {});
    }

    // The count as a button that opens the pop-up. s: the place's totals, or
    // null; state: loading | ready | error; none: the tooltip when there are none.
    function cell(s, state, none = 'No Strava activities started here') {
        if (!s) {
            const empty = state === 'loading' ? '…' : '—';
            const why = state === 'error' ? 'Strava activities unavailable right now'
                : state === 'loading' ? 'Loading Strava activities…' : none;
            return `<span class="state-progress-none" title="${why}">${empty}</span>`;
        }
        const title = `${s.count.toLocaleString()} ${s.count === 1 ? 'activity' : 'activities'}, ${formatDuration(s.sec)} moving`
            + (s.longest ? `\nLongest: ${s.longest.n || 'Activity'} (${formatDuration(s.longest.m)})` : '') + '\nTap for all of them';
        // 2.7k on a narrow phone, so the row still fits.
        const short = s.count >= 1000 ? `${(s.count / 1000).toFixed(1)}k` : String(s.count);
        return `<button type="button" class="strava-count" title="${esc(title)}">`
            + `<span class="count-long">${s.count.toLocaleString()}</span><span class="count-short">${short}</span></button>`;
    }

    // The pop-up: the place's totals, its longest and latest activities, then
    // every activity there (newest first, or sorted by moving time / distance),
    // shown a page at a time.
    const PAGE = 50;
    const SORTS = [
        { id: 'newest', label: 'Newest', cmp: (a, b) => String(b.d).localeCompare(String(a.d)) },
        { id: 'longest', label: 'Longest', cmp: (a, b) => (b.m || 0) - (a.m || 0) },
        { id: 'distance', label: 'Farthest', cmp: (a, b) => (b.di || 0) - (a.di || 0) },
    ];

    function activityStats(a) {
        const stats = [formatDuration(a.m)];
        if (a.di) stats.push(formatMiles(a.di));
        if (a.e) stats.push(`${Math.round(a.e * 3.28084).toLocaleString()} ft`);
        return stats.join(' · ');
    }

    function highlightCard(label, a) {
        if (!a) return '';
        return `<a class="strava-highlight" href="${stravaUrl(a)}" target="_blank" rel="noopener">
            <span class="strava-highlight-label">${label}</span>
            <span class="strava-highlight-name"><span aria-hidden="true">${sportIcon(a.t)}</span> ${esc(a.n || 'Activity')}</span>
            <span class="strava-highlight-meta">${esc(sportLabel(a.t))} · ${formatActDate(a.d)}</span>
            <span class="strava-highlight-stats">${activityStats(a)}</span>
        </a>`;
    }

    function activityRow(a) {
        return `<li><a class="strava-act" href="${stravaUrl(a)}" target="_blank" rel="noopener">
            <span class="strava-act-icon" aria-hidden="true">${sportIcon(a.t)}</span>
            <span class="strava-act-main"><span class="strava-act-name">${esc(a.n || 'Activity')}</span>
                <span class="strava-act-date">${formatActDate(a.d)} · ${esc(sportLabel(a.t))}</span></span>
            <span class="strava-act-stats">${activityStats(a)}</span>
        </a></li>`;
    }

    function setPressed(buttons, active) {
        buttons.forEach(b => {
            b.classList.toggle('active', b === active);
            b.setAttribute('aria-pressed', String(b === active));
        });
    }

    // name: the place (for the pop-up's label); titleHtml: its heading (a name
    // with a flag); s: its totals; countries: the geocoded country names it
    // covers; regions: optionally, the region names within them. Or, instead
    // of countries / regions, listUrl: any worker URL answering { activities }
    // (the World Travel bucket lists' /activities/near), with its own label.
    function open({ name, titleHtml, s, countries = [], regions = [], listUrl = null, label = null }) {
        if (!s) return;
        const dialog = document.createElement('dialog');
        dialog.className = 'strava-dialog';
        dialog.setAttribute('aria-label', label || `Strava activities in ${name}`);
        dialog.innerHTML = `
            <div class="strava-dialog-head">
                <h3>${titleHtml || esc(name)}</h3>
                <button type="button" class="strava-dialog-close" aria-label="Close">×</button>
            </div>
            <p class="strava-dialog-totals">${s.count.toLocaleString()} ${s.count === 1 ? 'activity' : 'activities'} · ${formatDuration(s.sec)} moving · ${formatMiles(s.di)}</p>
            <div class="strava-highlights">${highlightCard('Longest', s.longest)}${highlightCard('Latest', s.latest)}</div>
            <div class="strava-dialog-bar">
                <h4>All activities</h4>
                <div class="strava-sport-filter" role="group" aria-label="Sport"></div>
                <div class="view-toggle strava-sort" role="group" aria-label="Sort">
                    ${SORTS.map((o, i) => `<button type="button" class="view-mode-btn${i ? '' : ' active'}" data-sort="${o.id}" aria-pressed="${!i}">${o.label}</button>`).join('')}
                </div>
            </div>
            <ul class="strava-act-list"><li class="strava-act-note">Loading activities…</li></ul>
            <button type="button" class="strava-more" hidden>Show more</button>`;
        document.body.appendChild(dialog);

        const list = dialog.querySelector('.strava-act-list');
        const more = dialog.querySelector('.strava-more');
        const sportBox = dialog.querySelector('.strava-sport-filter');
        let activities = null, sort = SORTS[0], sport = null, shown = 0, rows = [];

        const render = (append = false) => {
            if (!activities) return;
            if (!append) {
                rows = activities.filter(a => !sport || sportIcon(a.t) === sport).sort(sort.cmp);
                shown = 0;
                list.innerHTML = rows.length ? '' : '<li class="strava-act-note">No activities</li>';
            }
            list.insertAdjacentHTML('beforeend', rows.slice(shown, shown + PAGE).map(activityRow).join(''));
            shown = Math.min(rows.length, shown + PAGE);
            more.hidden = shown >= rows.length;
            more.textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
        };

        const sortBtns = [...dialog.querySelectorAll('[data-sort]')];
        sortBtns.forEach(btn => btn.addEventListener('click', () => {
            sort = SORTS.find(o => o.id === btn.dataset.sort);
            setPressed(sortBtns, btn);
            render();
        }));
        more.addEventListener('click', () => render(true));
        dialog.querySelector('.strava-dialog-close').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
        dialog.addEventListener('close', () => dialog.remove());
        dialog.showModal();

        const qs = [...countries.map(c => `country=${encodeURIComponent(c)}`),
            ...regions.map(r => `region=${encodeURIComponent(r)}`)].join('&');
        fetch(listUrl || `${WORKER}/activities/by-country?${qs}`)
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => {
                // An older worker ignores ?region= and lists the whole country.
                if (regions.length && !Array.isArray(data.regions)) throw new Error('worker has no region filter yet');
                activities = data.activities || [];
                // One chip per sport icon, when there's more than one kind.
                const counts = new Map();
                activities.forEach(a => { const k = sportIcon(a.t); counts.set(k, (counts.get(k) || 0) + 1); });
                if (counts.size > 1) {
                    sportBox.innerHTML = [['', `All ${activities.length.toLocaleString()}`], ...[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, `${k} ${n.toLocaleString()}`])]
                        .map(([k, label], i) => `<button type="button" class="strava-chip${i ? '' : ' active'}" data-sport="${k}" aria-pressed="${!i}">${label}</button>`).join('');
                    const chips = [...sportBox.querySelectorAll('[data-sport]')];
                    chips.forEach(btn => btn.addEventListener('click', () => {
                        sport = btn.dataset.sport || null;
                        setPressed(chips, btn);
                        render();
                    }));
                }
                render();
            })
            .catch(err => {
                console.warn('Activities unavailable:', err);
                list.innerHTML = '<li class="strava-act-note">Couldn\'t load the activities right now.</li>';
            });
    }

    return { fetchTotals, cell, open };
})();
