"""pre_tool_call fail-closed guard tests for outbound messaging tools.

No network, no live Hermes: the hook is driven with the exact payload shape
Hermes' get_pre_tool_call_block_message passes (tool_name + args dict), and the
return is asserted against the verified block contract
({"action": "block", "message": <non-empty str>}) or None (pass-through).
"""

import unittest
from types import SimpleNamespace

from support import TempHomeCase, write_policy
from telegram_support import write_telegram_policy

from business_whatsapp_policy.tool_hook import pre_tool_call


def call(tool_name, **args):
    return pre_tool_call(tool_name=tool_name, args=args or {})


class ToolHook(TempHomeCase, unittest.TestCase):
    def _assert_block(self, result):
        self.assertIsInstance(result, dict)
        self.assertEqual(result.get("action"), "block")
        self.assertIsInstance(result.get("message"), str)
        self.assertTrue(result["message"])

    # --- Telegram ---------------------------------------------------------
    def test_read_only_blocks_telegram(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        self._assert_block(call("send_message", target="telegram:123", message="hi"))

    def test_selected_allows_exact_chat_only(self):
        self.patch_home()
        write_telegram_policy(self.home, "selected_chats", ["123"])
        self.assertIsNone(call("send_message", target="telegram:123", message="hi"))
        self._assert_block(call("send_message", target="telegram:999", message="hi"))

    def test_full_access_allows_real_chat_but_denies_malformed(self):
        self.patch_home()
        write_telegram_policy(self.home, "full_access", [])
        self.assertIsNone(call("send_message", target="telegram:-100777", message="hi"))
        # Controlled family + no resolvable destination -> deny even in full_access.
        self._assert_block(call("send_message", target="telegram", message="hi"))

    def test_group_id_and_username_targets(self):
        self.patch_home()
        write_telegram_policy(self.home, "selected_chats", ["-100777", "shop"])
        self.assertIsNone(call("send_message", target="telegram:-100777", message="hi"))
        self.assertIsNone(call("send_message", target="telegram:@Shop", message="hi"))
        self._assert_block(call("send_message", target="telegram:@other", message="hi"))

    # --- WhatsApp ---------------------------------------------------------
    def test_whatsapp_read_only_blocks(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        self._assert_block(call("send_message", target="whatsapp:15551234567", message="hi"))

    def test_whatsapp_selected_allows(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["15551234567"])
        self.assertIsNone(
            call("send_message", target="whatsapp:+1 (555) 123-4567", message="hi")
        )

    # --- aliases / shapes -------------------------------------------------
    def test_messages_send_alias_target_only(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        self._assert_block(pre_tool_call(tool_name="messages_send",
                                         args={"target": "telegram:123", "message": "hi"}))

    def test_explicit_platform_and_chat_keys(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        self._assert_block(pre_tool_call(tool_name="send_message",
                                         args={"platform": "telegram", "to": "123"}))

    def test_list_action_passes_through(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        self.assertIsNone(pre_tool_call(tool_name="send_message",
                                        args={"action": "list", "target": "telegram"}))

    def test_malformed_args_under_send_tool_denies(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        # A send_message with a controlled platform but no chat -> deny.
        self._assert_block(pre_tool_call(tool_name="send_message", args={"target": "telegram"}))
        # args not a dict at all -> treated as empty; platform unknown -> pass.
        self.assertIsNone(pre_tool_call(tool_name="send_message", args=None))

    # --- pass-through -----------------------------------------------------
    def test_unrelated_tool_passes(self):
        self.patch_home()
        self.assertIsNone(call("read_file", path="/tmp/x"))

    def test_non_controlled_platform_passes(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        self.assertIsNone(call("send_message", target="discord:#bot-home", message="hi"))
        self.assertIsNone(call("send_message", target="slack:C123", message="hi"))

    # --- fail closed on policy-load error --------------------------------
    def test_policy_load_error_blocks(self):
        broken = SimpleNamespace(
            get_hermes_home=lambda: (_ for _ in ()).throw(OSError("home unavailable"))
        )
        self.patch_module("hermes_cli", SimpleNamespace(config=broken))
        self.patch_module("hermes_cli.config", broken)
        self._assert_block(call("send_message", target="telegram:123", message="hi"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
