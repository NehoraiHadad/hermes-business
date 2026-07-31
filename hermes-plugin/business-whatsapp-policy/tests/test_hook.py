"""Pre-dispatch fail-closed hook tests."""

import unittest
from types import SimpleNamespace

from support import Store, TempHomeCase, write_policy

from business_whatsapp_policy import pre_gateway_dispatch
from business_whatsapp_policy.ingest import SILENT_MARKER
from business_whatsapp_policy.policy import can_reply, load_policy


class HookBehaviour(TempHomeCase, unittest.TestCase):
    @staticmethod
    def event(platform, chat_id):
        source = SimpleNamespace(
            platform=SimpleNamespace(value=platform),
            chat_id=chat_id,
            user_id=chat_id,
            user_id_alt="",
        )
        return SimpleNamespace(source=source, text="hi", message_id="wamid.hook")

    def test_skips_and_ingests_in_read_only(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        store = Store()
        result = pre_gateway_dispatch(
            event=self.event("whatsapp", "15551234567"), session_store=store
        )
        self.assertEqual(
            result, {"action": "skip", "reason": "business_whatsapp_read_only"}
        )
        self.assertEqual([m["role"] for m in store.messages], ["user", "assistant"])

    def test_read_only_stores_inbound_and_produces_zero_outbound(self):
        # Proof of the read_only guarantee: the inbound message is persisted,
        # the only assistant turn is the silent NO_REPLY marker (no model
        # output), the hook returns "skip" (so the gateway never dispatches to
        # the model or tools), and the reply policy authorizes nothing.
        self.patch_home()
        write_policy(self.home, "read_only", [])
        store = Store()
        result = pre_gateway_dispatch(
            event=self.event("whatsapp", "15551234567"), session_store=store
        )
        self.assertNotEqual(result.get("action"), "allow")
        self.assertEqual(result["action"], "skip")
        # Inbound stored; the assistant turn is the silent marker only.
        self.assertEqual([m["role"] for m in store.messages], ["user", "assistant"])
        self.assertEqual(store.messages[0]["content"], "hi")
        self.assertEqual(store.messages[1]["content"], SILENT_MARKER)
        # The policy itself authorizes no reply target in read_only.
        policy = load_policy(self.home)
        self.assertFalse(can_reply(policy, "15551234567"))
        self.assertFalse(can_reply(policy, "15551234567@s.whatsapp.net"))

    def test_allows_selected_chat(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["15551234567"])
        store = Store()
        result = pre_gateway_dispatch(
            event=self.event("whatsapp_cloud", "15551234567"),
            session_store=store,
        )
        self.assertEqual(result, {"action": "allow"})
        self.assertEqual(store.messages, [])

    def test_group_permission_matches_chat_not_sender(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["972500000000"])
        store = Store()
        event = SimpleNamespace(
            source=SimpleNamespace(
                platform="whatsapp",
                chat_id="120363000000@g.us",
                chat_type="group",
                user_id="972500000000",
                user_id_alt="",
            ),
            text="group message",
            message_id="wamid.group",
        )
        result = pre_gateway_dispatch(event=event, session_store=store)
        self.assertEqual(result["action"], "skip")

    def test_group_jid_fallback_does_not_authorize_by_sender(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["972500000000"])
        event = SimpleNamespace(
            source=SimpleNamespace(
                platform="whatsapp",
                chat_id="120363000000@g.us",
                chat_type="",
                user_id="972500000000",
                user_id_alt="",
            ),
            text="group message without chat_type",
            message_id="wamid.group.fallback",
        )
        result = pre_gateway_dispatch(event=event, session_store=Store())
        self.assertEqual(result["action"], "skip")

    def test_policy_resolution_failure_still_skips(self):
        broken = SimpleNamespace(
            get_hermes_home=lambda: (_ for _ in ()).throw(OSError("home unavailable"))
        )
        self.patch_module("hermes_cli", SimpleNamespace(config=broken))
        self.patch_module("hermes_cli.config", broken)
        result = pre_gateway_dispatch(
            event=self.event("whatsapp", "15551234567"), session_store=Store()
        )
        self.assertEqual(result["action"], "skip")

    def test_ingest_failure_still_skips(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])

        class BrokenStore:
            def get_or_create_session(self, _source):
                raise OSError("disk unavailable")

        result = pre_gateway_dispatch(
            event=self.event("whatsapp", "15551234567"),
            session_store=BrokenStore(),
        )
        self.assertEqual(result["action"], "skip")

    def test_ignores_non_whatsapp(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        self.assertIsNone(
            pre_gateway_dispatch(
                event=self.event("telegram", "42"),
                session_store=Store(),
            )
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
