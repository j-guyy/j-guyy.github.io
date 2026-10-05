#!/usr/bin/env python3
"""Push new YouTube Music plays to the worker's D1 database.

Run daily by .github/workflows/ytmusic-sync.yml; music.html shows the result
via the worker's /music/leaderboard.

Environment:
  YTMUSIC_AUTH      a logged-in music.youtube.com /browse request, pasted
                    as-is: either Chrome's "Copy as cURL (bash)" or the raw
                    request headers. The auth JSON written by setup_auth.py
                    also works (or --auth PATH).
  MUSIC_SYNC_TOKEN  matches the worker secret of the same name
  WORKER_URL        optional, defaults to the production worker

What get_history() gives us, and why plays are diffed rather than copied:
  * Only the most recent ~200 items, newest first.
  * No timestamps — each item carries a `played` bucket label ("Today",
    "Yesterday", "This week", "Last week", a month name, ...).
  * A song appears once: replaying it moves it back to the top instead of
    adding a second row.
So each run fetches the list saved last run (GET /music/state) and compares.
The items in front of the point where the two lists line up again are the
plays since the last sync; everything after is history already counted. A
replayed song shows up as one of those new front items (it is removed from its
old position, which the alignment accounts for). Play counts are therefore
exact as long as no song is played twice between two syncs and fewer than
~200 songs are played per day — the daily schedule keeps both true in
practice. The very first run has nothing to compare against and records every
item in the list once, as a baseline.

The new plays, the songs they reference, and the new snapshot go to
POST /music/plays in one request, which the worker writes in one transaction.
"""

import argparse
import json
import os
import shlex
import sys
from datetime import datetime, timedelta, timezone

DEFAULT_WORKER_URL = "https://strava-worker.justinguyette.workers.dev"

# How many consecutive items must line up with the previous snapshot before we
# trust that we've reached already-counted history.
ALIGN_WINDOW = 5


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
    return {
        "video_id": video_id,
        "title": item.get("title") or "(unknown)",
        "artists": artists or "(unknown)",
        "album": (item.get("album") or {}).get("name"),
        "duration_seconds": item.get("duration_seconds"),
        "played_label": item.get("played"),
    }


def build_payload(history, state, now):
    """The POST /music/plays body for the plays since `state`, or None if there are none."""
    items = [p for p in (parse_item(i) for i in history) if p]
    current = [i["video_id"] for i in items]
    k = new_play_count(current, state.get("snapshot") or [])
    if k == 0:
        return None

    new = items[:k]
    songs = {}
    for i in new:
        songs.setdefault(i["video_id"], {key: i[key] for key in
                                         ("video_id", "title", "artists", "album", "duration_seconds")})
    return {
        "expected_last_sync": state.get("last_sync"),
        "synced_at": now.isoformat(timespec="seconds"),
        "snapshot": current,
        "songs": list(songs.values()),
        # Oldest first, so ascending play ids follow listening order.
        "plays": [{"video_id": i["video_id"], "played_label": i["played_label"],
                   "played_date": played_date(i["played_label"], now)} for i in reversed(new)],
    }


def curl_to_headers(command):
    """The request headers of a "Copy as cURL (bash)" command, as "name: value" lines."""
    # Drop the backslash line continuations before tokenising.
    tokens = shlex.split(command.replace("\\\n", " "))
    lines = []
    for flag, value in zip(tokens, tokens[1:]):
        if flag in ("-H", "--header"):
            lines.append(value)
        elif flag in ("-b", "--cookie"):  # newer Chrome puts cookies here
            lines.append(f"cookie: {value}")
    return "\n".join(lines)


def auth_json(value):
    """YTMUSIC_AUTH as the JSON ytmusicapi wants, converting a copied request if needed."""
    try:
        if isinstance(json.loads(value), dict):
            return value
    except ValueError:
        pass
    import ytmusicapi
    # Normalise Windows line endings; ytmusicapi splits the paste on "\n".
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if value.startswith("curl "):
        value = curl_to_headers(value)
    return ytmusicapi.setup(headers_raw=value)


def require_env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Set {name} (see scripts/ytmusic/setup_auth.py).")
    return value


def main():
    parser = argparse.ArgumentParser(description="Sync YouTube Music history to the worker.")
    parser.add_argument("--auth", help="auth JSON file (default: $YTMUSIC_AUTH)")
    parser.add_argument("--dry-run", action="store_true", help="print the payload instead of posting it")
    args = parser.parse_args()

    # Imported here so the unit tests need neither.
    import requests
    from ytmusicapi import YTMusic

    worker = os.environ.get("WORKER_URL", DEFAULT_WORKER_URL).rstrip("/")
    headers = {"X-Music-Token": require_env("MUSIC_SYNC_TOKEN")}

    history = YTMusic(args.auth or auth_json(require_env("YTMUSIC_AUTH"))).get_history()
    if not history:
        sys.exit("get_history() returned nothing — expired auth or history paused? Not syncing.")

    res = requests.get(f"{worker}/music/state", headers=headers, timeout=30)
    res.raise_for_status()
    payload = build_payload(history, res.json(), datetime.now(timezone.utc))

    if payload is None:
        print(f"No new plays ({len(history)} history items read).")
        return
    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return

    res = requests.post(f"{worker}/music/plays", headers=headers, json=payload, timeout=30)
    if not res.ok:
        sys.exit(f"Worker rejected the sync: HTTP {res.status_code} {res.text}")
    print(f"{len(payload['plays'])} new plays synced ({len(history)} history items read).")


if __name__ == "__main__":
    main()
