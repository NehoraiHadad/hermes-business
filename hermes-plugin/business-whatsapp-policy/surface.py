"""Fail-closed verification of a LIVE WhatsApp adapter/registry surface against
the verified contract in :mod:`.contract`.

The verification engine lives in :mod:`.surface_core` (shared with every
messaging family). This module binds it to the WhatsApp contract data and keeps
the historical public function names so :mod:`.transport` and the tests import
unchanged.
"""

from __future__ import annotations

from typing import Any

from .contract import (
    OUTBOUND_METHODS,
    OUTBOUND_NAME_PREFIXES,
    REQUIRED_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    AdapterContractError,
)
from .surface_core import concrete_public_methods, verify_entry, verify_surface

# The shared base + behavior mixin carry stable methods; only the concrete
# WhatsApp adapter class's own surface is scrutinized by the drift tripwire.
_SKIP_BASES = frozenset({"BasePlatformAdapter", "WhatsAppBehaviorMixin"})


def _concrete_public_methods(adapter: Any) -> set[str]:
    return concrete_public_methods(adapter, _SKIP_BASES)


def verify_adapter_surface(adapter: Any, family: str) -> None:
    verify_surface(
        adapter,
        guarded=OUTBOUND_METHODS.get(family),
        required=REQUIRED_METHODS.get(family, frozenset()),
        prefixes=OUTBOUND_NAME_PREFIXES,
        skip_bases=_SKIP_BASES,
        error_cls=AdapterContractError,
        label=family,
    )


def verify_platform_entry(entry: Any) -> None:
    verify_entry(entry, REQUIRED_PLATFORM_ENTRY_FIELDS, AdapterContractError)
