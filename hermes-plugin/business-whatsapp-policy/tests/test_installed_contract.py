"""Version contract tests against the *installed* Hermes source.

These tests introspect the real adapters shipped with the installed Hermes
(v0.19.1) — using that install's own venv interpreter so heavy platform SDK
imports resolve — and assert the surfaces this plugin guards still match the
verified contract in :mod:`business_whatsapp_policy.transport`.

They SKIP when Hermes is not installed (e.g. CI without a Hermes home) and
FAIL when it is installed but the guarded surface has drifted — which is
exactly when the runtime guard would start disabling connections.
"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from business_whatsapp_policy.transport import (
    INTERACTIVE_AUTH_METHOD,
    OUTBOUND_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    is_supported_version,
)

# Outbound-name prefixes mirror the runtime drift tripwire.
_OUTBOUND_PREFIXES = ("send", "edit", "delete", "post", "broadcast", "forward")


def _hermes_agent_root() -> Path | None:
    candidates = []
    home = os.environ.get("HERMES_HOME")
    if home:
        candidates.append(Path(home) / "hermes-agent")
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(Path(local) / "hermes" / "hermes-agent")
    candidates.append(Path.home() / ".hermes" / "hermes-agent")
    for path in candidates:
        if (path / "gateway" / "platform_registry.py").exists():
            return path
    return None


def _venv_python(root: Path) -> Path | None:
    for rel in ("venv/Scripts/python.exe", "venv/bin/python"):
        candidate = root / rel
        if candidate.exists():
            return candidate
    return None


# A self-contained probe run *inside* the Hermes venv. It imports the real
# adapters and prints a JSON description of the surfaces we depend on.
_PROBE = r"""
import json, importlib
out = {"errors": {}}
try:
    import importlib.metadata as md
    out["version"] = md.version("hermes-agent")
except Exception as e:
    out["errors"]["version"] = repr(e)
try:
    reg = importlib.import_module("gateway.platform_registry")
    import dataclasses
    out["entry_fields"] = [f.name for f in dataclasses.fields(reg.PlatformEntry)]
except Exception as e:
    out["errors"]["registry"] = repr(e)
try:
    wc = importlib.import_module("gateway.platforms.whatsapp_cloud")
    cls = wc.WhatsAppCloudAdapter
    out["cloud_methods"] = [n for n in dir(cls) if callable(getattr(cls, n, None))]
    out["cloud_has_check"] = hasattr(wc, "check_whatsapp_cloud_requirements")
    out["cloud_has_interactive"] = hasattr(cls, "_is_interactive_sender_authorized")
except Exception as e:
    out["errors"]["cloud"] = repr(e)
try:
    mod = importlib.import_module("plugins.platforms.whatsapp.adapter")
    cls = mod.WhatsAppAdapter
    # Only the concrete class's own methods matter for the drift tripwire.
    own = {}
    for k in cls.__mro__:
        if k.__name__ in ("BasePlatformAdapter", "WhatsAppBehaviorMixin", "object"):
            continue
        own.update({n: v for n, v in vars(k).items()})
    out["baileys_own_methods"] = [n for n, v in own.items() if callable(v)]
    out["baileys_has_standalone"] = hasattr(mod, "_standalone_send")
    out["baileys_has_register"] = hasattr(mod, "register")
except Exception as e:
    out["errors"]["baileys"] = repr(e)
print(json.dumps(out))
"""


def _outbound_public(names) -> set[str]:
    return {
        n
        for n in names
        if not n.startswith("_")
        and any(n.startswith(p) for p in _OUTBOUND_PREFIXES)
    }


class InstalledSurfaceContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = _hermes_agent_root()
        if root is None:
            raise unittest.SkipTest("Hermes is not installed; skipping version contract")
        python = _venv_python(root)
        if python is None:
            raise unittest.SkipTest("Hermes venv interpreter not found")
        try:
            proc = subprocess.run(
                [str(python), "-c", _PROBE],
                capture_output=True,
                text=True,
                timeout=180,
                cwd=str(root),
            )
        except Exception as exc:  # pragma: no cover - environment dependent
            raise unittest.SkipTest(f"Could not run Hermes probe: {exc}")
        stdout = (proc.stdout or "").strip().splitlines()
        if not stdout:
            raise unittest.SkipTest(
                f"Hermes probe produced no output (stderr: {proc.stderr[-400:]!r})"
            )
        cls.data = json.loads(stdout[-1])

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
        unguarded = _outbound_public(methods) - OUTBOUND_METHODS["cloud"]
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
        unguarded = _outbound_public(methods) - OUTBOUND_METHODS["baileys"]
        self.assertEqual(
            unguarded,
            set(),
            f"Baileys adapter has UNGUARDED outbound methods: {sorted(unguarded)}",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
