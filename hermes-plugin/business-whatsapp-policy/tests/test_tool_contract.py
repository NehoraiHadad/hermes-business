"""Drift contract for the tool-level fix, against the *installed* Hermes.

Proves the shapes this plugin's fix binds to still hold in the installed Hermes,
so the guard cannot silently become a no-op:

  * ``tools.send_message_tool._send_to_platform`` / ``_send_telegram`` still
    expose the parameters the transport guard reads (``platform`` / ``chat_id``).
  * ``hermes_cli.plugins.get_pre_tool_call_block_message`` still honors the
    ``{"action": "block", "message": <non-empty str>}`` shape and ignores a
    malformed return (fail-closed on drift — a well-formed block is the only
    thing that blocks).

SKIPS when Hermes is not installed; FAILS when installed and drifted. Reuses the
in-venv probe discovery from :mod:`installed_probe`.
"""

import json
import subprocess
import unittest

from installed_probe import hermes_agent_root, venv_python
from business_whatsapp_policy.tool_contract import TRANSPORT_TARGETS

PROBE = r"""
import json, inspect, importlib
out = {"errors": {}}
try:
    smt = importlib.import_module("tools.send_message_tool")
    out["send_to_platform_params"] = list(inspect.signature(smt._send_to_platform).parameters)
    out["send_telegram_params"] = list(inspect.signature(smt._send_telegram).parameters)
except Exception as e:
    out["errors"]["engine"] = repr(e)
try:
    # Functionally exercise the installed pre_tool_call resolver end-to-end:
    # register a hook returning our exact block shape and confirm it blocks,
    # then a malformed return and confirm it is ignored (fail-closed on drift —
    # only a well-formed block, which is all our hook ever emits, can block).
    plugins = importlib.import_module("hermes_cli.plugins")
    resolver = getattr(plugins, "get_pre_tool_call_block_message", None)
    out["has_resolver"] = resolver is not None
    if resolver is not None:
        mgr = plugins.get_plugin_manager()
        mgr._hooks["pre_tool_call"] = [lambda **kw: {"action": "block", "message": "BUSINESS_BLOCK"}]
        out["block_result"] = resolver("send_message", {"target": "telegram:1", "message": "x"})
        mgr._hooks["pre_tool_call"] = [lambda **kw: {"nope": "bar"}]
        out["malformed_result"] = resolver("send_message", {"target": "telegram:1"})
        mgr._hooks["pre_tool_call"] = []
except Exception as e:
    out["errors"]["resolver"] = repr(e)
try:
    from tools.registry import registry
    names = set(getattr(registry, "_tools", {}) or {})
    out["send_message_registered"] = "send_message" in names
except Exception as e:
    out["errors"]["registry"] = repr(e)
print(json.dumps(out))
"""


def _load():
    root = hermes_agent_root()
    if root is None:
        raise unittest.SkipTest("Hermes is not installed; skipping tool contract")
    python = venv_python(root)
    if python is None:
        raise unittest.SkipTest("Hermes venv interpreter not found")
    try:
        proc = subprocess.run([str(python), "-c", PROBE], capture_output=True,
                              text=True, timeout=180, cwd=str(root))
    except Exception as exc:  # pragma: no cover - environment dependent
        raise unittest.SkipTest(f"Could not run Hermes probe: {exc}")
    lines = (proc.stdout or "").strip().splitlines()
    if not lines:
        raise unittest.SkipTest(f"probe produced no output (stderr: {proc.stderr[-400:]!r})")
    return json.loads(lines[-1])


class ToolContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = _load()

    def test_transport_signatures_present(self):
        engine_err = self.data.get("errors", {}).get("engine")
        if engine_err:
            self.fail(f"send_message engine import failed: {engine_err}")
        for func, params in TRANSPORT_TARGETS.items():
            key = "send_to_platform_params" if func == "_send_to_platform" else "send_telegram_params"
            present = set(self.data.get(key, []))
            missing = set(params) - present
            self.assertEqual(missing, set(), f"{func} lost params {missing}; re-verify guard")

    def test_pre_tool_call_block_contract_holds(self):
        if self.data.get("errors", {}).get("resolver"):
            self.fail(f"resolver exercise failed: {self.data['errors']['resolver']}")
        self.assertTrue(self.data.get("has_resolver"),
                        "get_pre_tool_call_block_message missing; hook cannot block")
        # A well-formed block is honored end-to-end by the installed resolver...
        self.assertEqual(self.data.get("block_result"), "BUSINESS_BLOCK",
                         "installed pre_tool_call no longer honors {action:block, message}")
        # ...and a malformed return is ignored (so our hook, which only ever
        # emits that exact block shape or None, is the sole thing that blocks).
        self.assertIsNone(self.data.get("malformed_result"),
                          "installed pre_tool_call no longer ignores malformed returns")

    def test_send_message_not_a_model_tool(self):
        # Documents the verified premise: the confirmed bypass does NOT flow
        # through pre_tool_call, so the transport guard is the real fix.
        if "send_message_registered" not in self.data:
            self.skipTest("tool registry not introspectable")
        self.assertFalse(self.data["send_message_registered"],
                         "send_message became a model tool; the pre_tool_call hook now "
                         "also covers it directly — re-verify the fix's scope.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
