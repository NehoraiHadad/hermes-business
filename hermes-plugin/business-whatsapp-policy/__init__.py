"""Hermes hooks for passive WhatsApp intake and guarded outbound delivery."""

from __future__ import annotations

import logging

from .ingest import ingest_without_reply
from .policy import PLATFORMS, can_reply, load_policy
from .registry import install_registry_guards
from .transport import AdapterContractError

logger = logging.getLogger(__name__)


def _platform_value(source) -> str:
    value = getattr(source, "platform", "")
    return str(getattr(value, "value", value) or "").lower()


def pre_gateway_dispatch(*, event=None, session_store=None, **_kwargs):
    source = getattr(event, "source", None)
    if source is None or _platform_value(source) not in PLATFORMS:
        return None

    try:
        from hermes_cli.config import get_hermes_home

        policy = load_policy(get_hermes_home())
        chat_id = getattr(source, "chat_id", "")
        chat_type = str(getattr(source, "chat_type", "") or "").lower()
        is_group = chat_type == "group" or str(chat_id).lower().endswith("@g.us")
        identifiers = (
            (chat_id,)
            if is_group
            else (
                chat_id,
                getattr(source, "user_id", ""),
                getattr(source, "user_id_alt", ""),
            )
        )
        if can_reply(policy, *identifiers):
            return {"action": "allow"}
    except Exception:
        logger.exception("WhatsApp policy evaluation failed; dispatch remains blocked")

    # Persistence is best-effort, but silence is not: a storage failure must
    # never turn a read-only message into a normal agent dispatch.
    try:
        ingest_without_reply(event, session_store)
    except Exception:
        logger.exception("Passive WhatsApp ingest failed; dispatch remains blocked")
    return {"action": "skip", "reason": "business_whatsapp_read_only"}


def _disable_whatsapp_platforms(reason: str) -> None:
    """Best-effort fail-closed fallback: if we could not install guards, unregister
    the WhatsApp platforms so no *unguarded* adapter can connect. Prefer a
    disabled WhatsApp connection over one that could send without policy."""
    try:
        from gateway.platform_registry import platform_registry
    except Exception:
        # No registry to disable against (e.g. CLI-only context). The
        # pre_gateway_dispatch hook remains the enforcement point.
        return
    for name in ("whatsapp", "whatsapp_cloud"):
        try:
            if platform_registry.unregister(name):
                logger.error(
                    "business-whatsapp-policy: disabled platform %s (%s).",
                    name,
                    reason,
                )
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to disable WhatsApp platform %s", name)


def register(ctx) -> None:
    from hermes_cli.config import get_hermes_home

    # Register the fail-closed dispatch hook FIRST. It is the primary
    # enforcement point: if it is not registered, WhatsApp messages would
    # dispatch normally and the agent could reply. The transport guards are
    # defense-in-depth for standalone/scheduled and interactive-tap sends.
    ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    try:
        install_registry_guards(get_hermes_home)
    except AdapterContractError as exc:
        # The registry/adapter surface no longer matches what we verified. Do
        # NOT log-and-continue: disable the WhatsApp connection so nothing sends
        # unguarded. The hook still blocks the dispatch path either way.
        logger.error(
            "business-whatsapp-policy: WhatsApp safety contract failed (%s); "
            "disabling the WhatsApp connection.",
            exc,
        )
        _disable_whatsapp_platforms("safety contract failed")
    except Exception as exc:  # pragma: no cover - depends on gateway internals
        # An unexpected error installing guards leaves standalone/interactive
        # outbound paths unverified. A safety plugin fails closed: disable the
        # platforms rather than serve them unguarded.
        logger.error(
            "business-whatsapp-policy: transport guards not installed (%s); "
            "disabling the WhatsApp connection as a fail-closed fallback.",
            exc,
        )
        _disable_whatsapp_platforms("guard install failed")
