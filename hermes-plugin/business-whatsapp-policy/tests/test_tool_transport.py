"""Transport-guard behaviour: the real fix for the confirmed Telegram egress
bypass. A blocked send returns the engine's ``{"error": ...}`` and the raw
``telegram.Bot`` path is NEVER reached. Fail-closed contract cases live in
``test_tool_transport_contract``; register() disabling in ``_register``.
"""

import asyncio
import types
import unittest
from types import SimpleNamespace

from support import TempHomeCase, write_policy
from telegram_support import write_telegram_policy

from business_whatsapp_policy.tool_transport import install_tool_guards
from business_whatsapp_policy.tool_contract import ToolTransportContractError
from business_whatsapp_policy.egress import _BLOCK_MESSAGES


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class FakeEngine:
    """Stand-in for tools.send_message_tool with the verified signatures."""

    def __init__(self):
        self.telegram_calls = []
        self.platform_calls = []

        async def _send_telegram(token, chat_id, message, media_files=None,
                                 thread_id=None, disable_link_previews=False,
                                 force_document=False):
            self.telegram_calls.append((chat_id, message))
            return {"ok": True}

        async def _send_to_platform(platform, pconfig, chat_id, message, thread_id=None,
                                    media_files=None, force_document=False):
            self.platform_calls.append((platform, chat_id))
            return {"ok": True}

        self.module = types.ModuleType("tools.send_message_tool")
        self.module._send_telegram = _send_telegram
        self.module._send_to_platform = _send_to_platform


class TransportGuard(TempHomeCase, unittest.TestCase):
    def _patch_engine(self, engine=None):
        engine = engine or FakeEngine()
        self.patch_module("tools", SimpleNamespace(send_message_tool=engine.module))
        self.patch_module("tools.send_message_tool", engine.module)
        return engine

    def _install(self):
        engine = self._patch_engine()
        install_tool_guards(lambda: self.home)
        return engine

    # --- Telegram direct-Bot bypass regression ---------------------------
    def test_send_telegram_blocked_read_only_never_calls_bot(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        engine = self._install()
        result = _run(engine.module._send_telegram("tok", "123", "hi"))
        self.assertEqual(result, {"error": _BLOCK_MESSAGES["telegram"]})
        self.assertEqual(engine.telegram_calls, [])  # raw Bot path NOT reached

    def test_send_telegram_authorized_calls_original(self):
        self.patch_home()
        write_telegram_policy(self.home, "selected_chats", ["123"])
        engine = self._install()
        result = _run(engine.module._send_telegram("tok", "123", "hi"))
        self.assertEqual(result, {"ok": True})
        self.assertEqual(engine.telegram_calls, [("123", "hi")])

    # --- family-agnostic chokepoint (what cron imports directly) ---------
    def test_send_to_platform_blocks_telegram_read_only(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        engine = self._install()
        result = _run(engine.module._send_to_platform(
            SimpleNamespace(value="telegram"), object(), "123", "hi"))
        self.assertIn("error", result)
        self.assertEqual(engine.platform_calls, [])

    def test_send_to_platform_blocks_whatsapp_read_only(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        engine = self._install()
        result = _run(engine.module._send_to_platform(
            SimpleNamespace(value="whatsapp"), object(), "15551234567", "hi"))
        self.assertIn("error", result)
        self.assertEqual(engine.platform_calls, [])

    def test_send_to_platform_allows_selected_whatsapp(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["15551234567"])
        engine = self._install()
        result = _run(engine.module._send_to_platform(
            SimpleNamespace(value="whatsapp"), object(), "15551234567", "hi"))
        self.assertEqual(result, {"ok": True})

    def test_non_controlled_platform_passes_through(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        engine = self._install()
        result = _run(engine.module._send_to_platform(
            SimpleNamespace(value="discord"), object(), "C123", "hi"))
        self.assertEqual(result, {"ok": True})
        self.assertEqual(engine.platform_calls, [(SimpleNamespace(value="discord"), "C123")])

    # --- cron shared-chokepoint identity + idempotency -------------------
    def test_cron_style_import_gets_guarded_reference(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        engine = self._install()
        # cron imports _send_to_platform at call time -> the guarded module attr.
        import tools.send_message_tool as smt  # noqa: PLC0415
        guarded = smt._send_to_platform
        result = _run(guarded(SimpleNamespace(value="telegram"), object(), "1", "hi"))
        self.assertIn("error", result)

    def test_install_reports_bound_then_idempotent(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        engine = self._patch_engine()
        first = install_tool_guards(lambda: self.home)  # verifiable binding result
        self.assertEqual(first, {"_send_to_platform": "bound", "_send_telegram": "bound"})
        bound_fn = engine.module._send_to_platform
        again = install_tool_guards(lambda: self.home)  # re-validates ours, rebinds nothing
        self.assertIs(engine.module._send_to_platform, bound_fn)
        self.assertEqual(again, {"_send_to_platform": "already", "_send_telegram": "already"})

    def test_missing_engine_raises_contract_error(self):
        # Import fails -> fail closed (raise) so register() disables the platforms.
        self.patch_home()
        self.patch_module("tools", SimpleNamespace())
        with self.assertRaises(ToolTransportContractError):
            install_tool_guards(lambda: self.home)


if __name__ == "__main__":
    unittest.main(verbosity=2)
