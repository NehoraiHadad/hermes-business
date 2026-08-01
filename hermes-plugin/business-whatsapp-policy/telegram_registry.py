"""Register fail-closed guards around Hermes' Telegram adapter.

The Telegram adapter registers itself via ``ctx.register_platform(name="telegram",
...)``; the stored row is a ``gateway.platform_registry.PlatformEntry``. We
``replace`` that row so every served adapter instance is policy-guarded and the
out-of-process standalone sender (cron/scheduled delivery) obeys the same reply
policy. A per-adapter contract violation DISABLES the connection (factory returns
``None``) instead of serving an unguarded adapter.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any, Callable

from .telegram_transport import (
    AdapterContractError,
    guard_adapter,
    guard_standalone_sender,
    verify_platform_entry,
)

logger = logging.getLogger(__name__)


def _guarded_factory(original_factory, home_getter):
    """Wrap an adapter factory so the instance is guarded, and a contract
    violation disables the platform (returns ``None``) instead of yielding an
    unguarded adapter."""

    def factory(config):
        adapter = original_factory(config)
        if adapter is None:
            return None
        try:
            return guard_adapter(adapter, home_getter)
        except AdapterContractError:
            logger.error(
                "business messaging policy: telegram adapter surface failed the "
                "safety contract; DISABLING the connection (no unguarded adapter served).",
                exc_info=True,
            )
            return None

    return factory


def install_telegram_guards(home_getter: Callable[[], Any]) -> None:
    """Install fail-closed guards for the Telegram adapter family.

    Raises :class:`AdapterContractError` on an unverifiable ``PlatformEntry`` so
    the caller disables the connection; the per-adapter factory itself disables
    on an adapter-surface contract violation."""
    from gateway.platform_registry import platform_registry

    telegram = platform_registry.get("telegram")
    if telegram is None:
        # Telegram not registered (dependency absent / not installed). Nothing to
        # guard; the pre_gateway_dispatch hook still enforces read-only.
        return
    verify_platform_entry(telegram)
    platform_registry.register(
        replace(
            telegram,
            adapter_factory=_guarded_factory(telegram.adapter_factory, home_getter),
            standalone_sender_fn=guard_standalone_sender(
                telegram.standalone_sender_fn, home_getter
            ),
        )
    )
