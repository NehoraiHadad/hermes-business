"""Policy normalization and passive-ingest tests."""

import unittest
from types import SimpleNamespace

from support import Store, TempHomeCase, write_policy

from business_whatsapp_policy.ingest import SILENT_MARKER, ingest_without_reply
from business_whatsapp_policy.policy import (
    can_reply,
    load_policy,
    normalize_identifier,
    target_parts,
)


class PolicyNormalization(TempHomeCase, unittest.TestCase):
    def test_missing_policy_fails_closed(self):
        policy = load_policy(self.home)
        self.assertEqual(policy["mode"], "read_only")
        self.assertFalse(can_reply(policy, "15551234567"))

    def test_invalid_policy_falls_back_to_read_only(self):
        business = self.home / "business"
        business.mkdir()
        path = business / "whatsapp-policy.json"
        path.write_text("{ not json", encoding="utf-8")
        self.assertEqual(load_policy(self.home)["mode"], "read_only")
        path.write_text(
            '{"mode":"answer_everyone","reply_chats":[]}', encoding="utf-8"
        )
        self.assertEqual(load_policy(self.home)["mode"], "read_only")

    def test_selected_chat_matches_phone_and_jid(self):
        write_policy(self.home, "selected_chats", ["+15551234567"])
        policy = load_policy(self.home)
        self.assertTrue(can_reply(policy, "15551234567@s.whatsapp.net"))
        self.assertFalse(can_reply(policy, "15550000000"))

    def test_identifier_and_target_normalization(self):
        self.assertEqual(
            normalize_identifier("WhatsApp:+15551234567@s.whatsapp.net"),
            "15551234567",
        )
        self.assertEqual(normalize_identifier("15551234567@lid"), "15551234567")
        self.assertEqual(normalize_identifier("+1 (555) 123-4567"), "15551234567")
        self.assertEqual(
            target_parts("whatsapp:15551234567"),
            ("whatsapp", "15551234567"),
        )


class PassiveIngest(TempHomeCase, unittest.TestCase):
    def test_preserves_alternation(self):
        store = Store()
        event = SimpleNamespace(
            source=SimpleNamespace(), text="hello", message_id="wamid.1"
        )
        self.assertTrue(ingest_without_reply(event, store))
        self.assertEqual([m["role"] for m in store.messages], ["user", "assistant"])
        self.assertEqual(store.messages[-1]["content"], SILENT_MARKER)

    def test_dedupes_repeat_delivery(self):
        store = Store()
        event = SimpleNamespace(
            source=SimpleNamespace(), text="hi", message_id="wamid.7"
        )
        self.assertTrue(ingest_without_reply(event, store))
        before = len(store.messages)
        self.assertTrue(ingest_without_reply(event, store))
        self.assertEqual(len(store.messages), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
