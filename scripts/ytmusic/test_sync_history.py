"""Unit tests for the history diffing: python3 -m unittest scripts/ytmusic/test_sync_history.py"""

import sqlite3
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sync_history import new_play_count, sync  # noqa: E402


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


class Sync(unittest.TestCase):
    def test_counts_accumulate(self):
        conn = sqlite3.connect(":memory:")
        now = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
        self.assertEqual(sync(conn, [item(v) for v in "abc"], now), 3)
        self.assertEqual(sync(conn, [item(v) for v in "abc"], now), 0)
        self.assertEqual(sync(conn, [item(v) for v in "cab"], now), 1)
        counts = dict(conn.execute("SELECT video_id, COUNT(*) FROM plays GROUP BY video_id"))
        self.assertEqual(counts, {"a": 1, "b": 1, "c": 2})
        self.assertEqual(conn.execute("SELECT DISTINCT played_date FROM plays").fetchall(), [("2026-10-03",)])

    def test_skips_items_without_video_id(self):
        conn = sqlite3.connect(":memory:")
        now = datetime(2026, 10, 3, tzinfo=timezone.utc)
        self.assertEqual(sync(conn, [item("a"), {"title": "gone", "played": "Today"}], now), 1)


if __name__ == "__main__":
    unittest.main()
