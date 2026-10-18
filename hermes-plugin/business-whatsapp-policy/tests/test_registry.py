"""Registry composition, lazy startup and fail-closed contract drift."""
import asyncio
import unittest
from unittest.mock import patch
from support import FakeAdapter, FakePlatformEntry, TempHomeCase, write_policy
from business_whatsapp_policy.registry import install_registry_guards
from business_whatsapp_policy.transport import AdapterContractError

class RegistryGuards(TempHomeCase, unittest.TestCase):
    def test_native_registration_preserves_lazy_loading_and_guards_after_resolution(self):
        self.install_fake_send_result()
        registry = self.install_fake_registry()
        calls = []
        def load():
            calls.append('loaded')
            registry.register(FakePlatformEntry(name='whatsapp', adapter_factory=lambda cfg: FakeAdapter()))
        registry.register_deferred('whatsapp', load)
        install_registry_guards(lambda: self.home)
        self.assertEqual(calls, [])
        adapter = registry.get('whatsapp').adapter_factory(None)
        self.assertEqual(calls, ['loaded'])
        self.assertFalse(asyncio.run(adapter.send('15551234567', 'blocked')).success)
        self.assertEqual(adapter.sent, [])

    def test_lazy_entry_drift_never_exposes_the_original_factory(self):
        registry = self.install_fake_registry()
        registry.register_deferred('whatsapp', lambda: registry.register(
            FakePlatformEntry(name='whatsapp', adapter_factory=lambda cfg: FakeAdapter())))
        install_registry_guards(lambda: self.home)
        with patch('business_whatsapp_policy.registry.verify_platform_entry', side_effect=AdapterContractError('drift')):
            with self.assertRaises(AdapterContractError):
                registry.get('whatsapp')
        self.assertIsNone(registry.entries['whatsapp'].adapter_factory(None))

    def test_registers_and_guards_cloud_standalone_sender(self):
        # Simulate a future Hermes that registers a whatsapp_cloud entry carrying
        # a Cloud standalone sender: install_registry_guards must preserve AND
        # guard it so out-of-process Cloud sends obey the reply policy.
        cloud_calls = []

        async def cloud_sender(config, chat_id, message, **_kwargs):
            cloud_calls.append((chat_id, message))
            return {"success": True, "message_id": "wamid.1"}

        cloud_entry = FakePlatformEntry(
            name="whatsapp_cloud", standalone_sender_fn=cloud_sender
        )
        registry = self.install_fake_registry(cloud_entry=cloud_entry)

        install_registry_guards(lambda: self.home)

        guarded = registry.get("whatsapp_cloud").standalone_sender_fn
        self.assertIsNotNone(guarded)
        write_policy(self.home, "read_only", [])
        self.assertIn("error", asyncio.run(guarded({}, "15551234567", "hi")))
        self.assertEqual(cloud_calls, [])
        write_policy(self.home, "selected_chats", ["15551234567"])
        self.assertEqual(
            asyncio.run(guarded({}, "15551234567", "hi"))["success"], True
        )

    def test_cloud_standalone_absent_when_hermes_exposes_none(self):
        # Today's Hermes exposes no Cloud standalone sender: the registered entry
        # must carry None (delivery unavailable, not silently unguarded).
        registry = self.install_fake_registry()
        install_registry_guards(lambda: self.home)
        self.assertIsNone(registry.get("whatsapp_cloud").standalone_sender_fn)
