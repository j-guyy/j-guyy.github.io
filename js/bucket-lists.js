// Bucket lists on the World Travel page: Forbes 100 cities and the Seven
// Wonders lists. Shared by the Tables view (js/world-dashboard.js) and the
// map's "Still to visit" layer (js/world-map.js).
//
// loadBucketLists() resolves to { lists: { id: { label, rows } } } where each
// row is { name, country, lat, lng, visited, note } (Forbes rows also
// carry `rank`, their place in the list). The wonders say whether
// they're visited in data/sevenWonders.json; a Forbes city counts as visited
// when it's a visited US metro or one of data/worldCities.json's cities.

const BUCKET_LISTS = [
    { id: 'forbes100',           label: 'Forbes 100 Cities' },
    { id: 'sevenWonders',        label: 'Seven Wonders of the World' },
    { id: 'sevenNaturalWonders', label: 'Seven Natural Wonders' },
    { id: 'wonderNominees',      label: 'Natural Wonder Nominees' },
];

let bucketListsPromise = null;

function loadBucketLists() {
    if (!bucketListsPromise) {
        bucketListsPromise = Promise.all([
            fetch('data/forbes100cities.json').then(r => r.json()),
            TravelAPI.fetchMetros(),
            fetch('data/worldCities.json').then(r => r.json()),
            fetch('data/sevenWonders.json').then(r => r.json()),
        ]).then(([forbes, metros, worldCities, wonders]) => {
            const rowsById = {
                forbes100: forbesRows(forbes, metros, worldCities.visitedCities),
                sevenWonders: wonders.sevenWonders.map(w => wonderRow(w, w.country,
                    w.status === 'honorary' ? 'Honorary' : '')),
                sevenNaturalWonders: wonders.sevenNaturalWonders.map(w => wonderRow(w, w.primaryCountry)),
                wonderNominees: wonders.sevenNaturalWondersNominees.map(w => wonderRow(w, w.primaryCountry)),
            };
            const lists = {};
            BUCKET_LISTS.forEach(l => { lists[l.id] = { label: l.label, rows: rowsById[l.id] }; });
            return { lists };
        });
        bucketListsPromise.catch(() => { bucketListsPromise = null; });  // let a later call retry
    }
    return bucketListsPromise;
}

function wonderRow(w, country, note = '') {
    return { name: w.name, country: country || '', lat: w.coordinates.lat, lng: w.coordinates.lng, visited: !!w.visited, note };
}

function forbesRows(forbes, metros, worldCities) {
    const norm = s => s.toLowerCase().replace(/[.,]/g, '').trim();
    const visitedMetros = new Set(metros.filter(m => m.visited).map(m => norm(m.name)));
    const cities = new Set(worldCities.map(c => c.name));
    return forbes.map((c, i) => ({
        rank: i + 1,
        name: c.name,
        country: c.country,
        lat: c.coords[1],
        lng: c.coords[0],
        visited: (c.country === 'USA' && visitedMetros.has(norm(c.name))) || cities.has(c.name),
        note: '',
    }));
}
