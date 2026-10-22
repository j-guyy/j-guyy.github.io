const TRAVEL_WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';

// Worker path for each travel type whose URL isn't its type name.
const TRAVEL_PATHS = {
    visitedStates: 'visited-states',
    britishIsles: 'british-isles',
    countryHighpoints: 'country-highpoints',
};

// /data, resolved from this script so pages under /trip-reports/ find it too.
const TRAVEL_DATA_URL = new URL('../data/', document.currentScript?.src || location.href);

const TravelAPI = {
    // The stored list keeps the names it was seeded with, and nothing edits
    // them, so a peak renamed in the /data file (Clingmans Dome → Kuwohi)
    // would never show. Names are reference data: take them from the file.
    async fetchHighPoints() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/highpoints`);
        const points = await res.json();
        if (!Array.isArray(points)) return points;
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

    async fetchMetros() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/metros`);
        return res.json();
    },

    // The stored list only changes through toggles, so a park added to the
    // /data file (a new designation, e.g. Chiricahua) is appended from it,
    // with the file's visited flag, until the list is re-seeded.
    async fetchNationalParks() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/parks`);
        const parks = await res.json();
        if (!Array.isArray(parks) || !parks.length) return parks;
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

    async fetchCountries() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/countries`);
        return res.json();
    },

    async fetchVisitedStates() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/visited-states`);
        return res.json();
    },

    // County Hunter's visited counties (strava.html): an array of county FIPS codes.
    async fetchVisitedCounties() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/counties/all`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).fips || [];
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
