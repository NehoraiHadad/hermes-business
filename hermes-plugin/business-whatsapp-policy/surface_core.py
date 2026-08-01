"""Platform-neutral, fail-closed verification of a LIVE adapter/registry surface.

Each family supplies its guarded/required method sets, the base classes whose
methods are stable (excluded from the drift tripwire), and the outbound-name
prefixes. An unknown family, a missing required method, a new unguarded outbound
method, or a ``PlatformEntry`` missing a wrapped field all raise the family's
``AdapterContractError`` — which the caller turns into a *disabled* connection
rather than an unguarded one. A benign non-outbound helper never trips it, so
ordinary Hermes patch releases keep working.
"""

from __future__ import annotations

from typing import Any


def concrete_public_methods(adapter: Any, skip_bases) -> set[str]:
    """Public method names defined on the concrete adapter class(es) — the MRO
    excluding ``object`` and the shared/stable bases — i.e. the platform-specific
    surface the drift tripwire scrutinizes."""
    names: set[str] = set()
    for klass in type(adapter).__mro__:
        if klass is object or klass.__name__ in skip_bases:
            continue
        for name, value in vars(klass).items():
            if name.startswith("_"):
                continue
            if callable(value) or isinstance(value, (staticmethod, classmethod)):
                names.add(name)
    return names


def verify_surface(adapter, *, guarded, required, prefixes, skip_bases, error_cls, label):
    """Fail closed unless the adapter matches the verified outbound contract."""
    if guarded is None:
        raise error_cls(f"unknown {label} adapter family")
    for req in required:
        if not callable(getattr(adapter, req, None)):
            raise error_cls(
                f"{label} adapter is missing required method {req!r}; "
                "surface drifted beyond the verified contract"
            )
    for name in concrete_public_methods(adapter, skip_bases):
        if name in guarded:
            continue
        if any(name.startswith(prefix) for prefix in prefixes):
            raise error_cls(
                f"{label} adapter exposes unrecognized outbound method "
                f"{name!r}; refusing to run unguarded"
            )


def verify_entry(entry, required_fields, error_cls):
    """Ensure the installed ``PlatformEntry`` still carries the fields the
    registry guard wraps. Fail closed on drift."""
    missing = [field for field in required_fields if not hasattr(entry, field)]
    if missing:
        raise error_cls(
            "PlatformEntry is missing expected fields: " + ", ".join(sorted(missing))
        )
