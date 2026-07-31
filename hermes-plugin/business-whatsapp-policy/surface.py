"""Fail-closed verification of a LIVE WhatsApp adapter/registry surface against
the verified contract in :mod:`.contract`.

These checks are what turn "the surface drifted" into a disabled connection: an
unknown family, a missing required method, a new unguarded outbound method, or a
``PlatformEntry`` missing a field we wrap all raise
:class:`~.contract.AdapterContractError`. A benign non-outbound helper never
trips them, so ordinary Hermes patch releases keep working.
"""

from __future__ import annotations

from typing import Any

from .contract import (
    OUTBOUND_METHODS,
    REQUIRED_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    _OUTBOUND_NAME_PREFIXES,
    AdapterContractError,
)


def _concrete_public_methods(adapter: Any) -> set[str]:
    """Public method names *defined on the concrete adapter class* (its own MRO
    excluding the shared base and behavior mixin) -- the platform-specific
    surface the drift tripwire scrutinizes."""
    names: set[str] = set()
    for klass in type(adapter).__mro__:
        if klass is object or klass.__name__ in {
            "BasePlatformAdapter",
            "WhatsAppBehaviorMixin",
        }:
            continue
        for name, value in vars(klass).items():
            if name.startswith("_"):
                continue
            if callable(value) or isinstance(value, (staticmethod, classmethod)):
                names.add(name)
    return names


def verify_adapter_surface(adapter: Any, family: str) -> None:
    """Fail closed unless the adapter matches the verified outbound contract.

    Raises :class:`AdapterContractError` when the family is unknown, a required
    method is missing, or a *new public outbound method* appears that is not in
    the guarded set. A benign non-outbound helper does not trip this, so
    ordinary Hermes patch releases keep working."""
    guarded = OUTBOUND_METHODS.get(family)
    if guarded is None:
        raise AdapterContractError(f"unknown WhatsApp adapter family: {family!r}")

    for required in REQUIRED_METHODS.get(family, frozenset()):
        if not callable(getattr(adapter, required, None)):
            raise AdapterContractError(
                f"{family} adapter is missing required method {required!r}; "
                "surface drifted beyond the verified contract"
            )

    for name in _concrete_public_methods(adapter):
        if name in guarded:
            continue
        if any(name.startswith(prefix) for prefix in _OUTBOUND_NAME_PREFIXES):
            raise AdapterContractError(
                f"{family} adapter exposes unrecognized outbound method "
                f"{name!r}; refusing to run unguarded"
            )


def verify_platform_entry(entry: Any) -> None:
    """Ensure the installed ``PlatformEntry`` still carries the fields the
    registry guard wraps. Fail closed on drift."""
    missing = [
        field for field in REQUIRED_PLATFORM_ENTRY_FIELDS if not hasattr(entry, field)
    ]
    if missing:
        raise AdapterContractError(
            "PlatformEntry is missing expected fields: " + ", ".join(sorted(missing))
        )
