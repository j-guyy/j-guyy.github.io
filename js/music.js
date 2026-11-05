// Song leaderboard: play counts per song from the worker's D1 database, which
// the daily YouTube Music sync (scripts/ytmusic/sync_history.py) fills. The
// owner can backfill real history once from a Google Takeout export: the
// watch-history.json is parsed here in the browser and only its YouTube Music
// plays are sent to the worker's /music/import (admin password required).
(() => {
    const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
    const LIMIT = 100;

    const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    async function load() {
        const status = document.getElementById('music-status');
        const table = document.getElementById('music-leaderboard');
        try {
            const res = await fetch(`${WORKER_URL}/music/leaderboard?limit=${LIMIT}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { songs, total_plays: totalPlays, total_songs: totalSongs, last_sync: lastSync } = await res.json();

            table.tBodies[0].innerHTML = songs.map((s, i) => `
                <tr><td>${i + 1}</td><td>${escapeHtml(s.title)}</td><td>${escapeHtml(s.artists)}</td>
                    <td>${s.plays}</td><td>${escapeHtml(s.last_played)}</td></tr>`).join('');
            table.hidden = songs.length === 0;
            status.textContent = songs.length
                ? `${totalPlays} plays of ${totalSongs} songs tracked`
                    + (lastSync ? ` · last synced ${new Date(lastSync).toLocaleString()}` : '')
                : 'No listening history synced yet.';
        } catch (err) {
            console.error('Song leaderboard failed to load', err);
            status.textContent = 'Could not load listening history.';
        }
    }

    // The YouTube Music plays in a Takeout watch-history.json, as
    // [video_id, title, artist, played_at]. Entries look like
    //   { header: 'YouTube Music', title: 'Watched <song>',
    //     titleUrl: 'https://music.youtube.com/watch?v=<id>',
    //     subtitles: [{ name: '<artist> - Topic' }], time: '<ISO>' }
    // Videos removed since have the URL as their title; those are skipped.
    function parseTakeout(entries) {
        if (!Array.isArray(entries)) throw new Error('Not a Takeout watch-history.json (expected a JSON list).');
        const plays = [];
        let skipped = 0;
        for (const e of entries) {
            if (e?.header !== 'YouTube Music') continue;
            const id = /[?&]v=([\w-]+)/.exec(e.titleUrl || '')?.[1];
            const title = String(e.title || '').replace(/^Watched /, '');
            const time = Date.parse(e.time);
            if (!id || !title || /^https?:\/\//.test(title) || Number.isNaN(time)) { skipped++; continue; }
            const artist = String(e.subtitles?.[0]?.name || '').replace(/ - Topic$/, '') || '(unknown)';
            plays.push([id, title, artist, new Date(time).toISOString()]);
        }
        return { plays, skipped };
    }

    async function importTakeout(file) {
        const status = document.getElementById('music-status');
        let parsed;
        try {
            parsed = parseTakeout(JSON.parse(await file.text()));
        } catch (err) {
            alert(`Couldn't read ${file.name}: ${err.message}`);
            return;
        }
        const { plays, skipped } = parsed;
        if (!plays.length) {
            alert(`No YouTube Music plays found in ${file.name}. Pick watch-history.json (exported as JSON, not HTML).`);
            return;
        }
        const times = plays.map(p => p[3]).sort();
        const day = iso => new Date(iso).toLocaleDateString();
        if (!confirm(`Import ${plays.length} YouTube Music plays from ${day(times[0])} to ${day(times[times.length - 1])}`
            + (skipped ? ` (${skipped} removed videos skipped)` : '') + '?\n\n'
            + 'This replaces the first sync\'s one-play-per-song placeholder and any earlier import.')) return;

        status.textContent = `Importing ${plays.length} plays…`;
        try {
            const res = await fetch(`${WORKER_URL}/music/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Password': TravelAdmin.getPassword() },
                body: JSON.stringify({ plays }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.status === 401) { TravelAdmin.logout(); renderOwner(); throw new Error('password rejected — log in again'); }
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            await load();
            alert(`Imported ${body.plays} plays.`
                + (body.dropped_after_cutoff ? ` ${body.dropped_after_cutoff} newer plays were already counted by the daily sync.` : ''));
        } catch (err) {
            console.error('Takeout import failed', err);
            status.textContent = 'Import failed.';
            alert(`Import failed: ${err.message}`);
        }
    }

    let renderOwner = () => {};

    document.addEventListener('DOMContentLoaded', () => {
        const fileInput = document.getElementById('music-import-file');
        renderOwner = TravelAdmin.initControls(document.getElementById('owner-login-btn'));
        document.getElementById('music-import-btn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            const [file] = fileInput.files;
            fileInput.value = '';
            if (file) importTakeout(file);
        });
        load();
    });
})();
