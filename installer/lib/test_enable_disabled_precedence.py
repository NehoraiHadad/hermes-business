"""Regression tests for Hermes' disabled-precedence in installer/lib/enable_plugin.py.

`hermes plugins enable` (cmd_enable) adds an id to plugins.enabled AND removes it
from plugins.disabled, because Hermes' disabled list takes precedence — an id in
BOTH lists never loads. Before this fix, is_enabled/--check checked only enabled
membership, so a disabled-only or enabled-AND-disabled config false-passed the
health gate even though Hermes would never mount the plugin. These prove:
  - a disabled-only id reads as NOT healthy, and enabling adds+undisables it,
  - the enabled-AND-disabled false-pass now reads unhealthy and heals on enable,
  - the CLI --check exits non-zero for both shapes.

Run:  python installer/lib/test_enable_disabled_precedence.py
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "enable_plugin.py")
sys.path.insert(0, HERE)

import enable_plugin  # noqa: E402  (imported after sys.path tweak)

import yaml  # noqa: E402

DISABLED_ONLY = "plugins:\n  enabled: []\n  disabled:\n  - business-shell\n"
BOTH_LISTED = "plugins:\n  enabled:\n  - business-shell\n  disabled:\n  - business-shell\n"


class DisabledPrecedence(unittest.TestCase):
    def _config(self, text):
        fd, path = tempfile.mkstemp(suffix=".yaml")
        os.close(fd)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        return path

    def _loaded(self, path):
        with open(path, encoding="utf-8") as handle:
            return yaml.safe_load(handle)

    def _run_check(self, path):
        return subprocess.run(
            [sys.executable, SCRIPT, "--check", path, "business-shell"],
            capture_output=True,
            text=True,
        )

    def test_disabled_only_is_unhealthy_then_enable_removes_it(self):
        path = self._config(DISABLED_ONLY)
        self.assertFalse(enable_plugin.is_enabled(path, "business-shell"))  # health false
        self.assertEqual(enable_plugin.enable(path, "business-shell"), "enabled")
        loaded = self._loaded(path)
        self.assertIn("business-shell", loaded["plugins"]["enabled"])
        self.assertNotIn("business-shell", loaded["plugins"]["disabled"])  # disabled removed
        self.assertTrue(enable_plugin.is_enabled(path, "business-shell"))  # health true

    def test_enabled_and_disabled_false_passes_before_and_heals_on_enable(self):
        path = self._config(BOTH_LISTED)
        self.assertFalse(enable_plugin.is_enabled(path, "business-shell"))  # health false
        # Must rewrite (not short-circuit as already-enabled) to drop the disabled entry.
        self.assertEqual(enable_plugin.enable(path, "business-shell"), "enabled")
        loaded = self._loaded(path)
        self.assertEqual(loaded["plugins"]["enabled"].count("business-shell"), 1)
        self.assertNotIn("business-shell", loaded["plugins"]["disabled"])  # disabled removed
        self.assertTrue(enable_plugin.is_enabled(path, "business-shell"))  # health true

    def test_check_disabled_only_exits_nonzero(self):
        self.assertNotEqual(self._run_check(self._config(DISABLED_ONLY)).returncode, 0)

    def test_check_enabled_and_disabled_exits_nonzero(self):
        self.assertNotEqual(self._run_check(self._config(BOTH_LISTED)).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
