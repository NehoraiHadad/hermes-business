"""Version contract tests against the *installed* Hermes source.

These tests introspect the real adapters shipped with the installed Hermes
(v0.19.1) — using that install's own venv interpreter so heavy platform SDK
imports resolve — and assert the surfaces this plugin guards still match the
verified contract in :mod:`business_whatsapp_policy.transport`.

They SKIP when Hermes is not installed (e.g. CI without a Hermes home) and
FAIL when it is installed but the guarded surface has drifted — which is
exactly when the runtime guard would start disabling connections.

Discovery + the in-venv probe live in :mod:`installed_probe`; this module
holds only the contract assertions.
"""

import unittest

from business_whatsapp_policy.transport import (
    INTERACTIVE_AUTH_METHOD,
    OUTBOUND_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    is_supported_version,
)
from business_whatsapp_policy.telegram_contract import (
    INTERACTIVE_AUTH_METHOD as TELEGRAM_INTERACTIVE_AUTH_METHOD,
    OUTBOUND_METHODS as TELEGRAM_OUTBOUND_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS as TELEGRAM_REQUIRED_ENTRY_FIELDS,
)
from installed_probe import load_installed_surface, outbound_public


class InstalledSurfaceContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_installed_surface()

    def test_installed_version_is_supported(self):
        version = self.data.get("version")
        if not version:
            self.skipTest("hermes-agent version unavailable")
        self.assertTrue(
            is_supported_version(version),
            f"installed Hermes {version} is outside the verified contract "
            f"{sorted(OUTBOUND_METHODS)!r}; re-verify the adapter surface",
        )

    def test_platform_entry_fields_present(self):
        fields = self.data.get("entry_fields")
        if fields is None:
            self.fail(f"registry import failed: {self.data['errors'].get('registry')}")
        missing = REQUIRED_PLATFORM_ENTRY_FIELDS - set(fields)
        self.assertEqual(missing, set(), f"PlatformEntry lost fields: {missing}")

    def test_cloud_outbound_surface_is_fully_guarded(self):
        methods = self.data.get("cloud_methods")
        if methods is None:
            self.fail(f"cloud import failed: {self.data['errors'].get('cloud')}")
        self.assertTrue(self.data.get("cloud_has_check"))
        self.assertTrue(
            self.data.get("cloud_has_interactive"),
            f"Cloud lost {INTERACTIVE_AUTH_METHOD}; interactive taps would bypass policy",
        )
        unguarded = outbound_public(methods) - OUTBOUND_METHODS["cloud"]
        self.assertEqual(
            unguarded,
            set(),
            f"Cloud adapter has UNGUARDED outbound methods: {sorted(unguarded)}",
        )

    def test_baileys_outbound_surface_is_fully_guarded(self):
        methods = self.data.get("baileys_own_methods")
        if methods is None:
            self.fail(f"baileys import failed: {self.data['errors'].get('baileys')}")
        self.assertTrue(self.data.get("baileys_has_standalone"))
        self.assertTrue(self.data.get("baileys_has_register"))
        unguarded = outbound_public(methods) - OUTBOUND_METHODS["baileys"]
        self.assertEqual(
            unguarded,
            set(),
            f"Baileys adapter has UNGUARDED outbound methods: {sorted(unguarded)}",
        )

    def test_telegram_outbound_surface_is_fully_guarded(self):
        methods = self.data.get("telegram_own_methods")
        if methods is None:
            self.fail(f"telegram import failed: {self.data['errors'].get('telegram')}")
        self.assertTrue(self.data.get("telegram_has_standalone"))
        self.assertTrue(self.data.get("telegram_has_register"))
        self.assertTrue(
            self.data.get("telegram_has_callback_auth"),
            f"Telegram lost {TELEGRAM_INTERACTIVE_AUTH_METHOD}; taps would bypass policy",
        )
        unguarded = outbound_public(methods) - TELEGRAM_OUTBOUND_METHODS
        self.assertEqual(
            unguarded,
            set(),
            f"Telegram adapter has UNGUARDED outbound methods: {sorted(unguarded)}",
        )

    def test_telegram_platform_entry_fields_present(self):
        fields = self.data.get("entry_fields")
        if fields is None:
            self.fail(f"registry import failed: {self.data['errors'].get('registry')}")
        missing = TELEGRAM_REQUIRED_ENTRY_FIELDS - set(fields)
        self.assertEqual(missing, set(), f"Telegram PlatformEntry lost fields: {missing}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
