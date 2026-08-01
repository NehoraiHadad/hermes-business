"""register() fail-closed wiring: a send_message transport contract failure must
disable EVERY controlled Telegram/WhatsApp platform (telegram, whatsapp,
whatsapp_cloud) — not merely log — so a drifted/unguarded outbound transport can
never run beside live connectors. The pre_gateway_dispatch and pre_tool_call
hooks stay registered regardless. No network, no live Hermes.
"""

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
        # A registry seeded with all three controlled platforms + a bystander.
        self.registry = FakeRegistry()
        for name in ("telegram", "whatsapp", "whatsapp_cloud", "discord"):
            self.registry.register(FakePlatformEntry(name=name))
        self.patch_module(
            "gateway.platform_registry",
            SimpleNamespace(PlatformEntry=FakePlatformEntry, platform_registry=self.registry),
        )
        # Neutralize the adapter/telegram registry guards so this test isolates the
        # transport door: they no-op here.
        self._orig = (pkg.install_registry_guards, pkg.install_telegram_guards)
        pkg.install_registry_guards = lambda _h: None
        pkg.install_telegram_guards = lambda _h: None

    def tearDown(self):
        pkg.install_registry_guards, pkg.install_telegram_guards = self._orig
        super().tearDown()

    def test_transport_contract_failure_disables_all_controlled(self):
        # No tools.send_message_tool patched -> install_tool_guards raises the
        # contract error -> register() disables every controlled platform.
        self.patch_module("tools", SimpleNamespace())
        ctx = FakeCtx()
        pkg.register(ctx)
        for name in ("telegram", "whatsapp", "whatsapp_cloud"):
            self.assertIsNone(self.registry.get(name), f"{name} left enabled + unguarded")
        # An unrelated platform is never touched by this policy.
        self.assertIsNotNone(self.registry.get("discord"))
        # Both fail-closed hooks remain the enforcement points.
        self.assertIn(pkg.pre_gateway_dispatch, ctx.hooks.get("pre_gateway_dispatch", []))
        self.assertIn(pkg.pre_tool_call, ctx.hooks.get("pre_tool_call", []))

    def test_healthy_transport_keeps_platforms_registered(self):
        engine = types.ModuleType("tools.send_message_tool")

        async def _send_to_platform(platform, pconfig, chat_id, message, thread_id=None):
            return {"ok": True}

        async def _send_telegram(token, chat_id, message, media_files=None):
            return {"ok": True}

        engine._send_to_platform = _send_to_platform
        engine._send_telegram = _send_telegram
        self.patch_module("tools", SimpleNamespace(send_message_tool=engine))
        self.patch_module("tools.send_message_tool", engine)
        pkg.register(FakeCtx())
        for name in ("telegram", "whatsapp", "whatsapp_cloud", "discord"):
            self.assertIsNotNone(self.registry.get(name), f"{name} wrongly disabled")


if __name__ == "__main__":
    unittest.main(verbosity=2)
