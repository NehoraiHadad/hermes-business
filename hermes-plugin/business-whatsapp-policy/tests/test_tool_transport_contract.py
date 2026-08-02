import types
import unittest
from types import SimpleNamespace

from support import TempHomeCase
from business_whatsapp_policy.contract import AdapterContractError
from business_whatsapp_policy.tool_contract import GUARD_FLAG, ToolTransportContractError
from business_whatsapp_policy.tool_transport import _FACTORIES, install_tool_guards


async def send(platform, pconfig, chat_id, message):
    return {"ok": True}


class Contract(TempHomeCase, unittest.TestCase):
    def patch_engine(self, fn=send):
        module = types.ModuleType("tools.send_message_tool")
        module._send_to_platform = fn
        self.patch_module("tools", SimpleNamespace(send_message_tool=module))
        self.patch_module("tools.send_message_tool", module)

    def test_contract_error_uses_existing_fail_closed_path(self):
        self.assertTrue(issubclass(ToolTransportContractError, AdapterContractError))

    def test_only_generic_platform_chokepoint_is_wrapped(self):
        self.assertEqual(set(_FACTORIES), {"_send_to_platform"})

    def test_missing_or_drifted_target_raises(self):
        self.patch_home()
        self.patch_module("tools", SimpleNamespace())
        with self.assertRaises(ToolTransportContractError):
            install_tool_guards(lambda: self.home)

        async def drifted(platform, pconfig, message):
            return {"ok": True}

        self.patch_engine(drifted)
        with self.assertRaises(ToolTransportContractError):
            install_tool_guards(lambda: self.home)

    def test_foreign_guard_flag_is_rejected(self):
        self.patch_home()

        async def foreign(platform, pconfig, chat_id, message):
            return {"ok": True}

        setattr(foreign, GUARD_FLAG, True)
        self.patch_engine(foreign)
        with self.assertRaises(ToolTransportContractError):
            install_tool_guards(lambda: self.home)


if __name__ == "__main__":
    unittest.main(verbosity=2)
