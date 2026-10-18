"""Fail-closed, default-deny guard binding for WhatsApp outbound side effects.

The deny-by-default machinery lives in :mod:`.guard_core` (shared with every
messaging family). This module binds it to the WhatsApp reply policy and
exposes the bound helpers under public (non-underscore) names so
:mod:`.transport`, :mod:`.registry` and the tests can import them across the
module boundary. A guarded method runs only when the reply policy positively
authorizes the resolved chat target; read-only authorizes nothing.

Every entry point here funnels through :func:`_authorize`, which is the one
fail-closed authorizer for this door (see the module docstring in
:mod:`.families` for how this door relates to the other two authorization
entry points in the plugin).
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from .contract import INTERACTIVE_REPLY_METHOD
from .guard_core import (
    blocked_result,
    guard_standalone,
    make_guard,
    target_from_call,
)
from .policy import can_reply, load_policy

logger = logging.getLogger(__name__)

_NO_RESULT_METHODS = frozenset(
    {"send_typing", "stop_typing", "mark_read", "_send_read_receipt"}
)
_BOOL_RESULT_METHODS = frozenset({"delete", "delete_message"})
_MESSAGE = "WhatsApp sending is blocked by the business reply policy."


def _read_receipt_target(data: dict) -> Any:
    # ``_send_read_receipt`` receives the raw bridge payload dict, not a chat_id.
    return data.get("chatId") or data.get("senderId") or data.get("from") or ""


def _authorize(home_getter: Callable[[], Any], platform: str | None = None):
    """Fail-closed authorizer, matching the idiom in :func:`.egress.decision`:
    any exception resolving the home or evaluating the policy is treated as
    unauthorized rather than propagating out of a guarded outbound call."""

    def authorize(*ids: Any) -> bool:
        try:
            return can_reply(load_policy(home_getter()), *ids, platform=platform)
        except Exception:
            logger.exception("WhatsApp reply policy evaluation failed; blocking send")
            return False

    return authorize


def _blocked(method: str):
    return blocked_result(method, _NO_RESULT_METHODS, _BOOL_RESULT_METHODS, _MESSAGE)


def _target(method: str, args: tuple, kwargs: dict) -> Any:
    if method == "send_final_ledgered":
        event = args[0] if args else kwargs.get("event")
        return getattr(getattr(event, "source", None), "chat_id", "")
    if method == "_send_exec_approval_prompt":
        prompt = args[0] if args else kwargs.get("prompt")
        return getattr(prompt, "chat_id", "")
    resolver = _read_receipt_target if method == "_send_read_receipt" else None
    return target_from_call(args, kwargs, resolver)


def make_outbound_guard(name, original, home_getter, platform=None):
    """Wrap one outbound adapter method. ``guard_core.make_guard`` already
    branches on ``inspect.iscoroutinefunction`` to pick the async/sync wrapper,
    so there is exactly one call site here for both cases."""
    def blocked(method):
        result = _blocked(method)
        # Native ledgered delivery returns (result, current adapter). Refuse
        # before it records a delivery obligation that could be retried later.
        return (result, original.__self__) if method == "send_final_ledgered" else result
    return make_guard(name, original, _authorize(home_getter, platform), blocked, _target)


def guard_interactive_reply(adapter: Any, home_getter: Callable[[], Any], platform=None) -> None:
    original = getattr(adapter, INTERACTIVE_REPLY_METHOD, None)
    if not callable(original):
        return
    authorize = _authorize(home_getter, platform)

    async def guarded(raw_message, contacts_by_waid):
        sender = raw_message.get("from", "") if isinstance(raw_message, dict) else ""
        if not authorize(sender):
            # Native True means claimed: block the resolver AND text fallback.
            return True
        return await original(raw_message, contacts_by_waid)

    setattr(adapter, INTERACTIVE_REPLY_METHOD, guarded)


def guard_standalone_sender(original, home_getter):
    return guard_standalone(original, _authorize(home_getter), _MESSAGE)
