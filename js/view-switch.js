// Tables | Map switch for the travel dashboards (us-dashboard.html,
// world-dashboard.html). Both views live on one page: #tables-view and
// #map-view. The hash (#map) picks the view, so links and reloads land on the
// right one. Flipping replaces the history entry instead of adding one, so
// Back leaves the page rather than flipping back.
//
// Anything marked data-tables-only (the Progress Report summary) is hidden in
// the Map view, so the map starts at the top of the page, not below the cards.
//
// onShow(view) runs on every switch ('tables' or 'map'), including the first,
// so a page can build its map lazily the first time 'map' comes up.

function setupViewSwitch({ titles, onShow }) {
    const options = document.querySelectorAll('.view-switch-option[data-view]');
    const tablesView = document.getElementById('tables-view');
    const mapView = document.getElementById('map-view');
    const tablesOnly = document.querySelectorAll('[data-tables-only]');

    function show(view) {
        const isMap = view === 'map';
        tablesView.hidden = isMap;
        mapView.hidden = !isMap;
        tablesOnly.forEach(el => { el.hidden = isMap; });
        options.forEach(o => {
            if (o.dataset.view === view) o.setAttribute('aria-current', 'page');
            else o.removeAttribute('aria-current');
        });
        if (titles && titles[view]) document.title = titles[view];
        onShow(view);
    }

    const fromHash = () => (location.hash === '#map' ? 'map' : 'tables');

    options.forEach(o => o.addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab etc.
        e.preventDefault();
        const view = o.dataset.view;
        history.replaceState(null, '', view === 'map' ? '#map' : location.pathname + location.search);
        show(view);
    }));
    // A link to #map / #tables (navbar, a map popup) while already on this page.
    window.addEventListener('hashchange', () => show(fromHash()));
    show(fromHash());
}

// Loads classic scripts one after another (each may need the one before);
// a failed load can be retried by calling again. An entry is a URL, or
// { src, integrity } for a third-party file: the browser then checks the
// file against the hash (Subresource Integrity), as the <script> tags do.
const loadedScripts = new Map();
function loadScriptsInOrder(srcs) {
    return srcs.reduce((chain, entry) => chain.then(() => {
        const { src, integrity } = typeof entry === 'string' ? { src: entry } : entry;
        if (!loadedScripts.has(src)) {
            loadedScripts.set(src, new Promise((resolve, reject) => {
                const el = document.createElement('script');
                if (integrity) {
                    el.integrity = integrity;
                    el.crossOrigin = 'anonymous';
                }
                el.src = src;
                el.onload = resolve;
                el.onerror = () => { loadedScripts.delete(src); el.remove(); reject(new Error('Failed to load ' + src)); };
                document.head.appendChild(el);
            }));
        }
        return loadedScripts.get(src);
    }), Promise.resolve());
}
