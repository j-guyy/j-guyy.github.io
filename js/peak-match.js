// Matches a hand-kept peak list against Mountain Hunter's Strava summits
// (/summits/peaks). Shared by the Peaks dashboard and the ADK 46ers / CO 14ers
// trip reports; the worker's matchPeakList (MCP server) mirrors it, so keep
// the two in step.
const PeakMatch = (() => {
    // A summited OSM peak this close to a list peak is that peak. Further out
    // (list coordinates are rougher than OSM's, especially abroad) it only
    // counts when the names agree; OSM names are often in local script, so
    // distance has to carry the match on its own for those.
    const NEAR_M = 400;
    const NAMED_M = 3000;
    const NAME_STOPWORDS = new Set(['mount', 'mt', 'mont', 'monte', 'mountain', 'pico', 'pic', 'peak',
        'cerro', 'gora', 'volcan', 'nevado', 'the', 'de', 'del', 'la', 'jabal', 'jebel', 'hill', 'doi', 'bukit', 'puncak']);

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

    // items: list entries with coords [lng, lat]; summited: /summits/peaks.
    // Returns Map(item → { peak, distance }). One summited peak confirms at
    // most one list peak, so two list peaks a few hundred metres apart
    // (North Maroon / Maroon) can't both claim one summit. Name-confirmed
    // pairs are assigned first, then the closest.
    function match(items, summited) {
        const pairs = [];
        items.forEach(item => {
            if (!Array.isArray(item.coords)) return;
            const [lng, lat] = item.coords;
            summited.forEach(peak => {
                const d = haversineM(lat, lng, peak.lat, peak.lng);
                if (d > NAMED_M) return;
                const named = namesAgree(item.name, peak.name);
                if (named || d <= NEAR_M) pairs.push({ item, peak, d, named });
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
        return matches;
    }

    return { match, NEAR_M, NAMED_M };
})();
