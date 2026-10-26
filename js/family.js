// ── Family mode for the app shell (/app/?family=1) ───────────────────────────
//
// The same app, for anyone who connected their own Strava account on
// /family/: it points strava.js at that person's data on the family worker
// (family-worker.js) instead of strava-worker, and hides the owner-only parts
// (Travel, StatsHunters). Without ?family in the URL this file does nothing,
// so the owner's app and the Android shell are unchanged.
//
// Loaded before strava.js, which reads window.STRAVA_WORKER_URL and
// window.STRAVA_ADMIN_PW_KEY. The person's session token arrives once as
// ?k=<athleteId>.<token> from the sign-in redirect and is kept in localStorage
// (family_user). It stays in the URL in Safari so "Add to Home Screen" saves
// it — on iPhone a home-screen web app has its own storage — and is dropped
// from the address once running from the home screen.
(function () {
    const params = new URLSearchParams(location.search);
    if (!params.has('family')) return;

    const FAMILY_WORKER = 'https://family-strava.justinguyette.workers.dev';
    const USER_KEY = 'family_user';
    const standalone = navigator.standalone === true
        || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

    let user = null;
    try { user = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { /* none */ }
    const k = params.get('k');
    if (k && /^\d+\.[0-9a-f]{64}$/.test(k)) {
        const [id, token] = k.split('.');
        user = { id, token, name: params.get('n') || user?.name || '' };
        try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* private mode */ }
        if (standalone) {
            params.delete('k');
            params.delete('n');
            history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
        }
    }
    if (!user?.id || !user?.token) {
        location.replace('/family/');
        return;
    }

    window.FAMILY_USER = user;
    window.STRAVA_WORKER_URL = `${FAMILY_WORKER}/u/${user.id}`;
    window.STRAVA_ADMIN_PW_KEY = 'family_admin_pw';
    try { localStorage.setItem('family_admin_pw', user.token); } catch { /* private mode */ }
    document.documentElement.classList.add('family-mode');
    document.title = user.name ? `${user.name}'s Strava` : 'Strava';

    function signOut() {
        try {
            localStorage.removeItem(USER_KEY);
            localStorage.removeItem('family_admin_pw');
        } catch { /* nothing to clear */ }
        location.replace('/family/');
    }

    // Every request to the family worker carries the session token; a 401
    // means it was revoked (disconnected elsewhere), so go back to sign-in.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init = {}) {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (!url.startsWith(FAMILY_WORKER)) return nativeFetch(input, init);
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has('X-Admin-Password')) headers.set('X-Admin-Password', user.token);
        return nativeFetch(input, { ...init, headers }).then(res => {
            if (res.status === 401 && !url.endsWith('/auth/check')) signOut();
            return res;
        });
    };

    // Home-screen icon for "Add to Home Screen".
    const icon = document.createElement('link');
    icon.rel = 'apple-touch-icon';
    icon.href = '/family/icon-192.png';
    document.head.appendChild(icon);

    document.addEventListener('DOMContentLoaded', () => {
        const header = document.querySelector('#screen-home .app-home-header h1');
        if (header && user.name) header.textContent = `${user.name}'s Strava`;

        const home = document.getElementById('screen-home');
        if (!home) return;
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const account = document.createElement('section');
        account.className = 'family-account';
        account.innerHTML = `
            ${ios && !standalone ? `<p class="family-tip"><strong>Keep this as an app:</strong> tap Share <span aria-hidden="true">⎙</span>, then <em>Add to Home Screen</em>.</p>` : ''}
            <p class="home-section-label">Account</p>
            <div class="family-account-row">
                <span>Connected to Strava${user.name ? ` as ${user.name}` : ''}</span>
                <button type="button" class="cache-refresh-btn" id="family-disconnect">Disconnect</button>
            </div>
            <p class="family-powered">Powered by Strava</p>`;
        home.appendChild(account);
        document.getElementById('family-disconnect').addEventListener('click', async () => {
            if (!confirm('Disconnect your Strava account and delete everything stored for it here?')) return;
            try {
                await window.fetch(`${window.STRAVA_WORKER_URL}/account/delete`, { method: 'POST' });
            } catch { /* signed out locally either way */ }
            signOut();
        });
    });
})();
