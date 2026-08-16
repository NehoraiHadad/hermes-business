"""Stdlib fixtures for the community archive plugin."""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent
PACKAGE = "community_archive"


def load_package() -> None:
    if PACKAGE in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(
        PACKAGE, PLUGIN_DIR / "__init__.py", submodule_search_locations=[str(PLUGIN_DIR)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)


load_package()


class ArchiveHome:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.db_path = self.home / "state.db"
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.executescript(
                """
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, chat_id TEXT,
                    chat_type TEXT, display_name TEXT
                );
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                    role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL,
                    platform_message_id TEXT, observed INTEGER DEFAULT 0,
                    active INTEGER DEFAULT 1, display_kind TEXT, display_metadata TEXT
                );
                """
            )
            conn.commit()
        self.write_policy(
            ("120363000000000001@g.us", "Main from policy"),
            ("120363000000000002@g.us", "Parents"),
        )

    def tearDown(self):
        self.temp.cleanup()

    def write_policy(self, *groups):
        target = self.home / "community"
        target.mkdir(exist_ok=True)
        (target / "archive-policy.json").write_text(
            json.dumps({"version": 1, "groups": [{"id": gid, "name": name} for gid, name in groups]}),
            encoding="utf-8",
        )

    def session(self, sid, group, *, source="whatsapp", chat_type="group", name="attacker name"):
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", (sid, source, group, chat_type, name))
            conn.commit()

    def message(self, sid, text, timestamp, *, message_id=None, metadata=None, role="user", active=1):
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.execute(
                "INSERT INTO messages(session_id, role, content, timestamp, platform_message_id, active, display_metadata) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sid, role, text, timestamp, message_id, active,
                 json.dumps(metadata, ensure_ascii=False) if isinstance(metadata, dict) else metadata),
            )
            conn.commit()
