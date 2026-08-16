import json
import unittest

from support import ArchiveHome
from community_archive.policy import PolicyError, load_policy


class PolicyTests(ArchiveHome, unittest.TestCase):
    def test_loads_exact_server_scope_and_dedupes_requested_order(self):
        policy = load_policy(self.home)
        self.assertEqual(policy.groups["120363000000000001@g.us"], "Main from policy")
        self.assertEqual(
            policy.select(["120363000000000002@g.us", "120363000000000002@g.us"]),
            ("120363000000000002@g.us",),
        )

    def test_unapproved_group_fails_whole_request_without_partial_scope(self):
        policy = load_policy(self.home)
        with self.assertRaisesRegex(PolicyError, "not approved"):
            policy.select(["120363000000000001@g.us", "120363999999999999@g.us"])

    def test_missing_malformed_or_duplicate_policy_fails_closed(self):
        policy_path = self.home / "community" / "archive-policy.json"
        for payload in ("not json", json.dumps({"version": 2, "groups": []})):
            policy_path.write_text(payload, encoding="utf-8")
            with self.assertRaises(PolicyError):
                load_policy(self.home)
        self.write_policy(("120363000000000001@g.us", "one"), ("120363000000000001@g.us", "two"))
        with self.assertRaises(PolicyError):
            load_policy(self.home)

    def test_non_group_identifiers_are_refused(self):
        self.write_policy(("972501234567@s.whatsapp.net", "DM"))
        with self.assertRaisesRegex(PolicyError, "invalid WhatsApp group"):
            load_policy(self.home)


if __name__ == "__main__":
    unittest.main(verbosity=2)
