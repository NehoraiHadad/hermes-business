"""Single-source mapping for the WhatsApp-only business safety policy.

There are three authorization entry points in this plugin. They are NOT all
routed through this module's ``family_for``/``is_controlled``/``authorize``
helpers, and that is intentional rather than an oversight left over from
consolidation:

  * :func:`.__init__.pre_gateway_dispatch` (dispatch-time hook, fired for
    every inbound message before the agent ever sees it) calls
    ``policy.can_process`` directly. This is a *process* decision (does
    ``mode == "selected_chats"`` cover this chat at all?), not a *reply*
    decision. Routing it through :func:`authorize` here would incorrectly
    gate dispatch on ``behavior == "assist"`` too (``authorize`` wraps
    ``Family.reply``, i.e. ``policy.can_reply``), silently narrowing which
    chats get ingested at all. Families would need a second, process-only
    callable to avoid that — not worth the indirection for a single family.

  * :mod:`.guards` (adapter outbound-method + standalone-sender guards, see
    ``_authorize`` there) calls ``policy.can_reply`` directly through its own
    fail-closed wrapper (matching the try/except idiom below). The standalone
    sender guard in particular is bound with NO platform argument for both
    the native and Cloud senders (see ``registry.py``), so
    ``family_for(platform)`` would never resolve and :func:`authorize` would
    unconditionally reject every scheduled/cron WhatsApp send. Forcing a
    platform through that path would change the (intentionally
    platform-agnostic) standalone-sender matching behavior, which is out of
    scope for a hygiene pass.

  * :mod:`.egress` (the shared ``send_message`` transport monkeypatch AND
    :mod:`.tool_hook`'s ``pre_tool_call``) is the one door that genuinely
    benefits from the family abstraction: both chokepoints always resolve a
    concrete ``platform`` string from the call/target before deciding
    anything, so ``family_for``/``is_controlled``/``authorize`` are a clean
    fit and are used as designed.

All three doors are fail-closed on any policy-evaluation error (an exception
denies the send/dispatch rather than propagating), and none of the above
changes what is authorized for a given policy — only which module resolves
the decision.
"""

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
    return bool(family.reply(
        family.load(home), *identifiers, platform=platform_name(platform)
    ))
