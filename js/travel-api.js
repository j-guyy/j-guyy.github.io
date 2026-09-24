const TRAVEL_WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';

const TravelAPI = {
    async fetchHighPoints() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/highpoints`);
        return res.json();
    },

    async fetchMetros() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/metros`);
        return res.json();
    },

    async fetchNationalParks() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/parks`);
        return res.json();
    },

    async fetchCountries() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/countries`);
        return res.json();
    },

    async fetchVisitedStates() {
        const res = await fetch(`${TRAVEL_WORKER_URL}/travel/visited-states`);
        return res.json();
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
        try {
            const res = await fetch(`${TRAVEL_WORKER_URL}/travel/${type}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) return data;
            throw new Error('Empty or unseeded data');
        } catch (err) {
            const res = await fetch(fallbackUrl);
            return res.json();
        }
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
