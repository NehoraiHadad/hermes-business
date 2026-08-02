import unittest

from support import TempHomeCase, write_policy
from business_whatsapp_policy import egress, families


class EgressDecision(TempHomeCase, unittest.TestCase):
    def test_only_whatsapp_is_controlled(self):
        self.assertTrue(families.is_controlled("whatsapp"))
        self.assertTrue(families.is_controlled("whatsapp_cloud"))
        self.assertFalse(families.is_controlled("telegram"))

    def test_telegram_passes_to_native_hermes(self):
        self.patch_home()
        self.assertIsNone(egress.decision("telegram", "123", home_getter=lambda: self.home))

    def test_whatsapp_read_only_blocks(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        self.assertIsNotNone(
            egress.decision("whatsapp", "15551234567", home_getter=lambda: self.home)
        )

    def test_whatsapp_selected_allows_exact_target(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["15551234567"])
        self.assertIsNone(
            egress.decision("whatsapp", "+1 (555) 123-4567", home_getter=lambda: self.home)
        )

    def test_whatsapp_policy_error_fails_closed(self):
        def boom():
            raise OSError("home unavailable")

        self.assertIsNotNone(egress.decision("whatsapp", "123", home_getter=boom))


if __name__ == "__main__":
    unittest.main(verbosity=2)
