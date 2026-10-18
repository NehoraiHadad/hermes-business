"""Plugin-owned passive archive; never writes to Hermes' state.db."""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path

ARCHIVE_FILE = Path('community') / 'archive.db'
MAX_CAPTURE_CHARS = 100_000


def archive_path(home: Path) -> Path:
    return Path(home) / ARCHIVE_FILE


def initialize(conn) -> None:
    # This small logical read schema is shared with the historical Hermes
    # archive reader. It is owned/versioned here, not an engine schema copy.
    if conn.execute('PRAGMA user_version').fetchone()[0] not in (0, 1):
        raise RuntimeError('Unsupported community archive schema')
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, source TEXT NOT NULL, chat_id TEXT NOT NULL,
            chat_type TEXT NOT NULL, display_name TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT NOT NULL, timestamp REAL NOT NULL,
            platform_message_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            display_metadata TEXT, UNIQUE(session_id, platform_message_id)
        );
        CREATE INDEX IF NOT EXISTS archive_timeline ON messages(timestamp, id);
        CREATE TABLE IF NOT EXISTS legacy_imports (chat_id TEXT PRIMARY KEY, last_id INTEGER NOT NULL, complete INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS capture_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
    ''')


def write_message(conn, *, group, name, message_id, text, timestamp, metadata) -> None:
    metadata = {**metadata, 'archive_text': text[:MAX_CAPTURE_CHARS],
                'capture_truncated': len(text) > MAX_CAPTURE_CHARS}
    conn.execute('INSERT OR IGNORE INTO sessions VALUES (?, ?, ?, ?, ?)',
                 (group, 'whatsapp', group, 'group', name))
    conn.execute('''INSERT OR IGNORE INTO messages
        (session_id, role, content, timestamp, platform_message_id, display_metadata)
        VALUES (?, 'user', ?, ?, ?, ?)''',
                 (group, text[:MAX_CAPTURE_CHARS], timestamp, message_id,
                  json.dumps(metadata, ensure_ascii=False)))


def capture(home, policy, data, *, now=None) -> None:
    from .legacy import import_history

    target = archive_path(home)
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(target, timeout=3)) as conn:
        initialize(conn)
        # Import approved historical rows before the first live record. Progress
        # is per group and transactional; retry after a crash never duplicates.
        import_history(conn, Path(home) / 'state.db', policy)
        received = time.time() if now is None else now
        raw_time = data.get('timestamp')
        try:
            if isinstance(raw_time, bool):
                raise ValueError
            timestamp = float(raw_time)
            if timestamp > 100_000_000_000:
                timestamp /= 1000
            if not 0 < timestamp <= received + 300:
                raise ValueError
            time_source = 'platform'
        except (TypeError, ValueError, OverflowError):
            timestamp, time_source = received, 'received'
        group = str(data['chatId']).lower()
        text = str(data.get('body') or '').strip()
        metadata = {'archive_text': text[:MAX_CAPTURE_CHARS],
                    'sender_id': str(data.get('senderId') or '')[:200],
                    'sender_name': str(data.get('senderName') or '')[:200],
                    'capture_source': 'passive_bridge', 'captured_at': received,
                    'timestamp_source': time_source,
                    'capture_truncated': len(text) > MAX_CAPTURE_CHARS}
        with conn:
            conn.execute("INSERT OR REPLACE INTO capture_meta VALUES ('ready', '1')")
            write_message(conn, group=group, name=policy.groups[group],
                          message_id=str(data['messageId']), text=text,
                          timestamp=timestamp, metadata=metadata)


def database_for_read(home: Path) -> Path:
    owned = archive_path(home)
    # Historical active contract: old releases stored the archive in state.db.
    # Keep this read-only fallback until that home's first passive capture imports
    # its approved rows. Once ready is committed all reads use the owned archive.
    if owned.is_file():
        try:
            with closing(sqlite3.connect(owned.resolve().as_uri() + '?mode=ro', uri=True, timeout=3)) as conn:
                if conn.execute("SELECT value FROM capture_meta WHERE key='ready'").fetchone() == ('1',):
                    return owned
        except sqlite3.Error:
            pass
    return Path(home) / 'state.db'
