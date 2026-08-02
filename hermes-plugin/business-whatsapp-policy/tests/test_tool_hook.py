import unittest

from support import TempHomeCase, write_policy
from business_whatsapp_policy.tool_hook import pre_tool_call


def call(tool_name, **args):
    return pre_tool_call(tool_name=tool_name, args=args or {})


class ToolHook(TempHomeCase, unittest.TestCase):
    def assert_blocked(self, result):
        self.assertEqual(result.get("action"), "block")
        self.assertTrue(result.get("message"))

    def test_whatsapp_read_only_blocks(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        self.assert_blocked(call("send_message", target="whatsapp:15551234567"))

    def test_whatsapp_selected_allows(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["15551234567"])
        self.assertIsNone(call("send_message", target="whatsapp:+1 (555) 123-4567"))

    def test_telegram_always_passes_to_native_hermes(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        self.assertIsNone(call("send_message", target="telegram:123"))

    def test_list_and_unrelated_tools_pass(self):
        self.patch_home()
        self.assertIsNone(pre_tool_call(tool_name="send_message", args={"action": "list"}))
        self.assertIsNone(call("read_file", path="x"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
