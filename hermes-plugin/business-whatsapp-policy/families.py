"""Single-source mapping from a platform name to its business-messaging family
and the fail-closed authorization decision for that family.

Both outbound enforcement points — the ``pre_tool_call`` tool hook
(:mod:`.tool_hook`) and the ``send_message`` transport guard
(:mod:`.tool_transport`) — ask THIS module whether a send is permitted, so the
read-only / selected-chats / Telegram full-access semantics live in exactly one
place and can never drift between the two doors.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from . import policy as _wa
from . import telegram_policy as _tg


@dataclass(frozen=True)
class Family:
    name: str
    platforms: frozenset
    load: Callable[[Any], dict]
    reply: Callable[..., bool]
    normalize: Callable[[Any], str]


_FAMILIES = (
    Family("telegram", _tg.PLATFORMS, _tg.load_policy, _tg.can_reply, _tg.normalize_identifier),
    Family("whatsapp", _wa.PLATFORMS, _wa.load_policy, _wa.can_reply, _wa.normalize_identifier),
)

CONTROLLED_PLATFORMS = frozenset().union(*(f.platforms for f in _FAMILIES))


def platform_name(value: Any) -> str:
    """Lower-cased platform string, tolerating a bare string or an enum whose
    ``.value`` carries the name (gateway ``Platform``)."""
    inner = getattr(value, "value", value)
    return str(inner or "").strip().lower()


def family_for(platform: Any) -> Optional[Family]:
    name = platform_name(platform)
    for family in _FAMILIES:
        if name in family.platforms:
            return family
    return None


def is_controlled(platform: Any) -> bool:
    return family_for(platform) is not None


def authorize(platform: Any, *identifiers: Any, home: Any) -> bool:
    """Fail-closed authorization for a controlled family.

    A non-controlled platform returns ``False`` here (callers gate on
    :func:`is_controlled` first). A controlled family with NO resolvable
    destination denies even under Telegram ``full_access`` — a malformed or
    empty target is never a permitted send, only a blocked one.
    """
    family = family_for(platform)
    if family is None:
        return False
    if not any(family.normalize(value) for value in identifiers):
        return False
    return bool(family.reply(family.load(home), *identifiers))
