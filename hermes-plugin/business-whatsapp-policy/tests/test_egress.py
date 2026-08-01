"""Unit tests for the single-source family resolution + egress decision."""

import unittest

from support import TempHomeCase, write_policy
from telegram_support import write_telegram_policy

from business_whatsapp_policy import egress, families


class ParseTarget(unittest.TestCase):
    def test_platform_only(self):
        self.assertEqual(egress.parse_target("telegram"), ("telegram", ""))

    def test_platform_and_chat(self):
        self.assertEqual(egress.parse_target("telegram:123"), ("telegram", "123"))

    def test_thread_is_dropped(self):
        self.assertEqual(egress.parse_target("telegram:-100:17"), ("telegram", "-100"))

    def test_blank(self):
        self.assertEqual(egress.parse_target(""), ("", ""))
        self.assertEqual(egress.parse_target(None), ("", ""))


class FamilyResolution(unittest.TestCase):
    def test_controlled(self):
        self.assertTrue(families.is_controlled("telegram"))
        self.assertTrue(families.is_controlled("whatsapp"))
        self.assertTrue(families.is_controlled("whatsapp_cloud"))

    def test_enum_like_value(self):
        self.assertTrue(families.is_controlled(type("P", (), {"value": "telegram"})()))

    def test_not_controlled(self):
        for name in ("discord", "slack", "signal", "", "unknown"):
            self.assertFalse(families.is_controlled(name))


class Decision(TempHomeCase, unittest.TestCase):
    def test_non_controlled_returns_none(self):
        self.patch_home()
        self.assertIsNone(egress.decision("discord", "C1", home_getter=lambda: self.home))

    def test_telegram_full_access_real_chat(self):
        self.patch_home()
        write_telegram_policy(self.home, "full_access", [])
        self.assertIsNone(egress.decision("telegram", "123", home_getter=lambda: self.home))

    def test_telegram_full_access_empty_denies(self):
        self.patch_home()
        write_telegram_policy(self.home, "full_access", [])
        self.assertIsNotNone(egress.decision("telegram", "", home_getter=lambda: self.home))

    def test_selected_exact_match(self):
        self.patch_home()
        write_telegram_policy(self.home, "selected_chats", ["123"])
        self.assertIsNone(egress.decision("telegram", "123", home_getter=lambda: self.home))
        self.assertIsNotNone(egress.decision("telegram", "999", home_getter=lambda: self.home))

    def test_whatsapp_read_only_denies(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        self.assertIsNotNone(
            egress.decision("whatsapp", "15551234567", home_getter=lambda: self.home)
        )

    def test_home_getter_error_denies(self):
        def boom():
            raise OSError("home unavailable")

        self.assertIsNotNone(egress.decision("telegram", "123", home_getter=boom))


if __name__ == "__main__":
    unittest.main(verbosity=2)
