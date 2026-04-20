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
