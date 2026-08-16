import json
import sys
import types
import unittest

from support import ArchiveHome
import community_archive
from community_archive.tool import ARCHIVE_SCHEMA, archive_available, handle_archive


class FakeContext:
    def __init__(self):
        self.calls = []

    def register_tool(self, **kwargs):
        self.calls.append(kwargs)


class ToolTests(ArchiveHome, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.previous = sys.modules.get("hermes_constants")
        sys.modules["hermes_constants"] = types.SimpleNamespace(get_process_hermes_home=lambda: self.home)

    def tearDown(self):
        if self.previous is None:
            sys.modules.pop("hermes_constants", None)
        else:
            sys.modules["hermes_constants"] = self.previous
        super().tearDown()

    def test_schema_exposes_no_database_or_profile_selector(self):
        properties = ARCHIVE_SCHEMA["parameters"]["properties"]
        self.assertNotIn("db_path", properties)
        self.assertNotIn("profile", properties)
        self.assertFalse(ARCHIVE_SCHEMA["parameters"]["additionalProperties"])

    def test_registers_one_scoped_toolset(self):
        ctx = FakeContext()
        community_archive.register(ctx)
        self.assertEqual(len(ctx.calls), 1)
        self.assertEqual(ctx.calls[0]["name"], "community_archive")
        self.assertEqual(ctx.calls[0]["toolset"], "community_archive")

    def test_availability_and_handler_use_process_home(self):
        self.session("main", "120363000000000001@g.us")
        self.message("main", "[דנה|u1] hello", 1700000000, message_id="m1")
        self.assertTrue(archive_available())
        result = json.loads(handle_archive({"action": "recent"}))
        self.assertTrue(result["ok"])
        self.assertEqual(result["messages"][0]["provenance"]["sender_id"], "u1")

        rejected = json.loads(handle_archive({
            "action": "recent",
            "db_path": "C:/someone-elses-state.db",
            "profile": "admin",
        }))
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["error"], "unsupported tool arguments")
        self.assertNotIn("someone", rejected["error"])

    def test_policy_error_is_bounded_and_does_not_reveal_filesystem_path(self):
        (self.home / "community" / "archive-policy.json").unlink()
        result = json.loads(handle_archive({"action": "recent"}))
        self.assertFalse(result["ok"])
        self.assertNotIn(str(self.home), result["error"])
        self.assertFalse(archive_available())


if __name__ == "__main__":
    unittest.main(verbosity=2)
