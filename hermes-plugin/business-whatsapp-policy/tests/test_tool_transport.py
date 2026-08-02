import asyncio
import types
import unittest
from types import SimpleNamespace

from support import TempHomeCase, write_policy
from business_whatsapp_policy.tool_transport import install_tool_guards


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class FakeEngine:
    def __init__(self):
        self.calls = []

        async def send(platform, pconfig, chat_id, message, **_kwargs):
            self.calls.append((getattr(platform, "value", platform), chat_id))
            return {"ok": True}

        async def telegram(token, chat_id, message, **_kwargs):
            self.calls.append(("telegram-direct", chat_id))
            return {"ok": True}

        self.module = types.ModuleType("tools.send_message_tool")
        self.module._send_to_platform = send
        self.module._send_telegram = telegram


class TransportGuard(TempHomeCase, unittest.TestCase):
    def install(self):
        engine = FakeEngine()
        self.patch_module("tools", SimpleNamespace(send_message_tool=engine.module))
        self.patch_module("tools.send_message_tool", engine.module)
        result = install_tool_guards(lambda: self.home)
        return engine, result

    def test_whatsapp_read_only_blocks(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        engine, _ = self.install()
        result = run(engine.module._send_to_platform("whatsapp", object(), "123", "hi"))
        self.assertIn("error", result)
        self.assertEqual(engine.calls, [])

    def test_whatsapp_selected_allows(self):
        self.patch_home()
        write_policy(self.home, "selected_chats", ["123"])
        engine, _ = self.install()
        self.assertEqual(run(engine.module._send_to_platform("whatsapp", object(), "123", "hi")), {"ok": True})

    def test_telegram_paths_are_not_wrapped(self):
        self.patch_home()
        write_policy(self.home, "read_only", [])
        engine, _ = self.install()
        direct = engine.module._send_telegram
        self.assertEqual(run(direct("token", "123", "hi")), {"ok": True})
        self.assertEqual(run(engine.module._send_to_platform("telegram", object(), "123", "hi")), {"ok": True})

    def test_install_is_idempotent(self):
        self.patch_home()
        engine, first = self.install()
        self.assertEqual(first, {"_send_to_platform": "bound"})
        bound = engine.module._send_to_platform
        self.assertEqual(install_tool_guards(lambda: self.home), {"_send_to_platform": "already"})
        self.assertIs(engine.module._send_to_platform, bound)


if __name__ == "__main__":
    unittest.main(verbosity=2)
