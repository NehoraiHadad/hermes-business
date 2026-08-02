"""Platform-neutral, deny-by-default guard machinery shared by every messaging
family (WhatsApp, Telegram, ...).

This is the SINGLE guard engine — it is never duplicated per platform. A guarded
outbound method runs only when the family's reply policy positively authorizes
the resolved chat target; otherwise it returns a family-appropriate blocked
result. Each family binds this engine with its own policy loader / normalizer
through a thin wrapper (see ``guards.py`` and ``transport.py``).
"""

from __future__ import annotations

import inspect
from typing import Any, Callable


def blocked_result(method: str, no_result, bool_result, message: str):
    """The value a blocked call returns, matching the real method's return type
    so a caller cannot tell a policy block apart from an ordinary failed send."""
    if method in no_result:
        return None
    if method in bool_result:
        return False
    from gateway.platforms.base import SendResult

    return SendResult(success=False, error=message)


def target_from_call(args: tuple, kwargs: dict, dict_resolver: Callable | None = None):
    """Resolve the chat target from a call. Every guarded outbound method takes
    ``chat_id`` first (positional or kwarg). A dict target is only trusted when a
    family supplies a resolver for it; otherwise it resolves to ``""`` (blocked)."""
    target = kwargs.get("chat_id")
    if target is None and args:
        target = args[0]
    if isinstance(target, dict):
        return dict_resolver(target) if dict_resolver else ""
    return target or ""


def make_guard(name, original, authorize, blocked_for, target_for):
    """Wrap one outbound method. Async and synchronous mutators both fail closed:
    a plain ``def send(...)`` would otherwise bypass the policy entirely."""
    if inspect.iscoroutinefunction(original):

        async def guarded_async(*args, **kwargs):
            if not authorize(target_for(name, args, kwargs)):
                return blocked_for(name)
            return await original(*args, **kwargs)

        return guarded_async

    def guarded_sync(*args, **kwargs):
        if not authorize(target_for(name, args, kwargs)):
            return blocked_for(name)
        return original(*args, **kwargs)

    return guarded_sync


def guard_interactive(adapter: Any, method_name: str, authorize, ids_from) -> None:
    """Route an interactive (button/tap) authorizer through the reply policy so a
    stale button cannot bypass read-only. Signature-preserving: ``ids_from``
    extracts the candidate identifiers from whatever args the platform passes."""
    original = getattr(adapter, method_name, None)
    if not callable(original):
        return

    def guarded(*args, **kwargs):
        if not authorize(*ids_from(args, kwargs)):
            return False
        try:
            return bool(original(*args, **kwargs))
        except Exception:
            return False

    setattr(adapter, method_name, guarded)


def guard_standalone(original, authorize, message: str):
    """Wrap a platform's out-of-process ``standalone_sender_fn`` (cron/scheduled
    delivery) so it obeys the same reply policy. Hermes' contract is async; a
    synchronous implementation is guarded too in case a future entry ships one."""
    if original is None:
        return None

    if inspect.iscoroutinefunction(original):

        async def guarded_async(config, chat_id, message_text, **kwargs):
            if not authorize(chat_id):
                return {"error": message}
            return await original(config, chat_id, message_text, **kwargs)

        return guarded_async

    def guarded_sync(config, chat_id, message_text, **kwargs):
        if not authorize(chat_id):
            return {"error": message}
        return original(config, chat_id, message_text, **kwargs)

    return guarded_sync
