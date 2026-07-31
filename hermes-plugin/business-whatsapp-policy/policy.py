"""Pure WhatsApp policy loading and target matching."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

POLICY_FILE = "business/whatsapp-policy.json"
PLATFORMS = frozenset({"whatsapp", "whatsapp_cloud"})
MODES = frozenset({"read_only", "selected_chats"})
_JID_SUFFIX = re.compile(r"@(?:s\.whatsapp\.net|lid)$", re.IGNORECASE)


def normalize_identifier(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    raw = raw.removeprefix("whatsapp_cloud:").removeprefix("whatsapp:")
    raw = raw.removeprefix("+")
    raw = _JID_SUFFIX.sub("", raw)
    if re.fullmatch(r"[\d\s().-]+", raw):
        return re.sub(r"\D", "", raw)
    return raw


def default_policy() -> dict[str, Any]:
    return {
        "version": 1,
        "mode": "read_only",
        "reply_chats": [],
    }


def load_policy(home: Path) -> dict[str, Any]:
    path = home / POLICY_FILE
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default_policy()
    if not isinstance(parsed, dict) or parsed.get("mode") not in MODES:
        return default_policy()
    chats = parsed.get("reply_chats")
    if not isinstance(chats, list):
        return default_policy()
    return {
        "version": 1,
        "mode": parsed["mode"],
        "reply_chats": [
            normalized for item in chats if (normalized := normalize_identifier(item))
        ],
    }


def can_reply(policy: dict[str, Any], *identifiers: Any) -> bool:
    if policy.get("mode") != "selected_chats":
        return False
    allowed = set(policy.get("reply_chats") or [])
    return any(normalize_identifier(value) in allowed for value in identifiers)


def target_parts(target: Any) -> tuple[str, str]:
    raw = str(target or "").strip()
    platform, separator, chat_id = raw.partition(":")
    return platform.lower(), chat_id if separator else ""
