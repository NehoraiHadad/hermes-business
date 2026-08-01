"""Telegram reply policy: identifier normalization, the per-home policy file, and
target matching.

Unlike WhatsApp, Telegram offers a third ``full_access`` mode (answer everyone
Hermes authorizes). The safest option is ``read_only``, and it is the
fail-closed default whenever the policy file is absent or malformed — so a
missing/garbled file can never open the connection, only silence it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

POLICY_FILE = "business/telegram-policy.json"
PLATFORMS = frozenset({"telegram"})
MODES = frozenset({"full_access", "read_only", "selected_chats"})


def normalize_identifier(value: Any) -> str:
    """Canonicalize a Telegram id (numeric user/chat id or ``@username``). Numeric
    ids fold to ``str(int)`` (sign kept, leading zeros dropped); usernames drop a
    leading ``@`` and lower-case (Telegram usernames are case-insensitive). Kept
    in lockstep with normalizeTelegram() in the TS/Electron mirrors."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.lower().startswith("telegram:"):
        raw = raw[len("telegram:") :]
    raw = raw.removeprefix("@").strip()
    if not raw:
        return ""
    try:
        return str(int(raw))
    except ValueError:
        return raw.lower()


def default_policy() -> dict[str, Any]:
    return {"version": 1, "mode": "read_only", "reply_chats": []}


def load_policy(home: Any) -> dict[str, Any]:
    path = Path(home) / POLICY_FILE
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default_policy()
    if not isinstance(parsed, dict) or parsed.get("mode") not in MODES:
        return default_policy()
    chats = parsed.get("reply_chats")
    if not isinstance(chats, list):
        chats = []
    return {
        "version": 1,
        "mode": parsed["mode"],
        "reply_chats": [
            normalized for item in chats if (normalized := normalize_identifier(item))
        ],
    }


def can_reply(policy: dict[str, Any], *identifiers: Any) -> bool:
    mode = policy.get("mode")
    if mode == "full_access":
        return True
    if mode != "selected_chats":
        return False
    allowed = set(policy.get("reply_chats") or [])
    return any(normalize_identifier(value) in allowed for value in identifiers)
