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
