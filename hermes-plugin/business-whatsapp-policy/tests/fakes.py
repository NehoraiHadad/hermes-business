"""Pure-stdlib fakes for the WhatsApp policy plugin tests.

Stand-ins for the gateway objects the plugin talks to (store, adapters,
platform registry). Kept in their own module so tests/support.py stays a thin
harness and neither file grows without bound.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace


class Store:
    def __init__(self):
        self.messages = []
        self.seen_ids = set()

    def get_or_create_session(self, _source):
        return SimpleNamespace(session_id="session-1")

    def has_platform_message_id(self, _session_id, message_id):
        return message_id in self.seen_ids

    def load_transcript(self, _session_id):
        return list(self.messages)

    def append_to_transcript(self, _session_id, message):
        self.messages.append(message)
        if message.get("message_id"):
            self.seen_ids.add(message["message_id"])


@dataclass
class FakeSendResult:
    success: bool = True
    error: str = ""


class FakeAdapter:
    def __init__(self):
        self.sent = []
        self.typed = []
        self.deleted = []

    async def send(self, chat_id, content, **_kwargs):
        self.sent.append((chat_id, content))
        return FakeSendResult(success=True)

    async def send_typing(self, chat_id, metadata=None):
        self.typed.append(chat_id)

    async def _send_read_receipt(self, data):
        self.typed.append(data.get("chatId"))

    # A *synchronous* mutating method — must fail closed exactly like the async
    # ones. "delete" is in the mutating prefixes and blocks to False.
    def delete(self, chat_id, **_kwargs):
        self.deleted.append(chat_id)
        return True

    def _is_interactive_sender_authorized(self, _sender_id):
        return True


@dataclass
class FakePlatformEntry:
    """Mirror of gateway.platform_registry.PlatformEntry — enough fields for the
    plugin's install_registry_guards to build/replace entries via dataclasses."""

    name: str = ""
    label: str = ""
    adapter_factory: object = None
    standalone_sender_fn: object = None
    check_fn: object = None
    validate_config: object = None
    is_connected: object = None
    required_env: object = None
    allowed_users_env: object = None
    allow_all_env: object = None
    cron_deliver_env_var: object = None
    max_message_length: int = 0
    pii_safe: bool = False
    source: str = ""
    plugin_name: str = ""


class FakeRegistry:
    def __init__(self):
        self.entries = {}

    def get(self, name):
        return self.entries.get(name)

    def register(self, entry):
        self.entries[entry.name] = entry

    def unregister(self, name):
        """Mirror gateway.platform_registry.unregister: drop the entry and report
        whether one was actually removed (the plugin's fail-closed disable path)."""
        return self.entries.pop(name, None) is not None


class FakeCloudAdapter:
    def __init__(self, config):
        self.config = config
