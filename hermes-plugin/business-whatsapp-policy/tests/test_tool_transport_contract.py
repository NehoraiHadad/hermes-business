"""Fail-closed contract for ``install_tool_guards``: every way the send_message
surface can drift must RAISE ``ToolTransportContractError`` (a subclass of
``AdapterContractError``) instead of binding a half-guard or silently skipping.
Failures are injected at import / missing-attr (first & second) / non-async /
signature-drift / assignment stages, and a foreign guard flag is rejected.

No network, no live Hermes.
"""

import types
import unittest
from types import SimpleNamespace

from support import TempHomeCase
from telegram_support import write_telegram_policy

from business_whatsapp_policy.tool_transport import install_tool_guards, _FACTORIES
from business_whatsapp_policy.tool_contract import (
    GUARD_FLAG,
    ToolTransportContractError,
)
from business_whatsapp_policy.contract import AdapterContractError


async def _send_to_platform(platform, pconfig, chat_id, message, thread_id=None):
    return {"ok": True}


async def _send_telegram(token, chat_id, message, media_files=None):
    return {"ok": True}


def _module(**attrs):
    mod = types.ModuleType("tools.send_message_tool")
    for name, value in attrs.items():
        setattr(mod, name, value)
    return mod


class RaisingModule(types.ModuleType):
    """A module whose ``__setattr__`` raises for one named attribute — models an
    assignment-stage bind failure so rollback of the first attr is exercised."""

    def __init__(self, fail_on, **attrs):
        super().__init__("tools.send_message_tool")
        self._fail_on = fail_on
        for name, value in attrs.items():
            super().__setattr__(name, value)

    def __setattr__(self, name, value):
        if name == getattr(self, "_fail_on", None):
            raise RuntimeError(f"cannot assign {name}")
        super().__setattr__(name, value)


class Contract(TempHomeCase, unittest.TestCase):
    def _patch(self, module):
        self.patch_module("tools", SimpleNamespace(send_message_tool=module))
        self.patch_module("tools.send_message_tool", module)
        return module

    def _run(self):
        self.patch_home()
        write_telegram_policy(self.home, "read_only", [])
        return install_tool_guards(lambda: self.home)

    def test_error_is_adapter_contract_subclass(self):
        # register() catches AdapterContractError -> the transport error rides the
        # same single fail-closed path (disable platforms), no separate branch.
        self.assertTrue(issubclass(ToolTransportContractError, AdapterContractError))

    def test_import_failure_raises(self):
        self.patch_home()
        self.patch_module("tools", SimpleNamespace())  # no send_message_tool submodule
        with self.assertRaises(ToolTransportContractError):
            install_tool_guards(lambda: self.home)

    def test_missing_first_attr_raises(self):
        self._patch(_module(_send_telegram=_send_telegram))  # no _send_to_platform
        with self.assertRaises(ToolTransportContractError):
            self._run()

    def test_missing_second_attr_raises(self):
        self._patch(_module(_send_to_platform=_send_to_platform))  # no _send_telegram
        with self.assertRaises(ToolTransportContractError):
            self._run()

    def test_non_async_target_raises(self):
        def _sync(platform, pconfig, chat_id, message):
            return {"ok": True}

        self._patch(_module(_send_to_platform=_sync, _send_telegram=_send_telegram))
        with self.assertRaises(ToolTransportContractError):
            self._run()

    def test_signature_drift_missing_param_raises(self):
        async def _drifted(platform, pconfig, message):  # lost chat_id
            return {"ok": True}

        self._patch(_module(_send_to_platform=_drifted, _send_telegram=_send_telegram))
        with self.assertRaises(ToolTransportContractError):
            self._run()

    def test_foreign_guard_flag_rejected(self):
        # A function that merely carries our flag name but is not ours (no stamped
        # params metadata) must NOT count as already-guarded -> fail closed.
        async def foreign(platform, pconfig, chat_id, message):
            return {"ok": True}

        setattr(foreign, GUARD_FLAG, True)
        self._patch(_module(_send_to_platform=foreign, _send_telegram=_send_telegram))
        with self.assertRaises(ToolTransportContractError):
            self._run()

    def test_second_assignment_failure_rolls_back_first(self):
        module = self._patch(
            RaisingModule(
                "_send_telegram",
                _send_to_platform=_send_to_platform,
                _send_telegram=_send_telegram,
            )
        )
        original = module._send_to_platform
        with self.assertRaises(ToolTransportContractError):
            self._run()
        # First chokepoint restored to the ORIGINAL, unguarded function — no
        # half-bound surface where one path is guarded and the other is not.
        self.assertIs(module._send_to_platform, original)
        self.assertFalse(getattr(module._send_to_platform, GUARD_FLAG, False))

    def test_factories_cover_both_required_chokepoints(self):
        self.assertEqual(set(_FACTORIES), {"_send_to_platform", "_send_telegram"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
