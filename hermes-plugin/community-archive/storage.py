"""SQLite connection and archive metadata compatibility helpers."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_EVIDENCE_CHARS = 4000
_ATTRIBUTED = re.compile(r"^\[([^|\]\n]{1,200})\|([^\]\n]{1,200})\]\s*")


class QueryError(RuntimeError):
    pass


def _metadata(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _archive_text(metadata: Any, content: Any) -> str:
    text = _metadata(metadata).get("archive_text")
    if not isinstance(text, str):
        text = str(content or "")
    return text.strip()


def _sender(metadata: Any, content: Any, key: str) -> str:
    value = _metadata(metadata).get(key)
    if isinstance(value, (str, int)) and str(value).strip():
        return str(value).strip()
    match = _ATTRIBUTED.match(str(content or ""))
    if not match:
        return ""
    return match.group(2 if key == "sender_id" else 1).strip()


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.is_file():
        raise QueryError("community archive database is not available")
    uri = db_path.resolve().as_uri() + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=3)
    except sqlite3.Error as exc:
        raise QueryError("community archive database could not be opened") from exc
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA busy_timeout = 3000")
    conn.create_function("archive_text", 2, _archive_text, deterministic=True)
    conn.create_function(
        "archive_sender_id", 2,
        lambda meta, content: _sender(meta, content, "sender_id"), deterministic=True,
    )
    conn.create_function(
        "archive_sender_name", 2,
        lambda meta, content: _sender(meta, content, "sender_name"), deterministic=True,
    )
    return conn


def iso_timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
