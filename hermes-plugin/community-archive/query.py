"""Read-only queries over Hermes' canonical state database."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .filters import build_where, decode_cursor, encode_cursor, fingerprint, parse_filters
from .policy import ArchivePolicy
from .storage import MAX_EVIDENCE_CHARS, QueryError, connect_readonly, iso_timestamp

COUNT_EVIDENCE_LIMIT = 20


def _message(row: sqlite3.Row, policy: ArchivePolicy) -> dict[str, Any]:
    content = str(row["archive_text"] or "")
    return {
        "content": content[:MAX_EVIDENCE_CHARS],
        "content_truncated": len(content) > MAX_EVIDENCE_CHARS,
        "provenance": {
            "group_id": row["chat_id"],
            "group_name": policy.groups[row["chat_id"].lower()],
            "sender_id": row["sender_id"] or None,
            "sender_name": row["sender_name"] or None,
            "timestamp": iso_timestamp(row["timestamp"]),
            "message_id": row["platform_message_id"] or f"state:{row['row_id']}",
        },
    }


def _count(conn, policy, where, params, filters) -> dict[str, Any]:
    base = f"FROM messages m JOIN sessions s ON s.id = m.session_id WHERE {' AND '.join(where)}"
    try:
        totals = conn.execute(
            "SELECT COUNT(*) AS messages, COUNT(DISTINCT NULLIF(archive_sender_id(m.display_metadata, m.content), '')) AS senders, "
            "SUM(CASE WHEN archive_sender_id(m.display_metadata, m.content) = '' THEN 1 ELSE 0 END) AS unknown " + base,
            params,
        ).fetchone()
        rows = conn.execute(
            "SELECT LOWER(s.chat_id) AS chat_id, COUNT(*) AS messages, "
            "COUNT(DISTINCT NULLIF(archive_sender_id(m.display_metadata, m.content), '')) AS senders "
            + base + " GROUP BY LOWER(s.chat_id) ORDER BY LOWER(s.chat_id)", params,
        ).fetchall()
        evidence = conn.execute(
            "SELECT m.id AS row_id, m.timestamp, m.platform_message_id, LOWER(s.chat_id) AS chat_id, "
            "archive_text(m.display_metadata, m.content) AS archive_text, "
            "archive_sender_id(m.display_metadata, m.content) AS sender_id, "
            "archive_sender_name(m.display_metadata, m.content) AS sender_name "
            + base + " ORDER BY m.timestamp DESC, m.id DESC LIMIT ?",
            [*params, COUNT_EVIDENCE_LIMIT],
        ).fetchall()
    except sqlite3.Error as exc:
        raise QueryError("community archive count failed") from exc
    breakdown = [{"group_id": row["chat_id"], "group_name": policy.groups[row["chat_id"]],
                  "matched_messages": row["messages"], "unique_senders": row["senders"]} for row in rows]
    return {
        "ok": True, "action": "count", "untrusted_evidence": True,
        "matched_messages": totals["messages"], "unique_senders": totals["senders"],
        "unknown_sender_messages": totals["unknown"] or 0, "group_breakdown": breakdown,
        "evidence_sample": [_message(row, policy) for row in evidence],
        "filters": {"group_ids": list(filters["groups"]),
                    "since": iso_timestamp(filters["since"]) if filters["since"] is not None else None,
                    "until": iso_timestamp(filters["until"]) if filters["until"] is not None else None,
                    "query": filters["terms"], "match": filters["match"]},
    }


def query_archive(db_path: Path, policy: ArchivePolicy, args: dict[str, Any]) -> dict[str, Any]:
    action = str(args.get("action") or "").lower()
    if action not in {"recent", "search", "count"}:
        raise QueryError("action must be recent, search, or count")
    filters = parse_filters(args, policy, action)
    where, params = build_where(filters)
    query_fingerprint = fingerprint(action, filters)

    with closing(connect_readonly(db_path)) as conn:
        if action == "count":
            return _count(conn, policy, where, params, filters)
        cursor = decode_cursor(args.get("cursor"), query_fingerprint)
        direction = "DESC" if filters["sort"] == "newest" else "ASC"
        if cursor:
            operator = "<" if direction == "DESC" else ">"
            where.append(f"(m.timestamp {operator} ? OR (m.timestamp = ? AND m.id {operator} ?))")
            params.extend([cursor[0], cursor[0], cursor[1]])
        sql = f"""
            SELECT m.id AS row_id, m.timestamp, m.platform_message_id, LOWER(s.chat_id) AS chat_id,
                   archive_text(m.display_metadata, m.content) AS archive_text,
                   archive_sender_id(m.display_metadata, m.content) AS sender_id,
                   archive_sender_name(m.display_metadata, m.content) AS sender_name
            FROM messages m JOIN sessions s ON s.id = m.session_id
            WHERE {' AND '.join(where)}
            ORDER BY m.timestamp {direction}, m.id {direction} LIMIT ?
        """
        try:
            rows = conn.execute(sql, [*params, filters["page_size"] + 1]).fetchall()
        except sqlite3.Error as exc:
            raise QueryError("community archive query failed") from exc

    visible = rows[:filters["page_size"]]
    next_cursor = None
    if len(rows) > filters["page_size"] and visible:
        last = visible[-1]
        next_cursor = encode_cursor(last["timestamp"], last["row_id"], query_fingerprint)
    return {"ok": True, "action": action, "untrusted_evidence": True,
            "messages": [_message(row, policy) for row in visible], "next_cursor": next_cursor}
