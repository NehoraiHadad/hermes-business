"""Hermes hooks for the business *messaging* reply policy: passive intake and
guarded outbound for both the WhatsApp and Telegram families.

One fail-closed engine (:mod:`.guard_core` / :mod:`.surface_core` /
:mod:`.dispatch`) serves every family. The ``pre_gateway_dispatch`` hook routes
each inbound message to its family handler (read-only ingests and skips; only an
explicitly authorized target is allowed), and :func:`register` installs the
transport guards for whichever adapters the installed Hermes exposes.

The package id stays ``business-whatsapp-policy`` for install/migration
compatibility; it is now the general business messaging-policy engine.
"""

from __future__ import annotations

import logging

from .dispatch import platform_value, read_only_dispatch, reply_identifiers
from .ingest import TELEGRAM_PLACEHOLDER, WHATSAPP_PLACEHOLDER
from .policy import PLATFORMS as WHATSAPP_PLATFORMS
from .policy import can_reply as wa_can_reply
from .policy import load_policy as wa_load_policy
from .registry import install_registry_guards
from .telegram_policy import PLATFORMS as TELEGRAM_PLATFORMS
from .telegram_policy import can_reply as tg_can_reply
from .telegram_policy import load_policy as tg_load_policy
from .telegram_registry import install_telegram_guards
from .tool_hook import pre_tool_call
from .tool_transport import install_tool_guards
from .transport import AdapterContractError

logger = logging.getLogger(__name__)

_WHATSAPP_GROUP_TYPES = {"group"}
# Telegram normalizes raw chat types to dm/group/forum/channel; everything that
# is not a dm is authorized by the CHAT id, never an individual sender.
_TELEGRAM_GROUP_TYPES = {"group", "forum", "channel"}


def _wa_is_group(source) -> bool:
    chat_type = str(getattr(source, "chat_type", "") or "").lower()
    chat_id = str(getattr(source, "chat_id", "") or "").lower()
    return chat_type in _WHATSAPP_GROUP_TYPES or chat_id.endswith("@g.us")


def _tg_is_group(source) -> bool:
    return str(getattr(source, "chat_type", "") or "").lower() in _TELEGRAM_GROUP_TYPES


def _dispatch(event, session_store, *, load_policy, can_reply, is_group, reason, placeholder):
    source = event.source
    try:
        from hermes_cli.config import get_hermes_home

        policy = load_policy(get_hermes_home())
        authorized = can_reply(policy, *reply_identifiers(source, is_group(source)))
    except Exception:
        # A policy-resolution failure must never open the connection.
        logger.exception("Messaging policy evaluation failed; dispatch remains blocked")
        authorized = False
    return read_only_dispatch(
        event, session_store, authorized=authorized, reason=reason, placeholder=placeholder
    )


def pre_gateway_dispatch(*, event=None, session_store=None, **_kwargs):
    source = getattr(event, "source", None)
    if source is None:
        return None
    platform = platform_value(source)
    if platform in WHATSAPP_PLATFORMS:
        return _dispatch(
            event,
            session_store,
            load_policy=wa_load_policy,
            can_reply=wa_can_reply,
            is_group=_wa_is_group,
            reason="business_whatsapp_read_only",
            placeholder=WHATSAPP_PLACEHOLDER,
        )
    if platform in TELEGRAM_PLATFORMS:
        return _dispatch(
            event,
            session_store,
            load_policy=tg_load_policy,
            can_reply=tg_can_reply,
            is_group=_tg_is_group,
            reason="business_telegram_read_only",
            placeholder=TELEGRAM_PLACEHOLDER,
        )
    return None


def _disable_platforms(names, reason: str) -> None:
    """Best-effort fail-closed fallback: if we could not install guards, unregister
    the platform(s) so no *unguarded* adapter can connect."""
    try:
        from gateway.platform_registry import platform_registry
    except Exception:
        # No registry to disable against (e.g. CLI-only context). The
        # pre_gateway_dispatch hook remains the enforcement point.
        return
    for name in names:
        try:
            if platform_registry.unregister(name):
                logger.error(
                    "business messaging policy: disabled platform %s (%s).", name, reason
                )
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to disable platform %s", name)


def _install_guards(label, installer, home_getter, disable_names) -> None:
    try:
        installer(home_getter)
    except AdapterContractError as exc:
        logger.error(
            "business messaging policy: %s safety contract failed (%s); "
            "disabling the connection.",
            label,
            exc,
        )
        _disable_platforms(disable_names, "safety contract failed")
    except Exception as exc:  # pragma: no cover - depends on gateway internals
        logger.error(
            "business messaging policy: %s transport guards not installed (%s); "
            "disabling the connection as a fail-closed fallback.",
            label,
            exc,
        )
        _disable_platforms(disable_names, "guard install failed")


def register(ctx) -> None:
    from hermes_cli.config import get_hermes_home

    # The fail-closed dispatch hook is the PRIMARY enforcement point for both
    # families: without it, messages would dispatch normally and the agent could
    # reply. The transport guards are defense-in-depth for standalone/scheduled
    # and interactive-tap sends. Each family disables independently so a drift in
    # one never silently disarms the other.
    ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    # Tool-level fail-closed guard for outbound messaging tools. Defense-in-depth
    # for any registered send_message-shaped model tool (send_message itself is
    # NOT a registered model tool in the verified Hermes — see tool_hook).
    ctx.register_hook("pre_tool_call", pre_tool_call)
    _install_guards(
        "WhatsApp", install_registry_guards, get_hermes_home, ("whatsapp", "whatsapp_cloud")
    )
    _install_guards("Telegram", install_telegram_guards, get_hermes_home, ("telegram",))
    # Close the confirmed direct-`telegram.Bot` egress bypass at the transport
    # engine shared by cron / CLI / MCP, via the SAME fail-closed path as the
    # adapter guards: a raised transport contract error (engine unimportable,
    # chokepoint drift, partial/failed bind) disables EVERY controlled platform
    # rather than leave a live-but-unguarded transport. Plugin load continues
    # (the pre_gateway_dispatch + pre_tool_call hooks above stay registered).
    _install_guards(
        "send_message transport",
        install_tool_guards,
        get_hermes_home,
        ("telegram", "whatsapp", "whatsapp_cloud"),
    )
    # AFTER the guards are installed, publish a LIVE runtime status heartbeat FROM this
    # dispatch process. It introspects the just-bound transport + registered hooks and
    # only reports enforcing when they are actually live here (see guard_status). The
    # desktop reader liveness-verifies it (fresh + live pid + gateway role) and otherwise
    # shows BLOCKED — a serve-process route could not prove gateway enforcement, and a
    # static file receipt is insufficient, so this dispatch-process heartbeat is the proof.
    try:
        from . import guard_status

        guard_status.start(get_hermes_home, declared_hooks=("pre_gateway_dispatch", "pre_tool_call"))
    except Exception:  # pragma: no cover - status must never break enforcement
        logger.exception("business messaging policy: guard-status heartbeat did not start")
