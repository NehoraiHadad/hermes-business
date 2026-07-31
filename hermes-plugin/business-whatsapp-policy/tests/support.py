"""Shared stdlib-only fixtures for the WhatsApp policy plugin tests."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

PLUGIN_DIR = Path(__file__).resolve().parent.parent
PACKAGE = "business_whatsapp_policy"


def load_plugin_package() -> None:
    if PACKAGE in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(
        PACKAGE,
        PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)


load_plugin_package()


def write_policy(home: Path, mode: str, chats: list) -> None:
    business = home / "business"
    business.mkdir(parents=True, exist_ok=True)
    (business / "whatsapp-policy.json").write_text(
        json.dumps({"version": 1, "mode": mode, "reply_chats": chats}),
        encoding="utf-8",
    )


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


class FakeCloudAdapter:
    def __init__(self, config):
        self.config = config


class TempHomeCase:
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self._saved_modules = {}

    def tearDown(self):
        for name, value in self._saved_modules.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value
        self._tmp.cleanup()

    def patch_module(self, name, module):
        self._saved_modules.setdefault(name, sys.modules.get(name))
        sys.modules[name] = module

    def install_fake_send_result(self):
        self.patch_module("gateway", SimpleNamespace())
        self.patch_module("gateway.platforms", SimpleNamespace())
        self.patch_module(
            "gateway.platforms.base", SimpleNamespace(SendResult=FakeSendResult)
        )

    def patch_home(self):
        config = SimpleNamespace(get_hermes_home=lambda: self.home)
        self.patch_module("hermes_cli", SimpleNamespace(config=config))
        self.patch_module("hermes_cli.config", config)

    def install_fake_registry(self, whatsapp_entry=None, cloud_entry=None):
        """Patch the gateway platform-registry modules the plugin imports and
        return a FakeRegistry seeded with the given native/cloud entries."""
        registry = FakeRegistry()
        if whatsapp_entry is not None:
            registry.register(whatsapp_entry)
        if cloud_entry is not None:
            registry.register(cloud_entry)
        self.install_fake_send_result()
        self.patch_module(
            "gateway.platform_registry",
            SimpleNamespace(PlatformEntry=FakePlatformEntry, platform_registry=registry),
        )
        self.patch_module(
            "gateway.platforms.whatsapp_cloud",
            SimpleNamespace(
                WhatsAppCloudAdapter=FakeCloudAdapter,
                check_whatsapp_cloud_requirements=lambda: True,
            ),
        )
        return registry
