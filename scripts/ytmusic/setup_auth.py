#!/usr/bin/env python3
"""One-time YouTube Music auth setup for the song leaderboard sync.

Optional: you can skip this script entirely and paste the copied request
headers (steps 1-4 below) straight into the YTMUSIC_AUTH repository secret —
the sync job converts them itself. This script just converts and checks them
locally first.

ytmusicapi's browser auth works by replaying the request headers (cookies
included) of a logged-in music.youtube.com session. This script turns those
pasted headers into the JSON ytmusicapi expects, proves they work by reading
your history, and tells you how to hand them to the daily GitHub Action as a
secret. The file it writes holds live session cookies: it is saved OUTSIDE the
repo by default and is never meant to be committed.

Getting the headers (Chrome/Edge; Firefox is the same idea):
  1. Open https://music.youtube.com while logged in.
  2. Open DevTools (F12) -> Network tab, filter on "browse".
  3. Click around (e.g. open Library) until a POST to /youtubei/v1/browse appears.
  4. Click it -> Headers -> Request Headers -> copy them all.
     Chrome: right-click the request -> Copy -> Copy request headers.
  5. Run this script and paste when prompted, then press Ctrl-D
     (Ctrl-Z then Enter on Windows).

Usage:
  pip install -r scripts/ytmusic/requirements.txt
  python3 scripts/ytmusic/setup_auth.py [--out PATH]

Then store the result as a repo secret (requires the gh CLI):
  gh secret set YTMUSIC_AUTH < ~/.config/ytmusic/browser.json
or paste the file's contents into GitHub -> Settings -> Secrets and variables
-> Actions -> New repository secret, named YTMUSIC_AUTH.

The sync job also needs a token the worker accepts for music writes. Set it as
a repository secret only; the worker deploy workflow uploads the same value to
Cloudflare on every deploy:
  python3 -c "import secrets; print(secrets.token_urlsafe(32))" | gh secret set MUSIC_SYNC_TOKEN

For a local sync run, export both instead:
  export YTMUSIC_AUTH="$(cat ~/.config/ytmusic/browser.json)" MUSIC_SYNC_TOKEN=...
  python3 scripts/ytmusic/sync_history.py --dry-run

The cookies last until you sign out of that browser session (signing out
invalidates them), so use a session you leave signed in. When the daily job
starts failing with an auth error, re-run this script and update the secret.
"""

import argparse
import os
import stat
import sys
from pathlib import Path

try:
    import ytmusicapi
    from ytmusicapi import YTMusic
except ImportError:
    sys.exit("ytmusicapi is not installed: pip install -r scripts/ytmusic/requirements.txt")

DEFAULT_OUT = Path.home() / ".config" / "ytmusic" / "browser.json"
REPO_ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help=f"where to write the auth JSON (default: {DEFAULT_OUT})")
    args = parser.parse_args()
    out = args.out.expanduser().resolve()

    if out.is_relative_to(REPO_ROOT):
        sys.exit(f"Refusing to write auth headers inside the repo ({out}).\n"
                 "They contain session cookies; choose a path outside it.")

    print("Paste the request headers from a music.youtube.com /browse request,")
    print("then press Ctrl-D (Ctrl-Z + Enter on Windows):\n")
    headers_raw = sys.stdin.read()
    if "cookie" not in headers_raw.lower():
        sys.exit("No Cookie header found — copy the *request* headers of a logged-in /browse request.")

    out.parent.mkdir(parents=True, exist_ok=True)
    # Create the file owner-read/write only before anything is written to it.
    out.touch(mode=0o600, exist_ok=True)
    os.chmod(out, stat.S_IRUSR | stat.S_IWUSR)
    auth_json = ytmusicapi.setup(filepath=str(out), headers_raw=headers_raw)

    print(f"\nSaved auth headers to {out} (mode 600). Verifying...")
    try:
        history = YTMusic(auth_json).get_history()
    except Exception as exc:  # surface whatever ytmusicapi raises, then stop
        sys.exit(f"Verification failed: {exc}\nRe-copy the headers from a fresh request and try again.")

    print(f"OK — read {len(history)} history items.", end="")
    if history:
        top = history[0]
        artists = ", ".join(a["name"] for a in top.get("artists") or [])
        print(f" Most recent: {top.get('title')} — {artists} ({top.get('played')})")
    else:
        print()

    print("\nNext: store it as the GitHub Actions secret the sync job reads:")
    print(f"  gh secret set YTMUSIC_AUTH < {out}")
    print("and set MUSIC_SYNC_TOKEN if you haven't (see this script's docstring).")
    print("Do not commit this file.")


if __name__ == "__main__":
    main()
