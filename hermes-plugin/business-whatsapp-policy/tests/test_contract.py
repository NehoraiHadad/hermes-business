"""Fail-closed contract tests: the guard must disable, not degrade, on drift."""

import asyncio
import unittest
from types import SimpleNamespace

from support import TempHomeCase, write_policy

from business_whatsapp_policy.registry import _guarded_factory
from business_whatsapp_policy.transport import (
    INTERACTIVE_AUTH_METHOD,
    OUTBOUND_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    AdapterContractError,
    guard_adapter,
    is_supported_version,
    platform_family,
    verify_adapter_surface,
    verify_platform_entry,
)


class Conforming:
    """A minimal adapter whose public surface matches the baileys contract."""

    async def send(self, chat_id, content, **_kw):
        return True

    async def send_typing(self, chat_id, metadata=None):
        return None

    # A benign, non-outbound public helper must NOT trip the drift tripwire.
    def get_chat_info(self, chat_id):
        return {}

    # A private helper is internal plumbing -> exempt from the tripwire.
    def _internal_send_helper(self, chat_id):
        return None


class Drifted(Conforming):
    async def send_broadcast(self, chat_id, content):  # new, unguarded outbound
        return True


class ContractTripwire(unittest.TestCase):
    def test_platform_family_and_version(self):
        self.assertEqual(platform_family("whatsapp"), "baileys")
        self.assertEqual(platform_family("WHATSAPP_CLOUD"), "cloud")
        self.assertIsNone(platform_family("telegram"))
        self.assertTrue(is_supported_version("0.19.1"))
        self.assertTrue(is_supported_version("0.19.4"))
        self.assertFalse(is_supported_version("0.20.0"))

    def test_conforming_surface_passes(self):
        verify_adapter_surface(Conforming(), "baileys")  # must not raise

    def test_unknown_family_fails_closed(self):
        with self.assertRaises(AdapterContractError):
            verify_adapter_surface(Conforming(), "signal")

    def test_missing_required_method_fails_closed(self):
        class NoSend:
            async def send_typing(self, chat_id, metadata=None):
                return None

        with self.assertRaises(AdapterContractError):
            verify_adapter_surface(NoSend(), "baileys")

    def test_new_outbound_method_fails_closed(self):
        # The whole point of default-deny: an unrecognized *outbound* surface
        # disables the connection instead of silently going unguarded.
        with self.assertRaises(AdapterContractError):
            verify_adapter_surface(Drifted(), "baileys")

    def test_guard_adapter_rejects_unknown_platform(self):
        with self.assertRaises(AdapterContractError):
            guard_adapter(Conforming(), "telegram", lambda: None)

    def test_platform_entry_field_contract(self):
        entry = SimpleNamespace(**{f: None for f in REQUIRED_PLATFORM_ENTRY_FIELDS})
        verify_platform_entry(entry)  # must not raise
        del entry.standalone_sender_fn
        with self.assertRaises(AdapterContractError):
            verify_platform_entry(entry)

    def test_interactive_auth_name_is_in_cloud_contract(self):
        # The Cloud interactive-tap authorizer is a private method; the guard
        # hooks it by exact name, so pin that name here.
        self.assertEqual(INTERACTIVE_AUTH_METHOD, "_is_interactive_sender_authorized")


class DisablesOnContractFailure(TempHomeCase, unittest.TestCase):
    def test_guarded_factory_disables_on_drift(self):
        # A factory that yields a drifted adapter must return None (platform
        # disabled), never an unguarded adapter.
        self.install_fake_send_result()
        write_policy(self.home, "selected_chats", ["15551234567"])
        factory = _guarded_factory(lambda cfg: Drifted(), "whatsapp", lambda: self.home)
        self.assertIsNone(factory(object()))

    def test_guarded_factory_wraps_conforming_adapter(self):
        self.install_fake_send_result()
        write_policy(self.home, "read_only", [])
        factory = _guarded_factory(
            lambda cfg: Conforming(), "whatsapp", lambda: self.home
        )
        adapter = factory(object())
        self.assertIsNotNone(adapter)
        # Read-only: the guarded send must block.
        self.assertFalse(asyncio.run(adapter.send("15551234567", "hi")).success)

    def test_every_required_method_is_in_outbound_set(self):
        # Guard-selection sanity: required methods we assert-exist are also
        # methods we actually guard.
        for family, required in {
            "baileys": {"send", "send_typing"},
            "cloud": {"send", "send_typing"},
        }.items():
            self.assertTrue(required.issubset(OUTBOUND_METHODS[family]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
