"""The verified Telegram adapter *contract* (Hermes 0.19.1): the outbound surface
this plugin guards and the fail-closed checks that refuse to run when the live
surface drifts.

Verified against the installed source ``plugins/platforms/telegram/adapter.py``
-> ``TelegramAdapter(BasePlatformAdapter)``. Every outbound method takes
``chat_id`` (or ``parent_chat_id``) first, so guarding the primitives covers the
surface. Registration is via ``ctx.register_platform(name="telegram", ...)``; the
stored registry row is ``gateway.platform_registry.PlatformEntry``. Inline-button
taps are authorized by ``_is_callback_user_authorized`` (fail-closed in Hermes),
which we additionally route through our reply policy so a stale button cannot
bypass read-only. The version policy + error type are shared with the WhatsApp
contract (same installed Hermes).
"""

from __future__ import annotations

from .contract import AdapterContractError, is_supported_version  # noqa: F401 (re-exported)

PLATFORM = "telegram"
FAMILY = "telegram"

# Inline-button callback authorizer. Signature:
#   _is_callback_user_authorized(user_id, *, chat_id=, chat_type=, thread_id=, user_name=)
INTERACTIVE_AUTH_METHOD = "_is_callback_user_authorized"

# Outbound / mutating methods to policy-gate. All take chat_id (or
# parent_chat_id) first. The topic mutators (create/ensure/rename forum & DM
# topics) touch Telegram state and are chat_id-keyed, so they are gated too;
# blocked calls return None, which their callers already treat as "unavailable".
OUTBOUND_METHODS = frozenset(
    {
        "send",
        "edit_message",
        "delete_message",
        "send_typing",
        "send_draft",
        "send_update_prompt",
        "send_exec_approval",
        "send_slash_confirm",
        "send_clarify",
        "send_model_picker",
        "send_choice_picker",
        "send_voice",
        "send_multiple_images",
        "send_image_file",
        "send_document",
        "send_video",
        "send_image",
        "send_animation",
        "send_private_notice",
        "send_or_update_status",
        "create_handoff_thread",
        "ensure_dm_topic",
        "rename_dm_topic",
    }
)

# A concrete adapter MUST expose these or the surface has drifted beyond what we
# can guard -> fail closed.
REQUIRED_METHODS = frozenset({"send", "send_typing"})

# Public prefixes that denote an outbound surface for the drift tripwire. NOTE:
# Telegram's ``set_*`` methods are handler injectors, NOT senders, so "set" is
# deliberately excluded. A new public sender not in OUTBOUND_METHODS -> fail
# closed. Private helpers ("_...") are exempt (plumbing reached via guarded
# callers).
OUTBOUND_NAME_PREFIXES = (
    "send",
    "edit",
    "delete",
    "post",
    "broadcast",
    "forward",
    "react",
    "reply",
)

# Base classes whose methods are stable/known — excluded from the drift tripwire
# (TelegramAdapter -> BasePlatformAdapter -> ABC -> object).
SKIP_BASES = frozenset({"BasePlatformAdapter", "ABC"})

# Registry (PlatformEntry) fields the Telegram guard reads/wraps. Fail closed if
# the installed dataclass no longer carries them.
REQUIRED_PLATFORM_ENTRY_FIELDS = frozenset(
    {
        "name",
        "label",
        "adapter_factory",
        "check_fn",
        "is_connected",
        "standalone_sender_fn",
        "allowed_users_env",
        "allow_all_env",
    }
)
