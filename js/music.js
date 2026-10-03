// Song leaderboard: loads data/music/history.db (written daily by
// scripts/ytmusic/sync_history.py) with sql.js and ranks songs by play count.
(() => {
    const DB_URL = 'data/music/history.db';
    const SQL_WASM = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
    const LIMIT = 100;

    const LEADERBOARD_SQL = `
        SELECT s.title, s.artists, COUNT(*) AS plays,
               MAX(COALESCE(p.played_date, substr(p.synced_at, 1, 10))) AS last_played
        FROM plays p JOIN songs s ON s.video_id = p.video_id
        GROUP BY p.video_id
        ORDER BY plays DESC, last_played DESC, s.title
        LIMIT ${LIMIT}`;

    const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    async function load() {
        const status = document.getElementById('music-status');
        const table = document.getElementById('music-leaderboard');
        try {
            const [SQL, res] = await Promise.all([
                initSqlJs({ locateFile: f => SQL_WASM + f }),
                fetch(DB_URL, { cache: 'no-cache' }),
            ]);
            if (res.status === 404) {
                status.textContent = 'No listening history synced yet.';
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
            try {
                const [result] = db.exec(LEADERBOARD_SQL);
                const rows = result ? result.values : [];
                const [[totalPlays]] = db.exec('SELECT COUNT(*) FROM plays')[0].values;
                const lastSync = db.exec("SELECT value FROM sync_state WHERE key = 'last_sync'")[0]?.values[0][0];

                table.tBodies[0].innerHTML = rows.map(([title, artists, plays, last], i) => `
                    <tr><td>${i + 1}</td><td>${escapeHtml(title)}</td><td>${escapeHtml(artists)}</td>
                        <td>${plays}</td><td>${escapeHtml(last)}</td></tr>`).join('');
                table.hidden = rows.length === 0;
                status.textContent = rows.length
                    ? `${totalPlays} plays tracked` + (lastSync ? ` · last synced ${new Date(lastSync).toLocaleString()}` : '')
                    : 'No plays recorded yet.';
            } finally {
                db.close();
            }
        } catch (err) {
            console.error('Song leaderboard failed to load', err);
            status.textContent = 'Could not load listening history.';
        }
    }

    document.addEventListener('DOMContentLoaded', load);
})();
