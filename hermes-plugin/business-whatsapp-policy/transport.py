"""Transport integration: wire the verified contract to the guard machinery and
install fail-closed policy guards over a live WhatsApp adapter.

This module is the stable public surface for the package. It composes:

  * :mod:`.contract` — the verified adapter surface data + version policy.
  * :mod:`.surface`  — fail-closed verification of a live surface.
  * :mod:`.guards`   — deny-by-default outbound guard machinery.

and re-exports them so existing imports (``from ...transport import ...``) and
the installed-contract tests keep working unchanged.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable

from .contract import (
    INTERACTIVE_AUTH_METHOD,
    OUTBOUND_METHODS,
    PLATFORM_FAMILY,
    REQUIRED_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    SUPPORTED_HERMES_VERSIONS,
    SUPPORTED_VERSION_PREFIXES,
    AdapterContractError,
    is_supported_version,
    platform_family,
)
from .guards import (
    _guard_interactive_auth,
    _guard_standalone,
    _make_async_guard,
    _make_sync_guard,
)
from .surface import verify_adapter_surface, verify_platform_entry

__all__ = [
    "INTERACTIVE_AUTH_METHOD",
    "OUTBOUND_METHODS",
    "PLATFORM_FAMILY",
    "REQUIRED_METHODS",
    "REQUIRED_PLATFORM_ENTRY_FIELDS",
    "SUPPORTED_HERMES_VERSIONS",
    "SUPPORTED_VERSION_PREFIXES",
    "AdapterContractError",
    "is_supported_version",
    "platform_family",
    "verify_adapter_surface",
    "verify_platform_entry",
    "guard_adapter",
    "_guard_standalone",
]


def guard_adapter(adapter: Any, platform: str, home_getter: Callable[[], Any]) -> Any:
    """Wrap every verified outbound method on *adapter* with the reply policy.

    Raises :class:`AdapterContractError` (fail closed) when the platform family
    is unknown or the adapter's outbound surface has drifted beyond the verified
    contract. The registry factory turns that into a disabled connection rather
    than an unguarded one."""
    family = platform_family(platform)
    if family is None:
        raise AdapterContractError(
            f"cannot guard unknown WhatsApp platform {platform!r}"
        )

    # Fail closed if the live surface no longer matches what we verified.
    verify_adapter_surface(adapter, family)

    for name in OUTBOUND_METHODS[family]:
        original = getattr(adapter, name, None)
        if not callable(original):
            continue
        # Async and synchronous mutating methods must both fail closed: a plain
        # ``def send(...)`` would otherwise bypass the policy entirely.
        if inspect.iscoroutinefunction(original):
            setattr(adapter, name, _make_async_guard(name, original, home_getter))
        else:
            setattr(adapter, name, _make_sync_guard(name, original, home_getter))

    _guard_interactive_auth(adapter, home_getter)
    return adapter
