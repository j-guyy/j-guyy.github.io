// Offline mode for the app (/app/). Loaded first on the page, before
// js/user-mode.js and js/strava.js.
//
// - Registers the service worker (app/sw.js), which keeps a copy of the page,
//   its scripts, the worker's data and the map tiles it has shown, and serves
//   them when there's no signal.
// - Notices when data came from that copy (the worker marks it `x-jg-cache`)
//   or the phone is offline, and then:
//     · tags <html class="jg-offline"> and shows a small pill above the tab bar
//       ("Offline · data from …"), with Reload once the signal is back;
//     · jgOffline() is true, which turns Sync off (js/app.js, strava.js
//       runManualSync) and makes strava.js skip every save, so results worked
//       out from an old copy never overwrite newer ones on the worker.
// - Fires 'jgoffline' on document whenever that changes.
(function () {
    const state = { stale: false, savedAt: 0 };
    try { performance.setResourceTimingBufferSize(1000); } catch { /* old browser */ }
    window.JG_OFFLINE = state;

    // Offline = no network now, or this page is showing saved data (it stays
    // that way until a reload fetches fresh data, even once signal returns).
    window.jgOffline = () => state.stale || navigator.onLine === false;

    function changed() {
        document.documentElement.classList.toggle('jg-offline', window.jgOffline());
        renderPill();
        document.dispatchEvent(new CustomEvent('jgoffline', { detail: { ...state, offline: window.jgOffline() } }));
    }

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        return nativeFetch(input, init).then(res => {
            if (res.headers.get('x-jg-cache')) {
                const saved = Number(res.headers.get('x-jg-saved')) || 0;
                const first = !state.stale;
                state.stale = true;
                // The oldest copy in use is the honest "data from" time.
                if (saved && (!state.savedAt || saved < state.savedAt)) state.savedAt = saved;
                if (first || saved) changed();
            }
            return res;
        });
    };
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);

    // ── Pill ─────────────────────────────────────────────────────────────────
    let pill = null;
    let dismissed = false;

    function savedText() {
        if (!state.savedAt) return '';
        const d = new Date(state.savedAt);
        const sameDay = d.toDateString() === new Date().toDateString();
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return sameDay ? `data from ${time}` : `data from ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
    }
    window.jgOfflineSavedText = savedText;

    function renderPill() {
        if (!document.body) return;
        const show = window.jgOffline() && !dismissed;
        if (!show) { if (pill) pill.hidden = true; return; }
        if (!pill) {
            pill = document.createElement('div');
            pill.className = 'jg-offline-pill';
            pill.setAttribute('role', 'status');
            pill.addEventListener('click', e => {
                if (e.target.closest('button')) { location.reload(); return; }
                dismissed = true; // tap to hide for this visit
                renderPill();
            });
            document.body.appendChild(pill);
        }
        pill.hidden = false;
        const back = navigator.onLine !== false && state.stale;
        const saved = savedText();
        pill.innerHTML = back
            ? `<span>Back online · ${saved || 'showing saved data'}</span><button type="button">Reload</button>`
            : `<span class="jg-offline-dot" aria-hidden="true"></span><span>Offline · ${saved || 'showing saved data'}</span>`;
    }
    document.addEventListener('DOMContentLoaded', () => { if (window.jgOffline()) changed(); });

    // ── Service worker ───────────────────────────────────────────────────────
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    // Ask the browser not to clear the saved copy when storage runs low.
    navigator.storage?.persist?.().catch(() => {});

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).then(async reg => {
            await navigator.serviceWorker.ready;
            // The first visit loads before the worker takes over: hand it what
            // the page already fetched so this visit is enough to go offline.
            const urls = performance.getEntriesByType('resource')
                .map(e => e.name)
                .filter(u => /^https:/.test(u) || u.startsWith(location.origin));
            urls.unshift(location.origin + '/app/');
            (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'warm', urls: [...new Set(urls)] });
        }).catch(err => console.warn('Offline mode unavailable:', err));
    });
})();
