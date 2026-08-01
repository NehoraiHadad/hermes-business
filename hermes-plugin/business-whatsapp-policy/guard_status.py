"""Live runtime guard-status heartbeat — written FROM the dispatch process.

Why this exists (architecture): in Hermes 0.19.x the messaging hooks
(``pre_gateway_dispatch`` / ``pre_tool_call``) and the ``send_message`` transport
monkeypatch are dispatched inside the ``hermes gateway run`` process, while the ONLY
place a plugin can mount an HTTP route (``dashboard/plugin_api.py`` →
``/api/plugins/<name>``) lives in the SEPARATE ``hermes serve`` (web_server) process.
A serve-process route would therefore report the serve process's ``PluginManager._hooks``
— not the gateway's — and could not prove that enforcement is live where messages are
actually dispatched. A static install/enable receipt is likewise insufficient (it proves a
file was copied, not that guards are bound in a live process).

So the only trustworthy proof is one produced FROM the dispatch process itself. On
``register()`` this module:

  * generates a per-process START NONCE (``os.urandom``),
  * INTROSPECTS the live process — the ``send_message`` transport chokepoints must carry
    our guard flag, and the messaging hooks must be registered — and reports
    ``enforcing: true`` ONLY when both are actually bound,
  * captures pid / process-role / plugin version / policy modes / guard families / hook
    names, and
  * writes a role-scoped heartbeat JSON into ``<HERMES_HOME>/business-state`` and keeps
    ``updated_at`` fresh via a daemon refresh thread.

The desktop reader (electron/whatsapp-guard.cjs) then requires a FRESH, gateway-role
heartbeat with a LIVE pid and ``enforcing: true`` — otherwise it fails closed to BLOCKED.
The refreshing timestamp + live pid + start nonce make this a live challenge, not a
static receipt: a dead/reloaded gateway stops refreshing and its heartbeat goes stale.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Mapping, Optional

logger = logging.getLogger(__name__)

GUARD_STATUS_SCHEMA = 1
# The two enforcement doors that must be live for "enforcing" to be true.
REQUIRED_HOOK = "pre_gateway_dispatch"
GUARD_FAMILIES = ("whatsapp", "whatsapp_cloud", "telegram")
# The transport chokepoints the monkeypatch must have bound in THIS process.
TRANSPORT_CHOKEPOINTS = ("_send_to_platform", "_send_telegram")
# The reader treats a heartbeat older than this (no refresh) as dead → BLOCKED.
HEARTBEAT_TTL_SECONDS = 90
_REFRESH_INTERVAL_SECONDS = 20

_started_lock = threading.Lock()
_started = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def process_role(argv: Optional[Iterable[str]] = None) -> str:
    """Classify the host process from its argv. The gateway (``hermes gateway run``)
    is the messaging dispatch process; ``serve``/``dashboard`` is the web backend."""
    args = [str(a).lower() for a in (argv if argv is not None else sys.argv)]
    joined = " ".join(args)
    if "gateway" in joined:
        return "gateway"
    if "serve" in joined or "dashboard" in joined:
        return "serve"
    # A stronger signal: the gateway runner module is imported only in that process.
    if "gateway.run" in sys.modules:
        return "gateway"
    return "other"


def plugin_version(default: str = "0.0.0") -> str:
    """Read the plugin version from the co-located plugin.yaml without importing yaml."""
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plugin.yaml")
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if stripped.startswith("version:"):
                    return stripped.split(":", 1)[1].strip().strip("'\"") or default
    except Exception:
        pass
    return default


def transport_bound() -> bool:
    """LIVE introspection: are BOTH send_message chokepoints wrapped by OUR guard in
    this process? Reads the guard flag the monkeypatch stamps. Fail-closed on any error."""
    try:
        from .tool_contract import GUARD_FLAG
        import tools.send_message_tool as smt  # type: ignore
    except Exception:
        return False
    for name in TRANSPORT_CHOKEPOINTS:
        fn = getattr(smt, name, None)
        if fn is None or not getattr(fn, GUARD_FLAG, False):
            return False
    return True


def registered_hooks(declared: Iterable[str] = ()) -> list:
    """Hook names OUR package has registered in THIS process's plugin manager. Falls back
    to the declared names (register() just registered them here) if introspection fails."""
    package = __name__.rsplit(".", 1)[0]
    try:
        from hermes_cli.plugins import get_plugin_manager  # type: ignore

        pm = get_plugin_manager()
        hooks_map = getattr(pm, "_hooks", {}) or {}
        found = []
        for name, callbacks in hooks_map.items():
            for cb in callbacks or []:
                mod = getattr(cb, "__module__", "") or ""
                if mod == package or mod.startswith(package + "."):
                    found.append(name)
                    break
        if found:
            return sorted(set(found))
    except Exception:
        pass
    return sorted(set(str(h) for h in declared))


def _policy_modes(home_getter: Optional[Callable[[], Any]]) -> dict:
    """Best-effort current policy modes for both families (non-sensitive: mode + count)."""
    modes: dict = {}
    if home_getter is None:
        return modes
    try:
        home = home_getter()
        from .policy import load_policy as wa_load_policy
        from .telegram_policy import load_policy as tg_load_policy

        wa = wa_load_policy(home)
        tg = tg_load_policy(home)
        modes["whatsapp"] = {"mode": getattr(wa, "mode", None), "reply_chats": len(getattr(wa, "reply_chats", []) or [])}
        modes["telegram"] = {"mode": getattr(tg, "mode", None), "reply_chats": len(getattr(tg, "reply_chats", []) or [])}
    except Exception:
        # A policy read failure must never fabricate a mode.
        return {}
    return modes


def build_guard_status(
    *,
    pid: int,
    nonce: str,
    role: str,
    version: str,
    hooks: Iterable[str],
    transport_ok: bool,
    families: Iterable[str],
    modes: Mapping[str, Any],
    started_at: str,
    updated_at: str,
) -> dict:
    """Pure builder for the heartbeat body. ``enforcing`` is true ONLY when the transport
    is bound AND the required dispatch hook is registered in this process. The primary
    reply mode (whatsapp) is surfaced flat for the app's fail-closed parser."""
    hook_list = sorted(set(str(h) for h in hooks))
    enforcing = bool(transport_ok) and REQUIRED_HOOK in hook_list
    wa_mode = None
    reply_chats = 0
    wa = modes.get("whatsapp") if isinstance(modes, Mapping) else None
    if isinstance(wa, Mapping):
        wa_mode = wa.get("mode")
        reply_chats = int(wa.get("reply_chats") or 0)
    return {
        # Flat fields consumed by src/lib/whatsapp-policy.ts::interpretWhatsappGuard.
        "plugin_loaded": True,
        "enforcing": enforcing,
        "hooks": hook_list,
        "mode": wa_mode,
        "reply_chats": reply_chats,
        # Rich verification fields for the desktop reader.
        "schema": GUARD_STATUS_SCHEMA,
        "pid": int(pid),
        "nonce": str(nonce),
        "process_role": role,
        "plugin_version": version,
        "transport_bound": bool(transport_ok),
        "guard_families": sorted(set(str(f) for f in families)),
        "policy_modes": dict(modes) if isinstance(modes, Mapping) else {},
        "started_at": started_at,
        "updated_at": updated_at,
        "ttl_seconds": HEARTBEAT_TTL_SECONDS,
    }


