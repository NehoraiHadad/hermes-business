"""Single-source mapping for the WhatsApp-only business safety policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from . import policy as _wa


@dataclass(frozen=True)
class Family:
    name: str
    platforms: frozenset
    load: Callable[[Any], Any]
    reply: Callable[..., bool]
    normalize: Callable[[Any], str]


_FAMILIES = (
    Family("whatsapp", _wa.PLATFORMS, _wa.load_policy, _wa.can_reply, _wa.normalize_identifier),
)
CONTROLLED_PLATFORMS = frozenset().union(*(family.platforms for family in _FAMILIES))


def platform_name(value: Any) -> str:
    return str(getattr(value, "value", value) or "").strip().lower()


def family_for(platform: Any) -> Optional[Family]:
    name = platform_name(platform)
    return next((family for family in _FAMILIES if name in family.platforms), None)


def is_controlled(platform: Any) -> bool:
    return family_for(platform) is not None


def authorize(platform: Any, *identifiers: Any, home: Any) -> bool:
    family = family_for(platform)
    if family is None or not any(family.normalize(value) for value in identifiers):
        return False
    return bool(family.reply(family.load(home), *identifiers))
