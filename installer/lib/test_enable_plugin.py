"""Regression tests for installer/lib/enable_plugin.py.

Prove the config-enable helper (the PowerShell bootstrap path) fails closed:
  - a malformed / non-mapping config.yaml is NEVER clobbered (byte-for-byte),
  - `enable` never claims success on such a config,
  - an already-enabled config is not rewritten (comments/format survive),
  - and the CLI leaks NO parser/config-derived text or secrets on stderr — only a
    stable failure CLASS (fixing the noted PyYAML YAMLError traceback leak).

Run:  python installer/lib/test_enable_plugin.py
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

# A config that both fails to parse AND carries a secret-shaped token, so we can
# assert the token never surfaces in any diagnostic the installer would log.
SECRET = "sk-super-secret-token-DO-NOT-LEAK"
MALFORMED = f'plugins:\n  enabled: [business-shell\napi_key: "{SECRET}\n'
NON_MAPPING = "- business-shell\n- other\n"


class EnablePluginRegression(unittest.TestCase):
    def _config(self, text):
        fd, path = tempfile.mkstemp(suffix=".yaml")
        os.close(fd)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        return path

    def _bytes(self, path):
        with open(path, "rb") as handle:
            return handle.read()

    def _run(self, *args):
        return subprocess.run(
            [sys.executable, SCRIPT, *args],
            capture_output=True,
            text=True,
        )

    def test_enable_raises_on_malformed_and_does_not_write(self):
        path = self._config(MALFORMED)
        before = self._bytes(path)
        with self.assertRaises(yaml.YAMLError):
            enable_plugin.enable(path, "business-shell")
        self.assertEqual(self._bytes(path), before)  # byte-for-byte

    def test_enable_raises_on_non_mapping_and_does_not_write(self):
        path = self._config(NON_MAPPING)
        before = self._bytes(path)
        with self.assertRaises(ValueError):
            enable_plugin.enable(path, "business-shell")
        self.assertEqual(self._bytes(path), before)

    def test_already_enabled_is_not_rewritten(self):
        path = self._config("plugins:\n  enabled:\n  - business-shell\n  disabled: []\n")
        before = self._bytes(path)
        self.assertEqual(enable_plugin.enable(path, "business-shell"), "already-enabled")
        self.assertEqual(self._bytes(path), before)

    def test_enable_adds_and_preserves_other_keys(self):
        path = self._config("model: gpt-test\nplugins:\n  enabled:\n  - business-whatsapp-policy\n")
        self.assertEqual(enable_plugin.enable(path, "business-shell"), "enabled")
        with open(path, encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle)
        self.assertIn("business-shell", loaded["plugins"]["enabled"])
        self.assertIn("business-whatsapp-policy", loaded["plugins"]["enabled"])
        self.assertEqual(loaded["model"], "gpt-test")

    def test_cli_malformed_exits_nonzero_preserves_and_never_leaks(self):
        path = self._config(MALFORMED)
        before = self._bytes(path)
        result = self._run(path, "business-shell")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self._bytes(path), before)  # not clobbered
        combined = result.stdout + result.stderr
        self.assertNotIn(SECRET, combined)  # no secret leak
        self.assertNotIn("business-shell", result.stderr)  # no config text echoed
        self.assertIn("not valid YAML", result.stderr)  # useful failure CLASS only

    def test_cli_non_mapping_exits_nonzero_and_preserves(self):
        path = self._config(NON_MAPPING)
        before = self._bytes(path)
        result = self._run(path, "business-shell")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self._bytes(path), before)
        self.assertIn("not a mapping", result.stderr)

    def test_check_malformed_reports_only_class(self):
        path = self._config(MALFORMED)
        result = self._run("--check", path, "business-shell")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertIn("not valid YAML", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
