"""Fail-closed WhatsApp guard for Hermes' shared messaging transport.

Hermes cron, CLI and MCP sending paths converge on ``_send_to_platform``. The
wrapper resolves the destination at call time and applies policy only when the
platform is WhatsApp. Telegram and every other Hermes-managed platform pass
through untouched.

The transport contract is validated before mutation and binding is atomic with
rollback. If the verified Hermes surface drifts, registration disables the
controlled WhatsApp family instead of pretending enforcement is active.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any, Callable

from . import egress
from .tool_contract import (
    GUARD_FLAG,
    GUARD_PARAMS_ATTR,
    TRANSPORT_TARGETS,
    ToolTransportContractError,
)

logger = logging.getLogger(__name__)


def _mod(module: Any) -> str:
    return getattr(module, "__name__", str(module))


def _bound(sig: inspect.Signature, args: tuple, kwargs: dict) -> dict:
    try:
        return sig.bind_partial(*args, **kwargs).arguments
    except TypeError:
        return {}


def _resolve_platform(bound: dict, args: tuple) -> tuple:
    return bound.get("platform", args[0] if args else None), bound.get("chat_id")


def _make_guard(original: Callable, home_getter: Callable[[], Any], resolve: Callable) -> Callable:
    """Wrap an async chokepoint so a controlled-family send the policy denies
    returns the engine's own ``{"error": ...}`` shape instead of egressing."""
    sig = inspect.signature(original)

    async def guarded(*args, **kwargs):
        platform, chat_id = resolve(_bound(sig, args, kwargs), args)
        if egress.families.is_controlled(platform):
            block = egress.decision(platform, chat_id, home_getter=home_getter)
            if block:
                return {"error": block}
        return await original(*args, **kwargs)

    setattr(guarded, GUARD_FLAG, True)
    setattr(guarded, GUARD_PARAMS_ATTR, tuple(sig.parameters))
    return guarded


_FACTORIES = {
    "_send_to_platform": lambda o, h: _make_guard(o, h, _resolve_platform),
}


def _validate_target(module: Any, name: str) -> tuple[str, Callable]:
    """Validate one chokepoint WITHOUT mutating. Return ``("bind", original)`` to
    wrap, or ``("kept", fn)`` when it is already our guard and still valid.
    Raise :class:`ToolTransportContractError` on any drift."""
    required = TRANSPORT_TARGETS[name]
    where = f"{_mod(module)}.{name}"
    fn = getattr(module, name, None)
    if fn is None:
        raise ToolTransportContractError(f"{where} missing (surface drift)")
    if getattr(fn, GUARD_FLAG, False):
        # Idempotent success only if the guard is OURS (carries the stamped params
        # attr) and still covers the required destination params.
        params = getattr(fn, GUARD_PARAMS_ATTR, None)
        if params is None or not set(required) <= set(params):
            raise ToolTransportContractError(f"{where} carries a foreign/stale guard flag")
        return ("kept", fn)
    if not inspect.iscoroutinefunction(fn):
        raise ToolTransportContractError(f"{where} is not async; cannot wrap the engine shape")
    try:
        params = set(inspect.signature(fn).parameters)
    except (TypeError, ValueError) as exc:
        raise ToolTransportContractError(f"{where} signature unreadable ({exc})") from exc
    missing = set(required) - params
    if missing:
        raise ToolTransportContractError(f"{where} lost required params {sorted(missing)}")
    return ("bind", fn)


def install_tool_guards(home_getter: Callable[[], Any]) -> dict:
    """Wrap every ``send_message`` transport chokepoint declared in
    ``_FACTORIES`` (today, just ``_send_to_platform``) in place, fail-closed.

    Returns a ``{name: "bound"|"already"}`` binding result on success. Raises
    :class:`ToolTransportContractError` on any drift (engine not importable,
    chokepoint missing/non-async/signature-drifted, or a bind assignment fails)
    so :func:`register` disables the controlled platforms. No silent skip.
    """
    try:
        import tools.send_message_tool as smt
    except Exception as exc:  # noqa: BLE001 - cannot prove the engine is guarded
        raise ToolTransportContractError(
            f"send_message engine not importable ({exc}); transport unproven"
        ) from exc
    # Phase 1: validate every target before mutating anything (all-or-none).
    plans = {name: _validate_target(smt, name) for name in _FACTORIES}
    # Phase 2: bind atomically; restore what we changed if an assignment fails.
    applied: list[tuple[str, Callable]] = []
    result: dict[str, str] = {}
    try:
        for name, (action, fn) in plans.items():
            if action == "kept":
                result[name] = "already"
                continue
            setattr(smt, name, _FACTORIES[name](fn, home_getter))
            applied.append((name, fn))
            result[name] = "bound"
    except Exception as exc:  # noqa: BLE001 - roll back to a consistent surface
        for name, original in reversed(applied):
            try:
                setattr(smt, name, original)
            except Exception:  # pragma: no cover - defensive
                logger.exception("business messaging policy: rollback of %s failed", name)
        raise ToolTransportContractError(
            f"failed to bind send_message guard atomically; restored originals ({exc})"
        ) from exc

    logger.debug("business messaging policy: send_message transport guards %s", result)
    return result
