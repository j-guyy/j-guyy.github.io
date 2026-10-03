#!/usr/bin/env python3
"""Pull YouTube Music listening history into data/music/history.db.

Run daily by .github/workflows/ytmusic-sync.yml; music.html reads the database
directly in the browser to build the song leaderboard.

Auth: the YTMUSIC_AUTH environment variable holds the JSON written by
setup_auth.py (or pass --auth PATH for a file outside the repo).

What get_history() gives us, and why plays are diffed rather than copied:
  * Only the most recent ~200 items, newest first.
  * No timestamps — each item carries a `played` bucket label ("Today",
    "Yesterday", "This week", "Last week", a month name, ...).
  * A song appears once: replaying it moves it back to the top instead of
    adding a second row.
So each run compares the fresh list with the one saved last run. The items in
front of the point where the two lists line up again are the plays since the
last sync; everything after is history we have already counted. A replayed
song shows up as one of those new front items (it is removed from its old
position, which the alignment accounts for). Play counts are therefore exact
as long as no song is played twice between two syncs and fewer than ~200
songs are played per day — the daily schedule keeps both true in practice.
The very first run has nothing to compare against and records every item in
the list once, as a baseline.

Schema:
  songs(video_id PK, title, artists, album, duration_seconds, first_seen, last_seen)
    upserted on every sighting so titles/artists stay current.
  plays(id, video_id, played_label, played_date, synced_at)
    one row per detected play. played_date is the calendar day (UTC) when the
    bucket label pins one down ("Today"/"Yesterday"), else NULL; synced_at is
    when the play was detected.
  sync_state(key PK, value)
    `snapshot` = JSON list of the videoIds from the last run, `last_sync`.
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "music" / "history.db"

# How many consecutive items must line up with the previous snapshot before we
# trust that we've reached already-counted history.
ALIGN_WINDOW = 5

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    video_id         TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    artists          TEXT NOT NULL,
    album            TEXT,
    duration_seconds INTEGER,
    first_seen       TEXT NOT NULL,
    last_seen        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plays (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id     TEXT NOT NULL REFERENCES songs(video_id),
    played_label TEXT,
    played_date  TEXT,
    synced_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_video_id ON plays(video_id);
CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def new_play_count(current, previous):
    """How many leading items of `current` are plays since `previous` was taken.

    Both are lists of videoIds, newest first. Returns the smallest k such that
    current[k:] lines up with `previous` once the songs in current[:k] (which
    were replayed and so moved to the front) are taken out of it. With no
    previous snapshot, or no alignment at all, every item is new.
    """
    if not previous:
        return len(current)
    for k in range(len(current) + 1):
        moved = set(current[:k])
        rest_prev = [v for v in previous if v not in moved]
        rest_cur = current[k:]
        n = min(ALIGN_WINDOW, len(rest_cur), len(rest_prev))
        if n == 0:
            # Nothing left on one side to compare. Only accept this if the
            # current list is exhausted (everything in it is new); an empty
            # previous remainder with current items left means no alignment.
            if not rest_cur:
                return k
            continue
        if rest_cur[:n] == rest_prev[:n]:
            return k
    return len(current)


def played_date(label, now):
    label = (label or "").strip().lower()
    if label == "today":
        return now.date().isoformat()
    if label == "yesterday":
        return (now - timedelta(days=1)).date().isoformat()
    return None


def parse_item(item):
    """The fields we keep from one get_history() playlistItem, or None to skip."""
    video_id = item.get("videoId")
    if not video_id:  # unavailable/removed tracks come back without one
        return None
    artists = ", ".join(a["name"] for a in item.get("artists") or [] if a.get("name"))
    album = (item.get("album") or {}).get("name")
    return {
        "video_id": video_id,
        "title": item.get("title") or "(unknown)",
        "artists": artists or "(unknown)",
        "album": album,
        "duration_seconds": item.get("duration_seconds"),
        "played_label": item.get("played"),
    }


def sync(conn, history, now):
    """Upsert songs and record new plays. Returns the number of plays added."""
    items = [p for p in (parse_item(i) for i in history) if p]
    current = [i["video_id"] for i in items]

    conn.executescript(SCHEMA)
    row = conn.execute("SELECT value FROM sync_state WHERE key = 'snapshot'").fetchone()
    previous = json.loads(row[0]) if row else []

    k = new_play_count(current, previous)
    if k == 0:
        return 0

    stamp = now.isoformat(timespec="seconds")
    with conn:
        conn.executemany(
            """
            INSERT INTO songs (video_id, title, artists, album, duration_seconds, first_seen, last_seen)
            VALUES (:video_id, :title, :artists, :album, :duration_seconds, :stamp, :stamp)
            ON CONFLICT(video_id) DO UPDATE SET
                title = excluded.title,
                artists = excluded.artists,
                album = COALESCE(excluded.album, songs.album),
                duration_seconds = COALESCE(excluded.duration_seconds, songs.duration_seconds),
                last_seen = excluded.last_seen
            """,
            [{**i, "stamp": stamp} for i in items[:k]],
        )
        # Oldest first, so ascending ids follow listening order.
        conn.executemany(
            "INSERT INTO plays (video_id, played_label, played_date, synced_at) VALUES (?, ?, ?, ?)",
            [(i["video_id"], i["played_label"], played_date(i["played_label"], now), stamp)
             for i in reversed(items[:k])],
        )
        conn.executemany(
            "INSERT INTO sync_state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [("snapshot", json.dumps(current)), ("last_sync", stamp)],
        )
    return k


def load_auth(path):
    if path:
        return str(path)
    auth = os.environ.get("YTMUSIC_AUTH")
    if not auth:
        sys.exit("Set YTMUSIC_AUTH to the auth JSON from setup_auth.py (or pass --auth PATH).")
    return auth


def main():
    parser = argparse.ArgumentParser(description="Sync YouTube Music history into SQLite.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--auth", type=Path, help="auth JSON file (default: $YTMUSIC_AUTH)")
    args = parser.parse_args()

    from ytmusicapi import YTMusic  # imported here so the tests don't need it

    history = YTMusic(load_auth(args.auth)).get_history()
    if not history:
        sys.exit("get_history() returned nothing — expired auth or history paused? Not touching the db.")

    args.db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.db)
    try:
        added = sync(conn, history, datetime.now(timezone.utc))
        total = conn.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    finally:
        conn.close()
    print(f"{added} new plays ({len(history)} history items read, {total} plays stored).")


if __name__ == "__main__":
    main()
