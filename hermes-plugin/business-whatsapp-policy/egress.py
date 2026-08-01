"""Shared outbound-send decision used by both enforcement points.

Turns a ``(platform, destination)`` pair into either ``None`` — allow, because
the platform is not a business-controlled family OR the family policy permits the
destination — or a human-readable block reason (deny).

Fail-closed: any error resolving the policy for a controlled family denies the
send. Non-controlled platforms (discord, slack, signal, ...) are never touched;
this policy governs only the WhatsApp and Telegram families.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from . import families

logger = logging.getLogger(__name__)

_BLOCK_MESSAGES = {
    "telegram": "Telegram sending is blocked by the business reply policy.",
    "whatsapp": "WhatsApp sending is blocked by the business reply policy.",
}
_GENERIC_BLOCK = "Sending is blocked by the business reply policy."


def parse_target(target: Any) -> tuple[str, str]:
    """Split a ``send_message`` target ``"platform[:chat_id[:thread]]"`` into
    ``(platform, chat_id)`` WITHOUT trusting any upstream normalization. The
    platform is the substring before the first colon; the chat id is the next
    ``:``-delimited segment (a trailing thread id is not part of the target
    identity for authorization)."""
    raw = str(target or "").strip()
    if not raw:
        return "", ""
    platform, sep, remainder = raw.partition(":")
    if not sep:
        return platform.strip().lower(), ""
    chat_id = remainder.split(":", 1)[0].strip()
    return platform.strip().lower(), chat_id


def decision(platform: Any, *identifiers: Any, home_getter) -> Optional[str]:
    """Return a block reason when a controlled-family send is not authorized,
    else ``None``.

    ``home_getter`` is a zero-arg callable returning the Hermes home; it is
    invoked (and any policy resolution) inside a fail-closed try/except so a
    broken home or garbled policy denies rather than opens the connection.
    """
    family = families.family_for(platform)
    if family is None:
        return None
    try:
        allowed = families.authorize(platform, *identifiers, home=home_getter())
    except Exception:
        logger.exception("Messaging egress policy evaluation failed; blocking send")
        allowed = False
    if allowed:
        return None
    return _BLOCK_MESSAGES.get(family.name, _GENERIC_BLOCK)
