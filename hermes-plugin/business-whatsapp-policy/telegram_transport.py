"""Transport integration for Telegram: bind the shared deny-by-default guard
engine (:mod:`.guard_core`) to the Telegram reply policy and wrap every verified
outbound method plus the interactive callback authorizer on a live
``TelegramAdapter``. Fail closed on drift.
"""

from __future__ import annotations

from typing import Any, Callable

from .guard_core import (
    blocked_result,
    guard_interactive,
    guard_standalone,
    make_guard,
    target_from_call,
)
from .telegram_contract import (
    INTERACTIVE_AUTH_METHOD,
    OUTBOUND_METHODS,
    AdapterContractError,
)
from .telegram_policy import can_reply, load_policy
from .telegram_surface import verify_adapter_surface, verify_platform_entry

# Typing + topic mutators return None (or Optional[str]); a blocked call must
# yield None, never a truthy id. delete_message returns bool.
_NONE_RESULT = frozenset(
    {"send_typing", "create_handoff_thread", "ensure_dm_topic", "rename_dm_topic"}
)
_BOOL_RESULT = frozenset({"delete_message"})
_MESSAGE = "Telegram sending is blocked by the business reply policy."

__all__ = [
    "AdapterContractError",
    "guard_adapter",
    "guard_standalone_sender",
    "verify_adapter_surface",
    "verify_platform_entry",
    "load_policy",
    "can_reply",
]


def _authorize(home_getter: Callable[[], Any]):
    return lambda *ids: can_reply(load_policy(home_getter()), *ids)


def _blocked(method: str):
    return blocked_result(method, _NONE_RESULT, _BOOL_RESULT, _MESSAGE)


def _target(method: str, args: tuple, kwargs: dict) -> Any:
    return target_from_call(args, kwargs)


# Telegram chat-type semantics for inline-button taps. The live adapter passes
# ``chat_type`` straight from python-telegram-bot's ``chat.type`` (raw values
# private/group/supergroup/channel, sometimes as a ``ChatType.X`` enum repr) and
# only normalizes it INTERNALLY, after this guard has already run. So we classify
# here the same defensive way the adapter does elsewhere — strip any
# ``ChatType.`` prefix, lower-case — and accept both the raw Telegram values and
# this plugin's normalized ones (dm/forum). This is the callback twin of
# dispatch._tg_is_group / reply_identifiers; keep them in lockstep.
_DM_CHAT_TYPES = frozenset({"dm", "private"})


def _normalize_chat_type(value: Any) -> str:
    return str(value or "").split(".")[-1].strip().lower()


def _callback_ids(args: tuple, kwargs: dict) -> tuple:
    """Identifiers an inline-button tap is authorized against — group-vs-sender
    parity with the dispatch hook, fail-closed on an unknown chat type.

    Guarded signature: ``_is_callback_user_authorized(user_id, *, chat_id=,
    chat_type=, ...)``.

    * DM (private): the chat IS the sender — Telegram sets ``chat.id == user.id``
      and the adapter defaults ``chat_id`` to the user id — so the sender and the
      chat identify the same conversation; authorize by either.
    * group / supergroup / channel / forum: the GROUP chat is the only authority;
      an individual sender NEVER authorizes a tap. This closes the hole where a
      user selected for a DM could tap inside an UNSELECTED group.
    * unknown / missing chat type: we cannot prove this is a DM, so we fail closed
      to the group rule (chat id only) rather than trusting the sender. A
      numeric-id DM still authorizes via ``chat_id`` (== the user id); only the
      rare username-selected DM with no chat type is denied — the safe side.
    """
    user_id = args[0] if args else kwargs.get("user_id", "")
    chat_id = kwargs.get("chat_id", "")
    if _normalize_chat_type(kwargs.get("chat_type")) in _DM_CHAT_TYPES:
        return (user_id, chat_id)
    return (chat_id,)


def guard_adapter(adapter: Any, home_getter: Callable[[], Any]) -> Any:
    """Wrap every verified outbound method + the callback authorizer on *adapter*.

    Raises :class:`AdapterContractError` (fail closed) when the outbound surface
    has drifted beyond the verified contract. The registry factory turns that
    into a disabled connection rather than an unguarded one."""
    verify_adapter_surface(adapter)
    authorize = _authorize(home_getter)
    for name in OUTBOUND_METHODS:
        original = getattr(adapter, name, None)
        if not callable(original):
            continue
        setattr(adapter, name, make_guard(name, original, authorize, _blocked, _target))
    guard_interactive(adapter, INTERACTIVE_AUTH_METHOD, authorize, _callback_ids)
    return adapter


def guard_standalone_sender(original, home_getter: Callable[[], Any]):
    return guard_standalone(original, _authorize(home_getter), _MESSAGE)
