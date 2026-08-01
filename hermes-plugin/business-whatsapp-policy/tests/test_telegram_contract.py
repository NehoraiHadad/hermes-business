"""Fail-closed Telegram contract tests: the guard must disable, not degrade, on
drift."""

import asyncio
import unittest
from types import SimpleNamespace

from support import TempHomeCase
from telegram_support import write_telegram_policy

from business_whatsapp_policy.telegram_contract import (
    OUTBOUND_METHODS,
    REQUIRED_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    is_supported_version,
)
from business_whatsapp_policy.telegram_registry import _guarded_factory
from business_whatsapp_policy.telegram_surface import (
    verify_adapter_surface,
    verify_platform_entry,
)
from business_whatsapp_policy.telegram_transport import AdapterContractError


class Conforming:
    async def send(self, chat_id, content, reply_to=None, metadata=None):
        return True

    async def send_typing(self, chat_id, metadata=None):
        return None

    # A benign, non-outbound public helper must NOT trip the drift tripwire.
    def get_chat_info(self, chat_id):
        return {}


class Drifted(Conforming):
    async def send_gift(self, chat_id, content):  # new, unguarded outbound sender
        return True


class TelegramContractTripwire(unittest.TestCase):
    def test_version_shared_with_installed_contract(self):
        self.assertTrue(is_supported_version("0.19.1"))
        self.assertTrue(is_supported_version("0.19.4"))
        self.assertFalse(is_supported_version("0.20.0"))

    def test_required_methods_are_all_guarded(self):
        self.assertTrue(REQUIRED_METHODS.issubset(OUTBOUND_METHODS))

    def test_conforming_surface_passes(self):
        verify_adapter_surface(Conforming())  # must not raise

    def test_missing_required_method_fails_closed(self):
        class NoSend:
            async def send_typing(self, chat_id, metadata=None):
                return None

        with self.assertRaises(AdapterContractError):
            verify_adapter_surface(NoSend())

    def test_new_outbound_method_fails_closed(self):
        with self.assertRaises(AdapterContractError):
            verify_adapter_surface(Drifted())

    def test_platform_entry_field_contract(self):
        entry = SimpleNamespace(**{f: None for f in REQUIRED_PLATFORM_ENTRY_FIELDS})
        verify_platform_entry(entry)  # must not raise
        del entry.standalone_sender_fn
        with self.assertRaises(AdapterContractError):
            verify_platform_entry(entry)


class TelegramDisablesOnContractFailure(TempHomeCase, unittest.TestCase):
    def test_guarded_factory_disables_on_drift(self):
        self.install_fake_send_result()
        write_telegram_policy(self.home, "full_access", [])
        factory = _guarded_factory(lambda cfg: Drifted(), lambda: self.home)
        self.assertIsNone(factory(object()))

    def test_guarded_factory_wraps_conforming_adapter(self):
        self.install_fake_send_result()
        write_telegram_policy(self.home, "read_only", [])
        factory = _guarded_factory(lambda cfg: Conforming(), lambda: self.home)
        adapter = factory(object())
        self.assertIsNotNone(adapter)
        self.assertFalse(asyncio.run(adapter.send("123", "hi")).success)


if __name__ == "__main__":
    unittest.main(verbosity=2)
