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
        "version": 2,
        "mode": "read_only",
        "behavior": "monitor",
        "reply_chats": [],
        "reply_groups": [],
        "sources": [],
        "community_sources": [],
    }


def _normalize_sources(raw: Any) -> list[dict[str, str]]:
    """Validate a raw source list into ``[{id, type, platform}]`` entries,
    deduplicated by (platform, id); cloud groups are unsupported and dropped."""
    if not isinstance(raw, list):
        return []
    sources: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        platform = item.get("platform", "whatsapp")
        source_type = "group" if item.get("type") == "group" else "dm"
        source_id = str(item.get("id") or "").strip()
        key = (platform, source_id)
        if platform not in PLATFORMS or not source_id or key in seen:
            continue
        if platform == "whatsapp_cloud" and source_type == "group":
            continue
        seen.add(key)
        sources.append({"id": source_id, "type": source_type, "platform": platform})
    return sources


def load_policy(home: Path) -> dict[str, Any]:
    path = home / POLICY_FILE
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default_policy()
    if not isinstance(parsed, dict) or parsed.get("mode") not in MODES:
        return default_policy()
    chats = parsed.get("reply_chats")
    groups = parsed.get("reply_groups", [])
    if not isinstance(chats, list) or not isinstance(groups, list):
        return default_policy()
    raw_sources = parsed.get("sources")
    if not isinstance(raw_sources, list):
        raw_sources = [
            *({"id": item, "type": "dm", "platform": "whatsapp"} for item in chats),
            *({"id": item, "type": "dm", "platform": "whatsapp_cloud"} for item in chats),
            *({"id": item, "type": "group", "platform": "whatsapp"} for item in groups),
        ]
    sources = _normalize_sources(raw_sources)
    return {
        "version": 2,
        "mode": parsed["mode"],
        "behavior": parsed.get("behavior", "assist" if parsed["mode"] == "selected_chats" else "monitor"),
        "reply_chats": [
            normalized for item in chats if (normalized := normalize_identifier(item))
        ],
        "reply_groups": [
            normalized for item in groups if (normalized := normalize_identifier(item))
        ],
        "sources": sources,
        # Community-mode grants (written by the Tachles community generator
        # from community.yaml — the operator's explicit contract approval).
        # These authorize processing AND replying on exactly the contract's
        # chats WITHOUT touching the owner's business-surface mode/behavior.
        "community_sources": _normalize_sources(parsed.get("community_sources")),
    }


def _community_allowed(policy: dict[str, Any], identifiers: tuple, platform: str | None) -> bool:
    entries = policy.get("community_sources") or []
    allowed = {
        normalize_identifier(item.get("id")) for item in entries
        if not platform or item.get("platform") == platform
    }
    allowed.discard("")
    return any(normalize_identifier(value) in allowed for value in identifiers)


def can_process(policy: dict[str, Any], *identifiers: Any, platform: str | None = None) -> bool:
    # Community-contract chats are authorized regardless of the owner-surface
    # mode: the contract IS the approval for those chats, and the owner's
    # read_only/selected_chats choice keeps governing every other chat.
    if _community_allowed(policy, identifiers, platform):
        return True
    if policy.get("mode") != "selected_chats":
        return False
    sources = policy.get("sources") or []
    allowed = {
        normalize_identifier(item.get("id")) for item in sources
        if not platform or item.get("platform") == platform
    }
    if not sources:
        # Legacy back-compat fallback: a policy file written before the
        # ``sources`` schema (version < 2, or a version-2 file that never
        # populated ``sources``) only has flat ``reply_chats``/``reply_groups``
        # lists with no per-entry platform tag. Those lists are unioned here
        # WITHOUT filtering by the ``platform`` argument -- intentionally: the
        # legacy schema predates multi-platform (native + Cloud) WhatsApp, so
        # an old allowlist entry authorizes a chat id on either platform
        # rather than being silently dropped because it lacks a platform tag.
        # ``load_policy`` normalizes ``sources`` from these same lists on read
        # (see the fallback there), so in practice this branch is only reached
        # when ``sources`` itself was explicitly written empty; it is kept for
        # defense-in-depth against any policy file that predates that migration.
        allowed = set(policy.get("reply_chats") or []) | set(policy.get("reply_groups") or [])
    return any(normalize_identifier(value) in allowed for value in identifiers)


def can_reply(policy: dict[str, Any], *identifiers: Any, platform: str | None = None) -> bool:
    if _community_allowed(policy, identifiers, platform):
        return True
    if policy.get("behavior") != "assist":
        return False
    return can_process(policy, *identifiers, platform=platform)


def target_parts(target: Any) -> tuple[str, str]:
    raw = str(target or "").strip()
    platform, separator, chat_id = raw.partition(":")
    return platform.lower(), chat_id if separator else ""
