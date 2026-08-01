"""Telegram policy normalization and matching tests."""

import unittest

from support import TempHomeCase
from telegram_support import write_telegram_policy

from business_whatsapp_policy.telegram_policy import (
    can_reply,
    load_policy,
    normalize_identifier,
)


class TelegramNormalization(TempHomeCase, unittest.TestCase):
    def test_numeric_and_username_normalization(self):
        self.assertEqual(normalize_identifier("  123456789 "), "123456789")
        self.assertEqual(normalize_identifier("-1001234567890"), "-1001234567890")
        self.assertEqual(normalize_identifier("007"), "7")
        self.assertEqual(normalize_identifier("telegram:123"), "123")
        self.assertEqual(normalize_identifier("@MyBot"), "mybot")
        self.assertEqual(normalize_identifier("@my_bot"), "my_bot")
        self.assertEqual(normalize_identifier(""), "")

    def test_missing_policy_fails_closed_to_read_only(self):
        policy = load_policy(self.home)
        self.assertEqual(policy["mode"], "read_only")
        self.assertFalse(can_reply(policy, "123456789"))

    def test_invalid_policy_falls_back_to_read_only(self):
        business = self.home / "business"
        business.mkdir()
        path = business / "telegram-policy.json"
        path.write_text("{ not json", encoding="utf-8")
        self.assertEqual(load_policy(self.home)["mode"], "read_only")
        path.write_text('{"mode":"answer_all","reply_chats":[]}', encoding="utf-8")
        self.assertEqual(load_policy(self.home)["mode"], "read_only")

    def test_full_access_answers_everyone(self):
        write_telegram_policy(self.home, "full_access", [])
        policy = load_policy(self.home)
        self.assertTrue(can_reply(policy, "123"))
        self.assertTrue(can_reply(policy, "-1009999"))
        self.assertTrue(can_reply(policy, "@anyone"))

    def test_read_only_answers_nobody(self):
        write_telegram_policy(self.home, "read_only", ["123"])
        self.assertFalse(can_reply(load_policy(self.home), "123"))

    def test_selected_requires_exact_normalized_match(self):
        write_telegram_policy(self.home, "selected_chats", ["@Alice", "123456789"])
        policy = load_policy(self.home)
        self.assertTrue(can_reply(policy, "alice"))
        self.assertTrue(can_reply(policy, "@ALICE"))
        self.assertTrue(can_reply(policy, "telegram:123456789"))
        for near_miss in ("12345678", "1234567890", "alic", "alicee"):
            self.assertFalse(can_reply(policy, near_miss), near_miss)


if __name__ == "__main__":
    unittest.main(verbosity=2)
