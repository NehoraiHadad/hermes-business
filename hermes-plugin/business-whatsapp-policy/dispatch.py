"""Shared read-only dispatch decision + reply-target identifiers for every
messaging family.

The gateway's ``pre_gateway_dispatch`` hook (fired for every user-originated
message on any platform, before auth) calls a family handler that computes
whether the reply policy authorizes this message. This module turns that boolean
into the gateway's ``allow`` / ``skip`` contract and performs the passive ingest,
so read-only never silently drops a message: it is recorded, but no reply is
ever dispatched to the agent.
"""

from __future__ import annotations

import logging

from .ingest import ingest_without_reply

logger = logging.getLogger(__name__)


def platform_value(source) -> str:
    """The lower-cased platform string for a source, tolerating both a bare
    string and a ``Platform`` enum (whose ``.value`` carries the name)."""
    value = getattr(source, "platform", "")
    return str(getattr(value, "value", value) or "").lower()


def reply_identifiers(source, is_group: bool) -> tuple:
    """Identifiers the reply policy is matched against. In a group the ONLY
    authority is the group chat id (never an individual sender); in a direct
    chat the chat id and the sender's ids are all candidates."""
    chat_id = getattr(source, "chat_id", "")
    if is_group:
        return (chat_id,)
    return (chat_id, getattr(source, "user_id", ""), getattr(source, "user_id_alt", ""))


def read_only_dispatch(event, session_store, *, authorized: bool, reason: str, placeholder: str):
    """Allow the dispatch when authorized; otherwise passively ingest and skip.

    Persistence is best-effort, but silence is not: a storage failure must never
    turn a read-only message into a normal agent dispatch, so we always skip."""
    if authorized:
        return {"action": "allow"}
    try:
        ingest_without_reply(event, session_store, placeholder)
    except Exception:
        logger.exception("Passive ingest failed; dispatch remains blocked")
    return {"action": "skip", "reason": reason}
