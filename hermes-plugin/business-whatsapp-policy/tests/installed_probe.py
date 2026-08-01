"""Installed-Hermes surface probe shared by the version-contract tests.

Locates the installed Hermes (v0.19.1) and its venv interpreter, runs a
self-contained probe *inside* that venv so heavy platform SDK imports resolve,
and returns a JSON description of the adapter surfaces this plugin guards. The
contract assertions live in the test module; this file owns discovery + probe.
"""

import json
import os
import subprocess
import unittest
from pathlib import Path

# Outbound-name prefixes mirror the runtime drift tripwire.
OUTBOUND_PREFIXES = ("send", "edit", "delete", "post", "broadcast", "forward")

# A self-contained probe run *inside* the Hermes venv. It imports the real
# adapters and prints a JSON description of the surfaces we depend on.
PROBE = r"""
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
try:
    mod = importlib.import_module("plugins.platforms.telegram.adapter")
    cls = mod.TelegramAdapter
    own = {}
    for k in cls.__mro__:
        if k.__name__ in ("BasePlatformAdapter", "ABC", "object"):
            continue
        own.update({n: v for n, v in vars(k).items()})
    out["telegram_own_methods"] = [n for n, v in own.items() if callable(v)]
    out["telegram_has_standalone"] = hasattr(mod, "_standalone_send")
    out["telegram_has_register"] = hasattr(mod, "register")
    out["telegram_has_callback_auth"] = hasattr(cls, "_is_callback_user_authorized")
except Exception as e:
    out["errors"]["telegram"] = repr(e)
print(json.dumps(out))
"""


def hermes_agent_root() -> "Path | None":
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


def venv_python(root: Path) -> "Path | None":
    for rel in ("venv/Scripts/python.exe", "venv/bin/python"):
        candidate = root / rel
        if candidate.exists():
            return candidate
    return None


def outbound_public(names) -> "set[str]":
    return {
        n
        for n in names
        if not n.startswith("_")
        and any(n.startswith(p) for p in OUTBOUND_PREFIXES)
    }


def load_installed_surface() -> dict:
    """Run the probe inside the installed Hermes venv and return its JSON, or
    raise unittest.SkipTest when Hermes is not installed / not runnable."""
    root = hermes_agent_root()
    if root is None:
        raise unittest.SkipTest("Hermes is not installed; skipping version contract")
    python = venv_python(root)
    if python is None:
        raise unittest.SkipTest("Hermes venv interpreter not found")
    try:
        proc = subprocess.run(
            [str(python), "-c", PROBE],
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
    return json.loads(stdout[-1])
