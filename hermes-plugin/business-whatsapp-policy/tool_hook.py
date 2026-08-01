"""``pre_tool_call`` fail-closed guard for outbound messaging *tools*.

Hermes fires ``pre_tool_call`` for every model-invoked tool and blocks execution
when a callback returns ``{"action": "block", "message": "<non-empty>"}`` (first
valid block wins; malformed returns are ignored). We recognize the outbound
``send_message``-family tools, resolve their destination WITHOUT trusting
renderer normalization, and block a Telegram or WhatsApp send the current family
policy does not permit. Every other tool — and non-egress actions such as
``list`` — passes through unchanged (return ``None``).

Verified caveat: in the installed Hermes, ``send_message`` is NOT a registered
model tool (cron/CLI/MCP call the transport engine directly, below the hook), so
this hook is defense-in-depth for any *registered* send_message-shaped model
tool. The confirmed direct-``telegram.Bot`` bypass is closed at the transport
layer by :mod:`.tool_transport`. Both doors share :mod:`.egress`.
"""

from __future__ import annotations

from typing import Any, Optional

from . import egress

# Outbound messaging tool names / aliases. A controlled allow-list, so a tool
# merely *named* like a sender but unrelated is never blocked by surprise.
SEND_TOOL_NAMES = frozenset({"send_message", "messages_send", "message_send"})
# Actions on those tools that actually egress to a chat. "list" (channel
# directory read) and anything unrecognized are non-egress -> pass through.
EGRESS_ACTIONS = frozenset({"send", "react", "unreact"})

_TARGET_KEYS = ("target",)
_PLATFORM_KEYS = ("platform", "channel_type", "family")
_CHAT_KEYS = ("chat_id", "to", "recipient", "channel", "chat")


def _resolve(args: dict) -> tuple[str, str]:
    """Best-effort (platform, chat_id) from a send tool's args. Prefers the
    packed ``target`` string; falls back to explicit platform/chat keys. Never
    trusts a pre-normalized value — everything is re-parsed here."""
    for key in _TARGET_KEYS:
        if args.get(key):
            return egress.parse_target(args[key])
    platform = ""
    for key in _PLATFORM_KEYS:
        if args.get(key):
            platform = str(args[key]).strip().lower()
            break
    chat = ""
    for key in _CHAT_KEYS:
        if args.get(key):
            chat = str(args[key]).strip()
            break
    # A bare "platform:chat" may still arrive packed under a platform key.
    if platform and not chat and ":" in platform:
        return egress.parse_target(platform)
    return platform, chat


def _get_home():
    from hermes_cli.config import get_hermes_home

    return get_hermes_home()


def pre_tool_call(*, tool_name: str = "", args: Any = None, **_kwargs) -> Optional[dict]:
    if tool_name not in SEND_TOOL_NAMES:
        return None
    args = args if isinstance(args, dict) else {}
    action = str(args.get("action", "send") or "send").strip().lower()
    if action not in EGRESS_ACTIONS:
        return None
    platform, chat_id = _resolve(args)
    if not egress.families.is_controlled(platform):
        # Not a business-controlled family (or an unparseable platform we cannot
        # attribute to WhatsApp/Telegram). The transport guard still sees the
        # resolved platform later; this hook governs only the two families.
        return None
    block = egress.decision(platform, chat_id, home_getter=_get_home)
    if block:
        return {"action": "block", "message": block}
    return None
