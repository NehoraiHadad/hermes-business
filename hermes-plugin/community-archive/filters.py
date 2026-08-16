"""Validation, parameterized SQL filters, and stable pagination cursors."""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime
from typing import Any

from .policy import ArchivePolicy
from .storage import QueryError

MAX_PAGE_SIZE = 100
MAX_QUERY_CHARS = 500
MAX_TERMS = 20


def _timestamp(value: Any, label: str) -> float | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > 64:
        raise QueryError(f"{label} must be an ISO-8601 timestamp with timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise QueryError(f"{label} must be an ISO-8601 timestamp with timezone") from exc
    if parsed.tzinfo is None:
        raise QueryError(f"{label} must include a timezone")
    return parsed.timestamp()


def _terms(args: dict[str, Any], required: bool) -> tuple[list[str], str]:
    raw = args.get("query")
    if raw in (None, "") and not required:
        return [], "phrase"
    if not isinstance(raw, str) or not raw.strip() or len(raw) > MAX_QUERY_CHARS:
        raise QueryError(f"query must contain 1-{MAX_QUERY_CHARS} characters")
    mode = str(args.get("match") or "all").lower()
    if mode not in {"all", "any", "phrase"}:
        raise QueryError("match must be all, any, or phrase")
    values = [raw.strip()] if mode == "phrase" else raw.split()
    values = list(dict.fromkeys(value for value in values if value))
    if not values or len(values) > MAX_TERMS:
        raise QueryError(f"query must contain at most {MAX_TERMS} terms")
    return values, mode


def parse_filters(args: dict[str, Any], policy: ArchivePolicy, action: str) -> dict[str, Any]:
    groups = policy.select(args.get("group_ids"))
    since = _timestamp(args.get("since"), "since")
    until = _timestamp(args.get("until"), "until")
    if since is not None and until is not None and since > until:
        raise QueryError("since must not be later than until")
    terms, match = _terms(args, required=action == "search")
    sort = str(args.get("sort") or "newest").lower()
    if sort not in {"newest", "oldest"}:
        raise QueryError("sort must be newest or oldest")
    try:
        page_size = int(args.get("page_size") or 20)
    except (TypeError, ValueError) as exc:
        raise QueryError("page_size must be an integer") from exc
    if not 1 <= page_size <= MAX_PAGE_SIZE:
        raise QueryError(f"page_size must be between 1 and {MAX_PAGE_SIZE}")
    return {"groups": groups, "since": since, "until": until, "terms": terms,
            "match": match, "sort": sort, "page_size": page_size}


def build_where(filters: dict[str, Any]) -> tuple[list[str], list[Any]]:
    groups = filters["groups"]
    where = ["LOWER(s.source) = 'whatsapp'", "LOWER(COALESCE(s.chat_type, '')) = 'group'",
             "LOWER(s.chat_id) IN (" + ",".join("?" for _ in groups) + ")",
             "m.role = 'user'", "COALESCE(m.active, 1) = 1", "m.platform_message_id IS NOT NULL",
             "archive_text(m.display_metadata, m.content) <> ''"]
    params: list[Any] = list(groups)
    for key, operator in (("since", ">="), ("until", "<=")):
        if filters[key] is not None:
            where.append(f"m.timestamp {operator} ?")
            params.append(filters[key])
    terms = filters["terms"]
    if terms:
        clauses = ["archive_text(m.display_metadata, m.content) LIKE ? ESCAPE '\\'" for _ in terms]
        where.append("(" + (" OR " if filters["match"] == "any" else " AND ").join(clauses) + ")")
        params.extend("%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for term in terms)
    return where, params


def fingerprint(action: str, filters: dict[str, Any]) -> str:
    keys = ("groups", "since", "until", "terms", "match", "sort")
    raw = json.dumps({"action": action, **{key: filters[key] for key in keys}},
                     ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def encode_cursor(timestamp: float, row_id: int, query_fingerprint: str) -> str:
    raw = json.dumps({"v": 1, "ts": timestamp, "id": row_id, "fp": query_fingerprint}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(value: Any, query_fingerprint: str) -> tuple[float, int] | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > 512:
        raise QueryError("invalid cursor")
    try:
        parsed = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode())
        if parsed.get("v") != 1 or parsed.get("fp") != query_fingerprint:
            raise ValueError
        return float(parsed["ts"]), int(parsed["id"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise QueryError("cursor does not match this query") from exc
