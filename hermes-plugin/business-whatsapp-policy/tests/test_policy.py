"""Policy normalization and passive-ingest tests."""

import json
import unittest
from types import SimpleNamespace

from support import Store, TempHomeCase, write_policy

from business_whatsapp_policy.ingest import SILENT_MARKER, ingest_without_reply
from business_whatsapp_policy.policy import (
    can_process,
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

    def test_exact_sources_do_not_leak_between_qr_and_cloud(self):
        business = self.home / "business"
        business.mkdir()
        (business / "whatsapp-policy.json").write_text(json.dumps({
            "mode": "selected_chats",
            "reply_chats": ["15551234567"],
            "reply_groups": [],
            "sources": [{
                "id": "15551234567@s.whatsapp.net",
                "type": "dm",
                "platform": "whatsapp",
            }],
        }), encoding="utf-8")
        policy = load_policy(self.home)
        self.assertTrue(can_reply(policy, "15551234567", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "15551234567", platform="whatsapp_cloud"))

    def test_monitoring_processes_selected_source_but_blocks_replies(self):
        business = self.home / "business"
        business.mkdir()
        (business / "whatsapp-policy.json").write_text(json.dumps({
            "mode": "selected_chats",
            "behavior": "monitor",
            "reply_chats": ["15551234567"],
            "reply_groups": [],
            "sources": [{"id": "15551234567", "type": "dm", "platform": "whatsapp"}],
        }), encoding="utf-8")
        policy = load_policy(self.home)
        self.assertTrue(can_process(policy, "15551234567", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "15551234567", platform="whatsapp"))

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


class CommunitySources(TempHomeCase, unittest.TestCase):
    """Community-contract grants (written by the Tachles community generator).

    Live finding 2026-08-16: the gate skipped the pilot group's first triggered
    reply (`business_whatsapp_read_only`) because only the owner surface could
    authorize chats. `community_sources` authorizes EXACTLY the contract's
    chats for process+reply without touching the owner's mode/behavior."""

    def _write(self, payload):
        business = self.home / "business"
        business.mkdir(exist_ok=True)
        (business / "whatsapp-policy.json").write_text(
            json.dumps(payload), encoding="utf-8"
        )

    def test_community_group_processes_and_replies_under_owner_read_only(self):
        self._write({
            "mode": "read_only",
            "reply_chats": [],
            "reply_groups": [],
            "sources": [],
            "community_sources": [
                {"id": "120363428948689789@g.us", "type": "group", "platform": "whatsapp"},
                {"id": "972547401660@s.whatsapp.net", "type": "dm", "platform": "whatsapp"},
            ],
        })
        policy = load_policy(self.home)
        self.assertTrue(can_process(policy, "120363428948689789@g.us", platform="whatsapp"))
        self.assertTrue(can_reply(policy, "120363428948689789@g.us", platform="whatsapp"))
        self.assertTrue(can_reply(policy, "972547401660", platform="whatsapp"))
        # A chat outside the contract stays fully governed by the owner surface.
        self.assertFalse(can_process(policy, "9725231386456762@g.us", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "15551234567", platform="whatsapp"))

    def test_community_grant_is_platform_scoped_and_does_not_leak_to_cloud(self):
        self._write({
            "mode": "read_only",
            "reply_chats": [],
            "reply_groups": [],
            "sources": [],
            "community_sources": [
                {"id": "972547401660@s.whatsapp.net", "type": "dm", "platform": "whatsapp"},
            ],
        })
        policy = load_policy(self.home)
        self.assertTrue(can_reply(policy, "972547401660", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "972547401660", platform="whatsapp_cloud"))

    def test_community_sources_do_not_widen_the_owner_surface(self):
        self._write({
            "mode": "selected_chats",
            "behavior": "monitor",
            "reply_chats": ["15551234567"],
            "reply_groups": [],
            "sources": [{"id": "15551234567", "type": "dm", "platform": "whatsapp"}],
            "community_sources": [
                {"id": "120363428948689789@g.us", "type": "group", "platform": "whatsapp"},
            ],
        })
        policy = load_policy(self.home)
        # Owner chat: monitor still blocks replies exactly as before.
        self.assertTrue(can_process(policy, "15551234567", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "15551234567", platform="whatsapp"))
        # Community chat: replies allowed.
        self.assertTrue(can_reply(policy, "120363428948689789@g.us", platform="whatsapp"))

    def test_malformed_community_entries_fail_closed(self):
        self._write({
            "mode": "read_only",
            "reply_chats": [],
            "reply_groups": [],
            "sources": [],
            "community_sources": [
                "bare-string",
                {"id": "", "type": "group", "platform": "whatsapp"},
                {"id": "x@g.us", "type": "group", "platform": "telegram"},
                {"id": "y@g.us", "type": "group", "platform": "whatsapp_cloud"},
            ],
        })
        policy = load_policy(self.home)
        self.assertEqual(policy["community_sources"], [])
        self.assertFalse(can_reply(policy, "x@g.us", platform="whatsapp"))
        # A corrupt file still fails closed for community chats too.
        (self.home / "business" / "whatsapp-policy.json").write_text(
            "{ not json", encoding="utf-8"
        )
        fallback = load_policy(self.home)
        self.assertEqual(fallback["community_sources"], [])
        self.assertFalse(can_reply(fallback, "120363428948689789@g.us", platform="whatsapp"))


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
