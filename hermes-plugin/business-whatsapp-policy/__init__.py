"""Hermes hooks for the business WhatsApp reply policy.

Telegram is deliberately not intercepted: a dedicated Telegram bot uses the
native Hermes access and reply behavior. This plugin exists only for WhatsApp,
where connecting an account exposes pre-existing conversations and therefore
needs an optional read-only/selected-chat boundary.
"""

from __future__ import annotations

import logging

from .dispatch import platform_value, read_only_dispatch, reply_identifiers
from .ingest import WHATSAPP_PLACEHOLDER
from .policy import PLATFORMS, can_process, load_policy
from .registry import install_registry_guards
from .tool_hook import pre_tool_call
from .tool_transport import install_tool_guards
from .transport import AdapterContractError

logger = logging.getLogger(__name__)


def _is_group(source) -> bool:
    chat_type = str(getattr(source, "chat_type", "") or "").lower()
    chat_id = str(getattr(source, "chat_id", "") or "").lower()
    return chat_type == "group" or chat_id.endswith("@g.us")


def pre_gateway_dispatch(*, event=None, session_store=None, **_kwargs):
    source = getattr(event, "source", None)
    if source is None or platform_value(source) not in PLATFORMS:
        return None
    try:
        from hermes_cli.config import get_hermes_home

        policy = load_policy(get_hermes_home())
        authorized = can_process(
            policy,
            *reply_identifiers(source, _is_group(source)),
            platform=platform_value(source),
        )
    except Exception:
        logger.exception("WhatsApp policy evaluation failed; dispatch remains blocked")
        authorized = False
    return read_only_dispatch(
        event,
        session_store,
        authorized=authorized,
        reason="business_whatsapp_read_only",
        placeholder=WHATSAPP_PLACEHOLDER,
    )


def _disable_platforms(reason: str) -> None:
    try:
        from gateway.platform_registry import platform_registry
    except Exception:
        return
    for name in ("whatsapp", "whatsapp_cloud"):
        try:
            platform_registry.unregister(name)
        except Exception:
            logger.exception("Failed to disable platform %s (%s)", name, reason)


def _install(label, installer, home_getter) -> None:
    try:
        installer(home_getter)
    except Exception as exc:
        logger.error("WhatsApp %s guard failed (%s); disabling connection", label, exc)
        _disable_platforms("guard install failed")


def register(ctx) -> None:
    from hermes_cli.config import get_hermes_home

    ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    ctx.register_hook("pre_tool_call", pre_tool_call)
    _install("adapter", install_registry_guards, get_hermes_home)
    _install("send-message", install_tool_guards, get_hermes_home)
    try:
        from . import guard_status

        guard_status.start(get_hermes_home, declared_hooks=("pre_gateway_dispatch", "pre_tool_call"))
    except Exception:
        logger.exception("WhatsApp guard-status heartbeat did not start")