def heartbeat_path(home: Any, role: str) -> str:
    return os.path.join(str(home), "business-state", f"whatsapp-guard-heartbeat-{role}.json")


def _atomic_write(path: str, body: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def write_heartbeat(status: Mapping[str, Any], home: Any, role: str) -> str:
    path = heartbeat_path(home, role)
    _atomic_write(path, json.dumps(status, ensure_ascii=False, indent=2))
    return path


def capture(
    *,
    home_getter: Optional[Callable[[], Any]],
    declared_hooks: Iterable[str] = (),
    nonce: Optional[str] = None,
    now_iso: Optional[str] = None,
    started_at: Optional[str] = None,
) -> Optional[dict]:
    """Introspect this process and write one heartbeat. Returns the written status (or
    None if it could not resolve the home). Never raises to the caller."""
    try:
        home = home_getter() if home_getter else None
        if home is None:
            return None
        now = now_iso or _now_iso()
        status = build_guard_status(
            pid=os.getpid(),
            nonce=nonce or os.urandom(16).hex(),
            role=process_role(),
            version=plugin_version(),
            hooks=registered_hooks(declared_hooks),
            transport_ok=transport_bound(),
            families=GUARD_FAMILIES,
            modes=_policy_modes(home_getter),
            started_at=started_at or now,
            updated_at=now,
        )
        write_heartbeat(status, home, status["process_role"])
        return status
    except Exception:
        logger.exception("guard-status heartbeat capture failed")
        return None


def start(home_getter: Optional[Callable[[], Any]], declared_hooks: Iterable[str] = ()) -> None:
    """Write the first heartbeat and start a daemon thread that refreshes ``updated_at``
    (re-introspecting each tick) so the reader can prove liveness. Idempotent per process."""
    global _started
    with _started_lock:
        if _started:
            return
        _started = True
    nonce = os.urandom(16).hex()
    started_at = _now_iso()
    capture(home_getter=home_getter, declared_hooks=declared_hooks, nonce=nonce, started_at=started_at)

    def _loop() -> None:
        while True:
            try:
                time.sleep(_REFRESH_INTERVAL_SECONDS)
                capture(
                    home_getter=home_getter,
                    declared_hooks=declared_hooks,
                    nonce=nonce,
                    started_at=started_at,
                )
            except Exception:  # pragma: no cover - defensive daemon
                logger.exception("guard-status refresh tick failed")

    thread = threading.Thread(target=_loop, name="business-guard-heartbeat", daemon=True)
    thread.start()
