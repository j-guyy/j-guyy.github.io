// Song leaderboard: play counts per song from the worker's D1 database, which
// the daily YouTube Music sync (scripts/ytmusic/sync_history.py) fills.
(() => {
    const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
    const LIMIT = 100;

    const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    async function load() {
        const status = document.getElementById('music-status');
        const table = document.getElementById('music-leaderboard');
        try {
            const res = await fetch(`${WORKER_URL}/music/leaderboard?limit=${LIMIT}`);
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

    document.addEventListener('DOMContentLoaded', load);
})();
