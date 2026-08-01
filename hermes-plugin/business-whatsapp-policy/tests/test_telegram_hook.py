"""Telegram pre-dispatch fail-closed hook tests."""

import unittest
from types import SimpleNamespace

from support import Store, TempHomeCase
from telegram_support import write_telegram_policy

from business_whatsapp_policy import pre_gateway_dispatch
from business_whatsapp_policy.ingest import SILENT_MARKER, TELEGRAM_PLACEHOLDER


def event(chat_id, *, chat_type="dm", user_id=None, text="hi", message_id="tg.1"):
    source = SimpleNamespace(
        platform="telegram",
        chat_id=chat_id,
        chat_type=chat_type,
        user_id=user_id if user_id is not None else chat_id,
        user_id_alt="",
    )
    return SimpleNamespace(source=source, text=text, message_id=message_id)


class TelegramHook(TempHomeCase, unittest.TestCase):
    def test_read_only_skips_and_ingests(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        store = Store()
        result = pre_gateway_dispatch(event=event("123"), session_store=store)
        self.assertEqual(result, {"action": "skip", "reason": "business_telegram_read_only"})
        self.assertEqual([m["role"] for m in store.messages], ["user", "assistant"])
        self.assertEqual(store.messages[1]["content"], SILENT_MARKER)

    def test_default_missing_policy_is_read_only(self):
        self.patch_home()
        result = pre_gateway_dispatch(event=event("123"), session_store=Store())
        self.assertEqual(result["action"], "skip")

    def test_empty_text_uses_telegram_placeholder(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        store = Store()
        pre_gateway_dispatch(event=event("123", text=""), session_store=store)
        self.assertEqual(store.messages[0]["content"], TELEGRAM_PLACEHOLDER)

    def test_full_access_allows_without_ingest(self):
        self.patch_home()
        write_telegram_policy(self.home, "full_access", [])
        store = Store()
        result = pre_gateway_dispatch(event=event("123"), session_store=store)
        self.assertEqual(result, {"action": "allow"})
        self.assertEqual(store.messages, [])

    def test_selected_dm_allowed_but_others_skipped(self):
        self.patch_home()
        write_telegram_policy(self.home, "selected_chats", ["123"])
        self.assertEqual(
            pre_gateway_dispatch(event=event("123"), session_store=Store()),
            {"action": "allow"},
        )
        self.assertEqual(
            pre_gateway_dispatch(event=event("999"), session_store=Store())["action"],
            "skip",
        )

    def test_group_authorizes_by_chat_not_sender(self):
        self.patch_home()
        # The individual sender (555) is listed, but the group chat (-100777) is
        # not: a group message must be authorized by the CHAT id, so it is skipped.
        write_telegram_policy(self.home, "selected_chats", ["555"])
        result = pre_gateway_dispatch(
            event=event("-100777", chat_type="group", user_id="555"),
            session_store=Store(),
        )
        self.assertEqual(result["action"], "skip")

    def test_group_allowed_when_chat_is_listed(self):
        self.patch_home()
        write_telegram_policy(self.home, "selected_chats", ["-100777"])
        result = pre_gateway_dispatch(
            event=event("-100777", chat_type="forum", user_id="555"),
            session_store=Store(),
        )
        # A forum/group chat that is explicitly listed authorizes the reply.
        self.assertEqual(result, {"action": "allow"})

    def test_policy_resolution_failure_still_skips(self):
        broken = SimpleNamespace(
            get_hermes_home=lambda: (_ for _ in ()).throw(OSError("home unavailable"))
        )
        self.patch_module("hermes_cli", SimpleNamespace(config=broken))
        self.patch_module("hermes_cli.config", broken)
        result = pre_gateway_dispatch(event=event("123"), session_store=Store())
        self.assertEqual(result["action"], "skip")


if __name__ == "__main__":
    unittest.main(verbosity=2)
