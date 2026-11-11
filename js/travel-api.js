const TRAVEL_WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';

// Worker path for each travel type whose URL isn't its type name.
const TRAVEL_PATHS = {
    visitedStates: 'visited-states',
    britishIsles: 'british-isles',
    countryHighpoints: 'country-highpoints',
    worldCapitals: 'world-capitals',
};

// /data, resolved from this script so pages under /trip-reports/ find it too.
const TRAVEL_DATA_URL = new URL('../data/', document.currentScript?.src || location.href);

const TravelAPI = {
    // A stored list from the worker, or the /data file when the worker is
    // unreachable, answers with an error status or sends something that
    // isn't a list (same idea as fetchPeakList below).
    async _fetchListWithFallback(path, fileName) {
        try {
            const res = await fetch(`${TRAVEL_WORKER_URL}/travel/${path}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) return data;
            }
        } catch (err) { /* offline */ }
        const file = await fetch(new URL(fileName, TRAVEL_DATA_URL));
        if (!file.ok) throw new Error(`${fileName}: HTTP ${file.status}`);
        const data = await file.json();
        // The page now shows the file, not the stored list: saveList() must
        // not write it over the stored list (the path is the save type here).
        this._fromFile.add(path);
        return data;
    },

    // Lists this page got from the /data file because the worker did not
    // answer. Kept until the page reloads.
    _fromFile: new Set(),

    // The stored list keeps the names it was seeded with, and nothing edits
    // them, so a peak renamed in the /data file (Clingmans Dome → Kuwohi)
    // would never show. Names are reference data: take them from the file.
    async fetchHighPoints() {
        const points = await this._fetchListWithFallback('highpoints', 'highPoints.json');
        try {
            const file = await fetch(new URL('highPoints.json', TRAVEL_DATA_URL));
            if (file.ok) {
                const names = new Map((await file.json()).map(p => [p.state, p.name]));
                points.forEach(p => {
                    const name = names.get(p.state);
                    if (name) p.name = name;
                });
            }
        } catch { /* keep the stored names */ }
        return points;
    },

    // State capitals: names, coordinates and counties always come from the
    // /data file; the stored list (once the first edit saves it) only says
    // which are visited. Until then the file's flags stand in (pre-checked
    // from visited metros named after their capital).
    async fetchCapitals() {
        const file = await fetch(new URL('stateCapitals.json', TRAVEL_DATA_URL)).then(r => r.json());
        let answered = false;
        try {
            const res = await fetch(`${TRAVEL_WORKER_URL}/travel/capitals`);
            const stored = res.ok ? await res.json() : null;
            answered = Array.isArray(stored);
            if (answered && stored.length) {
                const done = new Map(stored.map(c => [c.state, Boolean(c.visited)]));
                file.forEach(c => { if (done.has(c.state)) c.visited = done.get(c.state); });
            }
        } catch { /* worker unreachable: keep the file's flags */ }
        // The worker did not answer with a list: the flags on show are the
        // file's, so saveList() must not write them over the stored list.
        if (!answered) this._fromFile.add('capitals');
        return file;
    },

    // World capitals, one per country (World Travel dashboard), the same way:
    // names and coordinates from data/worldCapitals.json, visited flags from
    // the stored list once the first edit saves it. `stored` says whether the
    // worker answered, so a page can refuse to save over a list it never saw.
    async fetchWorldCapitals() {
        const file = await fetch(new URL('worldCapitals.json', TRAVEL_DATA_URL)).then(r => r.json());
        let stored = false;
        try {
            const res = await fetch(`${TRAVEL_WORKER_URL}/travel/world-capitals`);
            const list = res.ok ? await res.json() : null;
            if (Array.isArray(list)) {
                stored = true;
                const done = new Map(list.map(c => [c.country, Boolean(c.visited)]));
                if (done.size) file.forEach(c => { if (done.has(c.country)) c.visited = done.get(c.country); });
            }
        } catch { /* worker unreachable: keep the file's flags */ }
        return { capitals: file, stored };
    },

    async fetchMetros() {
        return this._fetchListWithFallback('metros', 'metros.json');
    },

    // The stored list only changes through toggles, so a park added to the
    // /data file (a new designation, e.g. Chiricahua) is appended from it,
    // with the file's visited flag, until the list is re-seeded.
    async fetchNationalParks() {
        const parks = await this._fetchListWithFallback('parks', 'nationalParks.json');
        if (!parks.length) return parks;
        try {
            const file = await fetch(new URL('nationalParks.json', TRAVEL_DATA_URL));
            if (file.ok) {
                const stored = new Set(parks.map(p => p.name));
                (await file.json()).forEach(p => { if (!stored.has(p.name)) parks.push(p); });
                parks.sort((a, b) => a.name.localeCompare(b.name));
            }
        } catch { /* keep the stored list */ }
        return parks;
    },

    // Countries and visited states have no /data fallback (both are edited
    // whole from the dashboards), so a bad answer is an error the page shows.
    async fetchCountries() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/countries`);
        if (!res.ok) throw new Error(`countries: HTTP ${res.status}`);
        return res.json();
    },

    async fetchVisitedStates() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/visited-states`);
        if (!res.ok) throw new Error(`visited-states: HTTP ${res.status}`);
        return res.json();
    },

    // County Hunter's visited counties (strava.html): an array of county FIPS codes.
    async fetchVisitedCounties() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/counties/all`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).fips || [];
    },

    // Ecoregion Hunter (strava.html): { codes: [Level IV code], discoveries:
    // { code: { actId, actName, date } } }, plus the names of every region.
    async fetchEcoregions() {
        const [seen, names] = await Promise.all([
            fetch(`${TRAVEL_WORKER_URL}/ecoregions/all`).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            }),
            fetch('data/ecoregion-names.json?v=20261025').then(r => r.json())
        ]);
        return { codes: seen.codes || [], discoveries: seen.discoveries || {}, names };
    },

    async fetchAdk46ers() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/adk46ers`);
        return res.json();
    },

    async fetchColorado14ers() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/colorado14ers`);
        return res.json();
    },

    // Fetch a peak list from the worker, falling back to the static JSON file
    // when the worker is unreachable (local dev — CORS only allows the live
    // origin) or the KV key hasn't been seeded yet (empty array).
    async fetchPeaksWithFallback(type, fallbackUrl) {
        return (await this.fetchPeakList(type, fallbackUrl)).data;
    },

    // Same, but also says where the list came from: source is 'cloudflare'
    // (KV), or 'static' with reason 'unseeded' (KV key empty) or 'offline'
    // (worker unreachable). The Peaks dashboard seeds an unseeded list from
    // the static copy on the owner's first edit.
    async fetchPeakList(type, fallbackUrl) {
        let reason = 'offline';
        try {
            const res = await fetch(`${TRAVEL_WORKER_URL}/travel/${TRAVEL_PATHS[type] || type}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) return { data, source: 'cloudflare' };
                reason = 'unseeded';
            }
        } catch (err) { /* offline */ }
        const res = await fetch(fallbackUrl);
        return { data: await res.json(), source: 'static', reason };
    },

    // Peaks Mountain Hunter has detected a summit of, with coordinates:
    // [{ id, name, lat, lng, ele, activities, first, last }].
    async fetchSummitedPeaks() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/summits/peaks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).peaks || [];
    },

    async toggleVisited(type, key, password, continent) {
        const body = { password, type, key };
        if (continent) body.continent = continent;

        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Toggle failed');
        return data;
    },

    // Edit Mode saves. /travel/toggle reads the stored list, flips one item and
    // writes the list back, and Workers KV can answer that read from a cache
    // up to a minute old, so a toggle soon after another could write back a
    // list without the first edit and silently undo it. Pages save their whole
    // list instead, through this queue: one save at a time, in order, each
    // taking the list as it is when its turn comes (getData), so the last
    // write holds every edit.
    _saveQueue: Promise.resolve(),

    saveList(type, getData, password) {
        // A list shown from the /data file is not the stored list: saving it
        // whole would replace the stored visited flags with the file's.
        if (this._fromFile.has(type)) {
            return Promise.reject(new Error('This list was loaded from the backup file because the server did not answer, so it cannot be saved. Reload the page and try again.'));
        }
        const run = this._saveQueue.then(() => this.seed(type, getData(), password));
        this._saveQueue = run.catch(() => {});
        return run;
    },

    async seed(type, data, password) {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/seed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, type, data }),
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Seed failed');
        return result;
    },
};

// ── Owner login ─────────────────────────────────────────────────────────────
// The dashboards' edit controls (Edit Mode, Export CSV) are owner-only.
// Visitors see just a small lock button; logging in checks the password with
// the worker (/auth/check — the same TRAVEL_PASSWORD secret /travel/toggle
// enforces) and remembers it in localStorage under the key the Strava page
// uses, so one login covers the whole site. Hiding the controls is only UX:
// the worker still rejects toggles without the right password.
const TravelAdmin = {
    STORAGE_KEY: 'strava_admin_pw',
    _memoryPw: '', // fallback when storage is unavailable (private mode etc.)

    getPassword() {
        try { return localStorage.getItem(this.STORAGE_KEY) || this._memoryPw; }
        catch (e) { return this._memoryPw; }
    },

    isLoggedIn() { return Boolean(this.getPassword()); },

    _store(pw) {
        this._memoryPw = pw;
        try {
            if (pw) localStorage.setItem(this.STORAGE_KEY, pw);
            else localStorage.removeItem(this.STORAGE_KEY);
        } catch (e) { /* memory fallback only */ }
    },

    // Prompt for the password and verify it. Resolves true on success.
    async login() {
        const pw = prompt('Owner password:');
        if (!pw) return false;
        try {
            const res = await fetch(`${TRAVEL_WORKER_URL}/auth/check`, {
                method: 'POST',
                headers: { 'X-Admin-Password': pw },
            });
            if (!res.ok) { alert('Incorrect password.'); return false; }
        } catch (err) {
            alert('Login failed: ' + err.message);
            return false;
        }
        this._store(pw);
        return true;
    },

    logout() { this._store(''); },

    // Wire a lock/log-out button and every [data-owner-only] element on the
    // page. onChange(loggedIn) runs after each login/logout. Returns a
    // function that re-syncs the UI (e.g. after the server rejects the
    // stored password and the page calls logout()).
    initControls(lockBtn, onChange) {
        const render = () => {
            const on = this.isLoggedIn();
            document.querySelectorAll('[data-owner-only]').forEach(el => { el.hidden = !on; });
            lockBtn.textContent = on ? 'Log out' : '\u{1F512}';
            lockBtn.title = on ? 'Log out of owner mode' : 'Owner login';
            lockBtn.setAttribute('aria-label', lockBtn.title);
            lockBtn.classList.toggle('logged-in', on);
        };
        lockBtn.addEventListener('click', async () => {
            if (this.isLoggedIn()) this.logout();
            else if (!(await this.login())) return;
            render();
            if (onChange) onChange(this.isLoggedIn());
        });
        render();
        return render;
    },
};

// ── Dashboard UI helpers ────────────────────────────────────────────────────
// Shared by the US, World and Peaks dashboards.
const TravelUI = {
    // The first load failed: say so where the "Loading…" placeholder still
    // stands (the summary, or the table if the summary already drew), with a
    // Retry button that reloads. Other placeholders are cleared.
    showLoadError() {
        const pending = ['travel-summary', 'travel-table-container']
            .map(id => document.getElementById(id))
            .filter(el => el && el.querySelector('.dash-loading'));
        pending.forEach((el, i) => {
            if (i > 0) { el.innerHTML = ''; return; }
            el.innerHTML = `
                <div class="dash-error" role="alert">
                    <p>Could not load travel data. Reload to try again.</p>
                    <button type="button" class="table-action-btn">Retry</button>
                </div>`;
            el.querySelector('button').addEventListener('click', () => location.reload());
        });
    },

    // One table's own load failed (the rest of the page is up): say so in its
    // container, in showLoadError()'s style, with a Retry that runs onRetry.
    showTableError(container, message, onRetry) {
        container.innerHTML = `
            <div class="dash-error" role="alert">
                <p></p>
                <button type="button" class="table-action-btn">Retry</button>
            </div>`;
        container.querySelector('p').textContent = message;
        container.querySelector('button').addEventListener('click', onRetry);
    },

    // Runs render() (a table rebuild not started by the user, e.g. more data
    // arrived) and, if a sortable header had keyboard focus, puts focus back
    // on the same column (by its sort key) of the rebuilt table. Focus never
    // moves when the user was not on a header.
    keepHeaderFocus(render) {
        const container = document.getElementById('travel-table-container');
        const th = document.activeElement;
        const onHeader = container && th && th.matches('th.sortable') && container.contains(th);
        const key = onHeader ? th.dataset.sortKey : null;
        const index = onHeader ? [...th.parentNode.children].indexOf(th) : -1;
        render();
        if (!onHeader) return;
        // The rebuild dropped the focused header, so focus is on the body
        // now; if it is anywhere else, something else took it: leave it.
        if (document.activeElement && document.activeElement !== document.body) return;
        const headers = [...container.querySelectorAll('thead th.sortable')];
        const sameKey = key == null ? [] : headers.filter(h => h.dataset.sortKey === key);
        // Two columns can share a key (Rank and Elevation): keep the position.
        const again = sameKey.find(h => [...h.parentNode.children].indexOf(h) === index) || sameKey[0]
            || (key == null ? headers[index] : null);
        // A background rebuild must not scroll the page back to the header.
        if (again) again.focus({ preventScroll: true });
    },

    // Makes a sortable <th> (one with a click handler that re-renders the
    // table) work from the keyboard: focusable, Enter / Space sort, and
    // aria-sort on the active column. Focus returns to the same column of
    // the rebuilt table. key (the column's sort key) lets keepHeaderFocus()
    // find the column again after a rebuild.
    sortableHeader(th, isActive, dir, key) {
        th.tabIndex = 0;
        if (key != null) th.dataset.sortKey = key;
        if (isActive) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
        th.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const index = [...th.parentNode.children].indexOf(th);
            const container = th.closest('#travel-table-container');
            th.click();
            const again = container && container.querySelector(`thead th:nth-child(${index + 1})`);
            if (again) again.focus();
        });
    },
};
