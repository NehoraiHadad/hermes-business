"""Fail-closed, default-deny guard machinery for WhatsApp outbound side effects.

The policy is *deny by default*: a guarded outbound method runs only when the
reply policy positively authorizes the resolved chat target. If the target
cannot be resolved from the call, the method blocks. Read-only mode authorizes
nothing, so it produces zero outbound.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable

from .contract import INTERACTIVE_AUTH_METHOD
from .policy import can_reply, load_policy

_NO_RESULT_METHODS = frozenset(
    {"send_typing", "stop_typing", "mark_read", "_send_read_receipt"}
)
_BOOL_RESULT_METHODS = frozenset({"delete", "delete_message"})

_STANDALONE_BLOCKED = {
    "error": "WhatsApp sending is blocked by the business reply policy."
}


def _blocked_result(method: str):
    if method in _NO_RESULT_METHODS:
        return None
    if method in _BOOL_RESULT_METHODS:
        return False
    from gateway.platforms.base import SendResult

    return SendResult(
        success=False,
        error="WhatsApp sending is blocked by the business reply policy.",
    )


def _target_from_call(method: str, args: tuple, kwargs: dict) -> Any:
    # Every verified outbound method takes ``chat_id`` first (positional or
    # kwarg). ``_send_read_receipt`` is the one exception: it receives the raw
    # bridge payload dict.
    target = kwargs.get("chat_id")
    if target is None and args:
        target = args[0]
    if method == "_send_read_receipt" and isinstance(target, dict):
        return (
            target.get("chatId")
            or target.get("senderId")
            or target.get("from")
            or ""
        )
    if isinstance(target, dict):
        # An unresolved dict target must not be treated as an allowed chat.
        return ""
    return target or ""


def _make_async_guard(name, original, home_getter):
    async def guarded(*args, **kwargs):
        chat_id = _target_from_call(name, args, kwargs)
        if not can_reply(load_policy(home_getter()), chat_id):
            return _blocked_result(name)
        return await original(*args, **kwargs)

    return guarded


def _make_sync_guard(name, original, home_getter):
    def guarded(*args, **kwargs):
        chat_id = _target_from_call(name, args, kwargs)
        if not can_reply(load_policy(home_getter()), chat_id):
            return _blocked_result(name)
        return original(*args, **kwargs)

    return guarded


def _guard_interactive_auth(adapter: Any, home_getter: Callable[[], Any]) -> None:
    original = getattr(adapter, INTERACTIVE_AUTH_METHOD, None)
    if not callable(original):
        return

    def guarded(sender_id):
        # Both the adapter's own auth AND the reply policy must allow the tap.
        if not can_reply(load_policy(home_getter()), sender_id):
            return False
        try:
            return bool(original(sender_id))
        except Exception:
            return False

    setattr(adapter, INTERACTIVE_AUTH_METHOD, guarded)


def _guard_standalone(original, home_getter):
    """Wrap a platform's out-of-process ``standalone_sender_fn`` (cron/scheduled
    delivery) so it obeys the same reply policy. Hermes' contract is async; a
    synchronous implementation is guarded too in case a future entry ships one.
    """
    if original is None:
        return None

    if inspect.iscoroutinefunction(original):
        async def guarded_async(config, chat_id, message, **kwargs):
            if not can_reply(load_policy(home_getter()), chat_id):
                return dict(_STANDALONE_BLOCKED)
            return await original(config, chat_id, message, **kwargs)

        return guarded_async

    def guarded_sync(config, chat_id, message, **kwargs):
        if not can_reply(load_policy(home_getter()), chat_id):
            return dict(_STANDALONE_BLOCKED)
        return original(config, chat_id, message, **kwargs)

    return guarded_sync
