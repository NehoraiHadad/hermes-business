"""Outbound and interactive authorization guard tests."""

import asyncio
import unittest
from types import SimpleNamespace

from support import FakeAdapter, TempHomeCase, write_policy

from business_whatsapp_policy.registry import cloud_configured
from business_whatsapp_policy.transport import guard_adapter, guard_standalone_sender


class TransportBlocking(TempHomeCase, unittest.TestCase):
    def test_cloud_requires_real_meta_credentials(self):
        self.assertFalse(cloud_configured(SimpleNamespace(extra={})))
        self.assertFalse(
            cloud_configured(SimpleNamespace(extra={"phone_number_id": "123"}))
        )
        self.assertTrue(
            cloud_configured(
                SimpleNamespace(
                    extra={"phone_number_id": "123", "access_token": "token"}
                )
            )
        )

    def test_blocks_send_and_interactive_taps_in_read_only(self):
        self.install_fake_send_result()
        write_policy(self.home, "read_only", [])
        adapter = guard_adapter(FakeAdapter(), "whatsapp", lambda: self.home)
        result = asyncio.run(adapter.send("15551234567", "hi"))
        self.assertFalse(result.success)
        self.assertEqual(adapter.sent, [])
        self.assertIsNone(asyncio.run(adapter.send_typing("15551234567")))
        self.assertEqual(adapter.typed, [])
        self.assertTrue(asyncio.run(adapter._dispatch_interactive_reply({"from": "15551234567"}, {})))
        self.assertEqual(adapter.sent, [])

    def test_ledgered_delivery_blocks_before_recording_or_sending(self):
        self.install_fake_send_result()
        write_policy(self.home, "selected_chats", ["15551234567"])
        adapter = guard_adapter(FakeAdapter(), "whatsapp", lambda: self.home)
        event = SimpleNamespace(source=SimpleNamespace(chat_id="15550000000"))
        result, current = asyncio.run(adapter.send_final_ledgered(event, "s", "hi", {}, reply_to=None))
        self.assertFalse(result.success)
        self.assertIs(current, adapter)
        self.assertEqual(adapter.sent, [])
        event.source.chat_id = "15551234567"
        result, _ = asyncio.run(adapter.send_final_ledgered(event, "s", "hi", {}, reply_to=None))
        self.assertTrue(result.success)
        self.assertEqual(adapter.sent, [("15551234567", "ledger")])

    def test_allows_only_selected_chat(self):
        self.install_fake_send_result()
        write_policy(self.home, "selected_chats", ["15551234567"])
        adapter = guard_adapter(FakeAdapter(), "whatsapp", lambda: self.home)
        result = asyncio.run(adapter.send("15551234567@s.whatsapp.net", "hi"))
        self.assertTrue(result.success)
        self.assertEqual(adapter.sent, [("15551234567@s.whatsapp.net", "hi")])
        self.assertFalse(asyncio.run(adapter._dispatch_interactive_reply({"from": "15551234567"}, {})))
        self.assertTrue(asyncio.run(adapter._dispatch_interactive_reply({"from": "15550000000"}, {})))

    def test_blocks_sync_mutating_method_in_read_only(self):
        # A plain synchronous mutating method must fail closed too — the pre-fix
        # guard only wrapped coroutine functions, silently leaving these open.
        self.install_fake_send_result()
        write_policy(self.home, "read_only", [])
        adapter = guard_adapter(FakeAdapter(), "whatsapp", lambda: self.home)
        self.assertFalse(adapter.delete("15551234567"))
        self.assertEqual(adapter.deleted, [])

    def test_allows_sync_mutating_method_for_selected_chat(self):
        self.install_fake_send_result()
        write_policy(self.home, "selected_chats", ["15551234567"])
        adapter = guard_adapter(FakeAdapter(), "whatsapp", lambda: self.home)
        self.assertTrue(adapter.delete("15551234567@s.whatsapp.net"))
        self.assertEqual(adapter.deleted, ["15551234567@s.whatsapp.net"])

    def test_selected_chats_requires_exact_normalized_match(self):
        # Exact normalized allowlist — NOT substring/prefix. A neighbouring
        # number that merely contains or extends the allowed id must be blocked
        # on every path (async send, sync delete, interactive tap).
        self.install_fake_send_result()
        write_policy(self.home, "selected_chats", ["15551234567"])
        adapter = guard_adapter(FakeAdapter(), "whatsapp", lambda: self.home)
        for near_miss in ("1555123456", "155512345670", "5551234567"):
            blocked = asyncio.run(adapter.send(near_miss, "hi"))
            self.assertFalse(blocked.success, near_miss)
            self.assertFalse(adapter.delete(near_miss), near_miss)
            self.assertTrue(
                asyncio.run(adapter._dispatch_interactive_reply({"from": near_miss}, {})), near_miss
            )
        self.assertEqual(adapter.sent, [])
        self.assertEqual(adapter.deleted, [])
        # The exact normalized id (via +, spaces and a JID suffix) is allowed.
        ok = asyncio.run(adapter.send("+1 (555) 123-4567@s.whatsapp.net", "hi"))
        self.assertTrue(ok.success)

    def test_scheduled_standalone_enforces_exact_allowlist(self):
        calls = []

        async def original(config, chat_id, message, **_kwargs):
            calls.append(chat_id)
            return {"success": True}

        guarded = guard_standalone_sender(original, lambda: self.home)
        write_policy(self.home, "selected_chats", ["15551234567"])
        self.assertIn("error", asyncio.run(guarded({}, "1555123456", "x")))
        self.assertEqual(calls, [])
        self.assertEqual(
            asyncio.run(guarded({}, "+15551234567", "x")), {"success": True}
        )
        self.assertEqual(calls, ["+15551234567"])

    def test_standalone_sender_guard(self):
        calls = []

        async def original(config, chat_id, message, **_kwargs):
            calls.append((chat_id, message))
            return {"success": True}

        guarded = guard_standalone_sender(original, lambda: self.home)
        write_policy(self.home, "read_only", [])
        blocked = asyncio.run(guarded({}, "15551234567", "scheduled output"))
        self.assertIn("error", blocked)
        self.assertEqual(calls, [])
        write_policy(self.home, "selected_chats", ["15551234567"])
        allowed = asyncio.run(guarded({}, "15551234567", "scheduled output"))
        self.assertEqual(allowed, {"success": True})
        self.assertEqual(calls, [("15551234567", "scheduled output")])

    def test_sync_standalone_sender_guard(self):
        calls = []

        def original(config, chat_id, message, **_kwargs):
            calls.append((chat_id, message))
            return {"success": True}

        guarded = guard_standalone_sender(original, lambda: self.home)
        write_policy(self.home, "read_only", [])
        self.assertIn("error", guarded({}, "15551234567", "hi"))
        self.assertEqual(calls, [])
        write_policy(self.home, "selected_chats", ["15551234567"])
        self.assertEqual(guarded({}, "15551234567", "hi"), {"success": True})



if __name__ == "__main__":
    unittest.main(verbosity=2)
