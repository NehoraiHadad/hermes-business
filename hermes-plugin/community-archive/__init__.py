"""Hermes plugin entrypoint for the safe community message archive."""

from __future__ import annotations

from .tool import ARCHIVE_SCHEMA, archive_available, handle_archive


def register(ctx) -> None:
    ctx.register_tool(
        name="community_archive",
        toolset="community_archive",
        schema=ARCHIVE_SCHEMA,
        handler=handle_archive,
        check_fn=archive_available,
        description="Search and count approved community WhatsApp messages.",
        emoji="🔎",
    )
