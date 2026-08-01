"""Fail-closed verification of a LIVE Telegram adapter/registry surface against
the verified contract in :mod:`.telegram_contract`.

An unknown surface, a missing required method, a new unguarded outbound method,
or a ``PlatformEntry`` missing a wrapped field all raise
:class:`AdapterContractError` — which the registry guard turns into a disabled
Telegram connection rather than an unguarded one.
"""

from __future__ import annotations

from typing import Any

from .surface_core import verify_entry, verify_surface
from .telegram_contract import (
    OUTBOUND_METHODS,
    OUTBOUND_NAME_PREFIXES,
    REQUIRED_METHODS,
    REQUIRED_PLATFORM_ENTRY_FIELDS,
    SKIP_BASES,
    AdapterContractError,
)


def verify_adapter_surface(adapter: Any) -> None:
    verify_surface(
        adapter,
        guarded=OUTBOUND_METHODS,
        required=REQUIRED_METHODS,
        prefixes=OUTBOUND_NAME_PREFIXES,
        skip_bases=SKIP_BASES,
        error_cls=AdapterContractError,
        label="telegram",
    )


def verify_platform_entry(entry: Any) -> None:
    verify_entry(entry, REQUIRED_PLATFORM_ENTRY_FIELDS, AdapterContractError)
