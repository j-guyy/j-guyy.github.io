"""Unit tests for the history diffing: python3 -m unittest scripts/ytmusic/test_sync_history.py"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sync_history import auth_json, build_payload, new_play_count  # noqa: E402
import json  # noqa: E402

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)


def item(vid, played="Today"):
    return {"videoId": vid, "title": vid.upper(), "artists": [{"name": "Artist"}],
            "album": {"name": "Album"}, "duration_seconds": 200, "played": played}


class NewPlayCount(unittest.TestCase):
    def test_first_run_counts_everything(self):
        self.assertEqual(new_play_count(list("abc"), []), 3)

    def test_unchanged(self):
        self.assertEqual(new_play_count(list("abcdefg"), list("abcdefg")), 0)

    def test_new_songs_on_top(self):
        self.assertEqual(new_play_count(list("xyabcdefg"), list("abcdefg")), 2)

    def test_replayed_song_moves_to_top(self):
        self.assertEqual(new_play_count(list("dabcefg"), list("abcdefg")), 1)

    def test_replay_of_newest_song_mixed_with_new(self):
        # played x, then a again
        self.assertEqual(new_play_count(list("axbcdefg"), list("abcdefg")), 2)

    def test_tail_truncated(self):
        self.assertEqual(new_play_count(list("xabcde"), list("abcdefg")), 1)

    def test_no_overlap(self):
        self.assertEqual(new_play_count(list("uvwxyz"), list("abcdefg")), 6)


class BuildPayload(unittest.TestCase):
    def test_first_run(self):
        p = build_payload([item("a"), item("b", "Yesterday"), item("c", "Last week")], {}, NOW)
        self.assertIsNone(p["expected_last_sync"])
        self.assertEqual(p["snapshot"], ["a", "b", "c"])
        self.assertEqual([s["video_id"] for s in p["songs"]], ["a", "b", "c"])
        # oldest first, with dates only where the label pins one down
        self.assertEqual([(x["video_id"], x["played_date"]) for x in p["plays"]],
                         [("c", None), ("b", "2026-10-02"), ("a", "2026-10-03")])

    def test_no_new_plays(self):
        state = {"snapshot": ["a", "b", "c"], "last_sync": "2026-10-02T09:17:00+00:00"}
        self.assertIsNone(build_payload([item(v) for v in "abc"], state, NOW))

    def test_replay(self):
        state = {"snapshot": ["a", "b", "c"], "last_sync": "2026-10-02T09:17:00+00:00"}
        p = build_payload([item(v) for v in "cab"], state, NOW)
        self.assertEqual(p["expected_last_sync"], "2026-10-02T09:17:00+00:00")
        self.assertEqual([x["video_id"] for x in p["plays"]], ["c"])
        self.assertEqual(p["snapshot"], ["c", "a", "b"])

    def test_skips_items_without_video_id(self):
        p = build_payload([item("a"), {"title": "gone", "played": "Today"}], {}, NOW)
        self.assertEqual(p["snapshot"], ["a"])


class AuthJson(unittest.TestCase):
    def test_json_passes_through(self):
        value = json.dumps({"cookie": "a=b", "x-goog-authuser": "0"})
        self.assertEqual(auth_json(value), value)

    def test_raw_headers_are_converted(self):
        try:
            import ytmusicapi  # noqa: F401
        except ImportError:
            self.skipTest("ytmusicapi not installed")
        raw = "accept: */*\r\ncookie: SAPISID=abc; HSID=def\r\nx-goog-authuser: 0\r\nhost: music.youtube.com\r\n"
        headers = json.loads(auth_json(raw))
        self.assertEqual(headers["cookie"], "SAPISID=abc; HSID=def")
        self.assertEqual(headers["x-goog-authuser"], "0")
        self.assertNotIn("host", headers)

    def test_chrome_curl_is_converted(self):
        try:
            import ytmusicapi  # noqa: F401
        except ImportError:
            self.skipTest("ytmusicapi not installed")
        curl = (
            "curl 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false' \\\r\n"
            "  -H 'accept: */*' \\\r\n"
            "  -H 'authorization: SAPISIDHASH 123_abc' \\\r\n"
            "  -b 'SAPISID=abc; HSID=def; __Secure-3PAPISID=ghi' \\\r\n"
            "  -H 'x-goog-authuser: 0' \\\r\n"
            "  --data-raw '{\"context\":{\"client\":{}}}'\r\n"
        )
        headers = json.loads(auth_json(curl))
        self.assertEqual(headers["cookie"], "SAPISID=abc; HSID=def; __Secure-3PAPISID=ghi")
        self.assertEqual(headers["x-goog-authuser"], "0")


if __name__ == "__main__":
    unittest.main()
