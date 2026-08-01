"""Shared stdlib-only fixtures for the WhatsApp policy plugin tests."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

# Fakes live in their own module; re-exported here so existing tests keep
# importing them from `support`.
from fakes import (  # noqa: F401
    FakeAdapter,
    FakeCloudAdapter,
    FakePlatformEntry,
    FakeRegistry,
    FakeSendResult,
    Store,
)

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


def _write_policy(home: Path, filename: str, mode: str, chats: list) -> None:
    business = home / "business"
    business.mkdir(parents=True, exist_ok=True)
    (business / filename).write_text(
        json.dumps({"version": 1, "mode": mode, "reply_chats": chats}),
        encoding="utf-8",
    )


def write_policy(home: Path, mode: str, chats: list) -> None:
    _write_policy(home, "whatsapp-policy.json", mode, chats)


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
