"""The verified WhatsApp adapter *contract*: what surface this plugin guards,
and the fail-closed checks that refuse to run when the live surface drifts.

Verified against the installed source at Hermes 0.19.1:

  * Native / Baileys ("whatsapp"): bundled platform plugin
    ``plugins/platforms/whatsapp/adapter.py`` -> ``WhatsAppAdapter``. Every
    outbound method takes ``chat_id`` first. Base convenience senders delegate
    to overridden primitives, so guarding the primitives covers the surface.
  * Cloud ("whatsapp_cloud"): ``gateway/platforms/whatsapp_cloud.py`` ->
    ``WhatsAppCloudAdapter``. Native interactive taps are authorized *before*
    the gateway dispatch hook via ``_is_interactive_sender_authorized``.

Method selection is *contract-driven* (not a fragile mutating-prefix denylist):
a guarded method runs only when the reply policy authorizes the resolved chat,
and an unrecognized/drifted surface HARD-FAILS the connection instead of
running unguarded.
"""

from __future__ import annotations

from typing import Any

# ─────────────────────────── version + surface contract ────────────────────

# Hermes releases whose adapter surface this contract was verified against.
# Single-sourced with the canonical compat manifest (hermes-compat.json); the
# JS drift test asserts these stay in lockstep with the renderer/electron range.
SUPPORTED_HERMES_VERSIONS = frozenset({"0.19.1"})
SUPPORTED_VERSION_PREFIXES = ("0.19.",)

# Each WhatsApp platform name maps to exactly one adapter "family". An
# unrecognized name is treated as unknown -> fail closed.
PLATFORM_FAMILY = {
    "whatsapp": "baileys",
    "whatsapp_cloud": "cloud",
}

# Resolves native interactive (button/list) taps ahead of the gateway dispatch
# hook. Routed through the reply policy so a stale approval button cannot bypass
# read-only mode.
INTERACTIVE_AUTH_METHOD = "_is_interactive_sender_authorized"

# Outbound / mutating methods to policy-gate. Wrapping can only make a method
# *more* restrictive: if a chat target cannot be resolved the guard blocks
# (fail closed), so listing a base convenience method here is safe defense-in-
# depth even when it merely delegates to a primitive.
_COMMON_OUTBOUND = frozenset(
    {
        # Base primitives every convenience sender funnels through.
        "send",
        "edit_message",
        "delete_message",
        "send_typing",
        "stop_typing",
        # Base convenience senders (guarded directly as defense-in-depth).
        "send_image",
        "send_image_file",
        "send_video",
        "send_voice",
        "send_document",
        "send_animation",
        "send_multiple_images",
        "send_private_notice",
        "send_draft",
        "send_clarify",
    }
)

# Family-specific outbound methods (public and the private network sinks reached
# only through public callers -- guarded anyway so a future direct caller cannot
# bypass the policy).
OUTBOUND_METHODS = {
    "baileys": _COMMON_OUTBOUND
    | {
        "send_poll",
        "send_location",
        "_send_media_to_bridge",
        "_send_read_receipt",
        # Retained for the sync-guard regression fixture / any future delete API.
        "delete",
    },
    "cloud": _COMMON_OUTBOUND
    | {
        "send_exec_approval",
        "send_slash_confirm",
        "_post_interactive",
        "_send_media",
        "_send_media_from_path_or_link",
    },
}

# A concrete adapter MUST expose these or the surface has drifted beyond what we
# can guard -> fail closed.
REQUIRED_METHODS = {
    "baileys": frozenset({"send", "send_typing"}),
    "cloud": frozenset({"send", "send_typing", INTERACTIVE_AUTH_METHOD}),
}

# Public method-name prefixes that denote an outbound surface for the drift
# tripwire. A public method that looks outbound but is not in OUTBOUND_METHODS
# means the adapter grew a new sender we do not guard -> fail closed. Private
# helpers ("_...") are exempt: plumbing reached only through guarded callers.
_OUTBOUND_NAME_PREFIXES = (
    "send",
    "edit",
    "delete",
    "post",
    "broadcast",
    "forward",
    "react",
    "reply",
)

# PlatformEntry fields the registry guard depends on. If the installed dataclass
# no longer carries these, our wrapping is built on sand -> fail closed.
REQUIRED_PLATFORM_ENTRY_FIELDS = frozenset(
    {
        "name",
        "label",
        "adapter_factory",
        "check_fn",
        "validate_config",
        "is_connected",
        "standalone_sender_fn",
        "source",
        "plugin_name",
    }
)


class AdapterContractError(RuntimeError):
    """Raised when the live WhatsApp surface no longer matches the verified
    contract. Callers must treat this as fail-closed: disable the connection,
    never log-and-continue."""


def platform_family(platform: Any) -> str | None:
    return PLATFORM_FAMILY.get(str(platform or "").strip().lower())


def is_supported_version(version: Any) -> bool:
    text = str(version or "").strip()
    if text in SUPPORTED_HERMES_VERSIONS:
        return True
    return any(text.startswith(prefix) for prefix in SUPPORTED_VERSION_PREFIXES)
