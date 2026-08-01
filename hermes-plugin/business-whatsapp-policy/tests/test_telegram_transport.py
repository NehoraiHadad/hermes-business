"""Telegram outbound + interactive + standalone guard tests."""

import asyncio
import unittest

from support import TempHomeCase
from telegram_support import FakeTelegramAdapter, write_telegram_policy

from business_whatsapp_policy.telegram_transport import (
    guard_adapter,
    guard_standalone_sender,
)


class TelegramGuards(TempHomeCase, unittest.TestCase):
    def _adapter(self):
        self.install_fake_send_result()
        return guard_adapter(FakeTelegramAdapter(), lambda: self.home)

    def test_read_only_blocks_every_outbound_path(self):
        write_telegram_policy(self.home, "read_only", [])
        adapter = self._adapter()
        self.assertFalse(asyncio.run(adapter.send("123", "hi")).success)
        self.assertEqual(adapter.sent, [])
        self.assertIsNone(asyncio.run(adapter.send_typing("123")))
        self.assertFalse(asyncio.run(adapter.delete_message("123", "7")))
        self.assertIsNone(asyncio.run(adapter.ensure_dm_topic("123", "topic")))
        self.assertEqual(adapter.topics, [])
        self.assertFalse(adapter._is_callback_user_authorized("123", chat_id="123"))

    def test_full_access_allows_everything(self):
        write_telegram_policy(self.home, "full_access", [])
        adapter = self._adapter()
        self.assertTrue(asyncio.run(adapter.send("123", "hi")).success)
        self.assertEqual(adapter.sent, [("123", "hi")])
        self.assertTrue(adapter._is_callback_user_authorized("999", chat_id="999"))

    def test_selected_allows_only_matching_target(self):
        write_telegram_policy(self.home, "selected_chats", ["123456789"])
        adapter = self._adapter()
        self.assertTrue(asyncio.run(adapter.send("telegram:123456789", "hi")).success)
        for near_miss in ("12345678", "1234567890"):
            self.assertFalse(asyncio.run(adapter.send(near_miss, "hi")).success, near_miss)
        self.assertEqual(adapter.sent, [("telegram:123456789", "hi")])

    def test_callback_selected_group_member_may_tap(self):
        write_telegram_policy(self.home, "selected_chats", ["-1001111"])
        adapter = self._adapter()
        # A member of the selected group may tap even if their user id is not
        # listed — the group chat id authorizes it. Raw Telegram types too.
        for chat_type in ("group", "supergroup", "channel", "forum", "ChatType.GROUP"):
            self.assertTrue(
                adapter._is_callback_user_authorized(
                    "55", chat_id="-1001111", chat_type=chat_type
                ),
                chat_type,
            )
        # An unlisted user in a DM (chat_id == their own id) is denied.
        self.assertFalse(
            adapter._is_callback_user_authorized("55", chat_id="55", chat_type="dm")
        )

    def test_callback_dm_selected_user_works(self):
        # A user selected for a DM may tap in their DM (chat_id == user id).
        write_telegram_policy(self.home, "selected_chats", ["55"])
        adapter = self._adapter()
        for chat_type in ("dm", "private", "ChatType.PRIVATE"):
            self.assertTrue(
                adapter._is_callback_user_authorized("55", chat_id="55", chat_type=chat_type),
                chat_type,
            )

    def test_callback_dm_selected_user_cannot_tap_in_unselected_group(self):
        # REGRESSION: selecting user 55 for a DM must NOT let them authorize an
        # interactive tap inside a group that was never selected. In a group the
        # sender id is never an authority — only the group chat id is.
        write_telegram_policy(self.home, "selected_chats", ["55"])
        adapter = self._adapter()
        for chat_type in ("group", "supergroup", "channel", "forum", "ChatType.GROUP"):
            self.assertFalse(
                adapter._is_callback_user_authorized(
                    "55", chat_id="-1009999", chat_type=chat_type
                ),
                chat_type,
            )

    def test_callback_unknown_chat_type_fails_closed_to_chat(self):
        # An absent/garbled chat type cannot be proven to be a DM, so the sender
        # id is never trusted: a selected DM user still cannot tap in an
        # unselected group...
        write_telegram_policy(self.home, "selected_chats", ["55"])
        adapter = self._adapter()
        for chat_type in (None, "", "wat"):
            self.assertFalse(
                adapter._is_callback_user_authorized(
                    "55", chat_id="-1009999", chat_type=chat_type
                ),
                repr(chat_type),
            )
        # ...but a numeric-id DM (chat_id == user id) still authorizes via the
        # chat id even with no chat type reported.
        for chat_type in (None, ""):
            self.assertTrue(
                adapter._is_callback_user_authorized("55", chat_id="55", chat_type=chat_type),
                repr(chat_type),
            )

    def test_standalone_sender_enforces_policy(self):
        calls = []

        async def original(config, chat_id, message, **_kwargs):
            calls.append((chat_id, message))
            return {"success": True}

        guarded = guard_standalone_sender(original, lambda: self.home)
        write_telegram_policy(self.home, "read_only", [])
        self.assertIn("error", asyncio.run(guarded({}, "123", "scheduled")))
        self.assertEqual(calls, [])
        write_telegram_policy(self.home, "selected_chats", ["123"])
        self.assertEqual(asyncio.run(guarded({}, "123", "ok")), {"success": True})
        self.assertEqual(calls, [("123", "ok")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
