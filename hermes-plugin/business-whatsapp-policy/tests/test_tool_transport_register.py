"""register() disables only WhatsApp when its transport contract drifts."""

import types
import unittest
from types import SimpleNamespace

from support import TempHomeCase
from fakes import FakePlatformEntry, FakeRegistry
import business_whatsapp_policy as pkg


class FakeCtx:
    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, fn):
        self.hooks.setdefault(name, []).append(fn)


class RegisterFailClosed(TempHomeCase, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.patch_home()
        self.registry = FakeRegistry()
        for name in ("telegram", "whatsapp", "whatsapp_cloud", "discord"):
            self.registry.register(FakePlatformEntry(name=name))
        self.patch_module(
            "gateway.platform_registry",
            SimpleNamespace(PlatformEntry=FakePlatformEntry, platform_registry=self.registry),
        )
        self.original_registry_guard = pkg.install_registry_guards
        pkg.install_registry_guards = lambda _home: None

    def tearDown(self):
        pkg.install_registry_guards = self.original_registry_guard
        super().tearDown()

    def test_failure_disables_only_whatsapp(self):
        self.patch_module("tools", SimpleNamespace())
        ctx = FakeCtx()
        pkg.register(ctx)
        self.assertIsNone(self.registry.get("whatsapp"))
        self.assertIsNone(self.registry.get("whatsapp_cloud"))
        self.assertIsNotNone(self.registry.get("telegram"))
        self.assertIsNotNone(self.registry.get("discord"))
        self.assertIn(pkg.pre_gateway_dispatch, ctx.hooks["pre_gateway_dispatch"])

    def test_healthy_transport_keeps_every_platform(self):
        engine = types.ModuleType("tools.send_message_tool")

        async def send(platform, pconfig, chat_id, message, thread_id=None):
            return {"ok": True}

        engine._send_to_platform = send
        self.patch_module("tools", SimpleNamespace(send_message_tool=engine))
        self.patch_module("tools.send_message_tool", engine)
        pkg.register(FakeCtx())
        for name in ("telegram", "whatsapp", "whatsapp_cloud", "discord"):
            self.assertIsNotNone(self.registry.get(name))


if __name__ == "__main__":
    unittest.main(verbosity=2)
