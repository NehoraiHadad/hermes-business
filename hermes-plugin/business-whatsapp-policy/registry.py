"""Register guarded, fail-closed wrappers around Hermes' WhatsApp adapters.

Every outbound-capable surface is wrapped so it obeys the business reply
policy. If the installed registry/adapter signatures no longer match the
verified contract, the affected connection is *disabled* (its factory returns
no adapter) rather than left running unguarded.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any, Callable

from .transport import (
    AdapterContractError,
    _guard_standalone,
    guard_adapter,
    verify_platform_entry,
)

logger = logging.getLogger(__name__)


def cloud_configured(config: Any) -> bool:
    extra = getattr(config, "extra", {}) or {}
    return bool(extra.get("phone_number_id") and extra.get("access_token"))


def _guarded_factory(original_factory, platform, home_getter):
    """Wrap an adapter factory so the instance is guarded, and a contract
    violation disables the platform (returns ``None``) instead of yielding an
    unguarded adapter. ``platform_registry.create_adapter`` treats ``None`` as
    "platform unavailable"."""

    def factory(config):
        adapter = original_factory(config)
        if adapter is None:
            return None
        try:
            return guard_adapter(adapter, platform, home_getter)
        except AdapterContractError:
            logger.error(
                "business-whatsapp-policy: %s adapter surface failed the safety "
                "contract; DISABLING the connection (no unguarded adapter served).",
                platform,
                exc_info=True,
            )
            return None

    return factory


def _blocked_factory(platform, reason):
    """Factory that always disables a platform we could not verify."""

    def factory(_config):
        logger.error(
            "business-whatsapp-policy: %s disabled (%s); refusing to serve an "
            "unguarded adapter.",
            platform,
            reason,
        )
        return None

    return factory


def _guard_native(home_getter: Callable[[], Any]) -> None:
    from gateway.platform_registry import platform_registry

    whatsapp = platform_registry.get("whatsapp")
    if whatsapp is None:
        # Native Baileys not registered (e.g. Cloud-only install). Nothing to
        # guard; the pre_gateway_dispatch hook still enforces read-only.
        return
    # Fail closed if the entry no longer carries the fields we wrap.
    verify_platform_entry(whatsapp)
    platform_registry.register(
        replace(
            whatsapp,
            adapter_factory=_guarded_factory(
                whatsapp.adapter_factory, "whatsapp", home_getter
            ),
            standalone_sender_fn=_guard_standalone(
                whatsapp.standalone_sender_fn, home_getter
            ),
        )
    )


def _guard_cloud(home_getter: Callable[[], Any]) -> None:
    from gateway.platform_registry import PlatformEntry, platform_registry

    existing_cloud = platform_registry.get("whatsapp_cloud")
    cloud_standalone = _guard_standalone(
        getattr(existing_cloud, "standalone_sender_fn", None), home_getter
    )

    try:
        from gateway.platforms.whatsapp_cloud import (
            WhatsAppCloudAdapter,
            check_whatsapp_cloud_requirements,
        )

        adapter_factory = _guarded_factory(
            lambda config: WhatsAppCloudAdapter(config), "whatsapp_cloud", home_getter
        )
    except Exception as exc:  # noqa: BLE001 - unknown Cloud surface -> fail closed
        # We could not import/verify the Cloud adapter. Register a DISABLED
        # entry so a dependency being present cannot auto-enable an unguarded
        # Cloud adapter through some other path.
        logger.error(
            "business-whatsapp-policy: WhatsApp Cloud adapter unavailable/unknown "
            "(%s); registering it as disabled.",
            exc,
        )
        adapter_factory = _blocked_factory("whatsapp_cloud", "adapter unverified")
        check_whatsapp_cloud_requirements = lambda: True  # noqa: E731

    platform_registry.register(
        PlatformEntry(
            name="whatsapp_cloud",
            label="WhatsApp Business Cloud",
            adapter_factory=adapter_factory,
            standalone_sender_fn=cloud_standalone,
            check_fn=check_whatsapp_cloud_requirements,
            validate_config=cloud_configured,
            is_connected=cloud_configured,
            required_env=[
                "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
                "WHATSAPP_CLOUD_ACCESS_TOKEN",
            ],
            allowed_users_env="WHATSAPP_CLOUD_ALLOWED_USERS",
            allow_all_env="WHATSAPP_CLOUD_ALLOW_ALL_USERS",
            cron_deliver_env_var="WHATSAPP_CLOUD_HOME_CHANNEL",
            max_message_length=4096,
            pii_safe=True,
            # Wraps a Hermes core adapter. "builtin" prevents dependency
            # presence alone from auto-enabling an unconfigured Cloud adapter.
            source="builtin",
            plugin_name="business-whatsapp-policy",
        )
    )


def install_registry_guards(home_getter: Callable[[], Any]) -> None:
    """Install fail-closed guards for both WhatsApp adapter families.

    Raises on an unverifiable registry/platform surface so the caller can
    decide how loudly to fail; the native/Cloud factories themselves disable
    their connections on a per-adapter contract violation.
    """
    _guard_native(home_getter)
    _guard_cloud(home_getter)
