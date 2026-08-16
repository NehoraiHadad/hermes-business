"""Fail-closed loading of the server-generated community archive scope."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

POLICY_FILE = Path("community") / "archive-policy.json"
MAX_POLICY_GROUPS = 500
MAX_REQUEST_GROUPS = 100
_GROUP_JID = re.compile(r"^[0-9]+(?:-[0-9]+)?@g\.us$", re.IGNORECASE)


class PolicyError(RuntimeError):
    pass


@dataclass(frozen=True)
class ArchivePolicy:
    groups: dict[str, str]

    def select(self, requested: Any = None) -> tuple[str, ...]:
        if requested is None:
            return tuple(self.groups)
        if not isinstance(requested, list) or not requested:
            raise PolicyError("group_ids must be a non-empty array when provided")
        if len(requested) > MAX_REQUEST_GROUPS:
            raise PolicyError(f"group_ids may contain at most {MAX_REQUEST_GROUPS} groups")
        selected: list[str] = []
        for value in requested:
            group_id = normalize_group_id(value)
            if group_id not in self.groups:
                raise PolicyError("one or more requested groups are not approved")
            if group_id not in selected:
                selected.append(group_id)
        return tuple(selected)


def normalize_group_id(value: Any) -> str:
    group_id = str(value or "").strip().lower()
    if not _GROUP_JID.fullmatch(group_id):
        raise PolicyError("invalid WhatsApp group id")
    return group_id


def load_policy(home: Path) -> ArchivePolicy:
    path = Path(home) / POLICY_FILE
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise PolicyError("community archive policy is missing or invalid") from exc
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise PolicyError("unsupported community archive policy")
    raw_groups = payload.get("groups")
    if not isinstance(raw_groups, list) or not raw_groups or len(raw_groups) > MAX_POLICY_GROUPS:
        raise PolicyError(f"community archive policy must contain 1-{MAX_POLICY_GROUPS} approved groups")

    groups: dict[str, str] = {}
    for item in raw_groups:
        if not isinstance(item, dict):
            raise PolicyError("community archive policy contains an invalid group")
        group_id = normalize_group_id(item.get("id"))
        name = str(item.get("name") or "").strip()
        if not name or len(name) > 200 or group_id in groups:
            raise PolicyError("community archive policy contains an invalid group")
        groups[group_id] = name
    return ArchivePolicy(groups=groups)
