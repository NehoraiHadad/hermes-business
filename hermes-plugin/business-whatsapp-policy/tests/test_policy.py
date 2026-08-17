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


class CommunityDmOpenGrant(TempHomeCase, unittest.TestCase):
    """The `dms: open` grant (community.yaml -> generator -> policy file).

    Unknown residents writing privately cannot be enumerated in a policy file,
    so the generator opens a SHAPE on named platforms instead of a list of ids.
    Everything about this class is about the shape holding: it must cover every
    DM chat-id form the bridge presents, and it must never leak into groups,
    broadcasts, channels, other platforms or the owner's surface."""

    def _write(self, payload):
        business = self.home / "business"
        business.mkdir(exist_ok=True)
        (business / "whatsapp-policy.json").write_text(
            json.dumps(payload), encoding="utf-8"
        )

    def _open_policy(self, **overrides):
        payload = {
            "mode": "read_only",
            "behavior": "monitor",
            "reply_chats": [],
            "reply_groups": [],
            "sources": [],
            "community_sources": [],
            "community_dm_open_platforms": ["whatsapp"],
        }
        payload.update(overrides)
        self._write(payload)
        return load_policy(self.home)

    def test_grants_every_dm_form_on_whatsapp(self):
        policy = self._open_policy()
        for identifier in (
            "972501234567",
            "972501234567@s.whatsapp.net",
            "160868067200001@lid",
            "972501234567@c.us",
            "whatsapp:972501234567@s.whatsapp.net",
            "+972501234567",
        ):
            with self.subTest(identifier=identifier):
                self.assertTrue(can_process(policy, identifier, platform="whatsapp"))
                self.assertTrue(can_reply(policy, identifier, platform="whatsapp"))

    def test_never_grants_groups_broadcasts_or_channels(self):
        policy = self._open_policy()
        for identifier in (
            "120363428948689789@g.us",
            # A bare group id is 18 digits -- past the E.164 ceiling, so it
            # cannot pass as a DM even with its suffix stripped.
            "120363428948689789",
            "status@broadcast",
            "120363428948689789@broadcast",
            "120363428948689789@newsletter",
            "",
            None,
            "some name",
        ):
            with self.subTest(identifier=identifier):
                self.assertFalse(can_process(policy, identifier, platform="whatsapp"))
                self.assertFalse(can_reply(policy, identifier, platform="whatsapp"))

    def test_grant_is_platform_scoped(self):
        policy = self._open_policy()
        self.assertFalse(can_reply(policy, "972501234567", platform="whatsapp_cloud"))
        # A platform the generator never opens grants nothing, whatever shape
        # the identifier has.
        other = self._open_policy(community_dm_open_platforms=["whatsapp_cloud"])
        self.assertEqual(other["community_dm_open_platforms"], [])
        self.assertFalse(can_reply(other, "972501234567", platform="whatsapp"))

    def test_dormant_when_the_key_is_absent(self):
        self._write({
            "mode": "read_only",
            "reply_chats": [],
            "reply_groups": [],
            "sources": [],
            "community_sources": [],
        })
        policy = load_policy(self.home)
        self.assertEqual(policy["community_dm_open_platforms"], [])
        self.assertFalse(can_process(policy, "972501234567", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "972501234567@s.whatsapp.net", platform="whatsapp"))
        # The fail-closed defaults are dormant too.
        self.assertFalse(can_reply(load_policy(self.home / "nowhere"), "972501234567", platform="whatsapp"))

    def test_malformed_grant_fails_closed(self):
        for raw in ("whatsapp", {"platform": "whatsapp"}, [None, 7, {}], [""], ["telegram"], []):
            with self.subTest(raw=raw):
                policy = self._open_policy(community_dm_open_platforms=raw)
                self.assertEqual(policy["community_dm_open_platforms"], [])
                self.assertFalse(can_reply(policy, "972501234567", platform="whatsapp"))
        # A corrupt file grants nothing at all.
        (self.home / "business" / "whatsapp-policy.json").write_text(
            "{ not json", encoding="utf-8"
        )
        self.assertFalse(can_reply(load_policy(self.home), "972501234567", platform="whatsapp"))

    def test_does_not_widen_the_owner_surface(self):
        policy = self._open_policy(
            mode="selected_chats",
            behavior="monitor",
            reply_chats=["15551234567"],
            sources=[{"id": "15551234567", "type": "dm", "platform": "whatsapp"}],
        )
        # The owner's own monitored chat is a DM, but it is LISTED: the owner
        # decided "process, do not reply" and opening community DMs must not
        # silently overturn that.
        self.assertTrue(can_process(policy, "15551234567", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "15551234567", platform="whatsapp"))
        # An unknown sender -- the audience the grant exists for -- is served.
        self.assertTrue(can_reply(policy, "972509999999", platform="whatsapp"))
        self.assertFalse(can_reply(policy, "120363428948689789@g.us", platform="whatsapp"))
        # Owner-surface keys survive the read verbatim.
        self.assertEqual(policy["mode"], "selected_chats")
        self.assertEqual(policy["behavior"], "monitor")
        self.assertEqual(policy["reply_chats"], ["15551234567"])

    def test_normalizes_and_dedupes_the_platform_list(self):
        policy = self._open_policy(community_dm_open_platforms=[" WhatsApp ", "whatsapp", "telegram"])
        self.assertEqual(policy["community_dm_open_platforms"], ["whatsapp"])
        self.assertTrue(can_reply(policy, "972501234567", platform="whatsapp"))


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
