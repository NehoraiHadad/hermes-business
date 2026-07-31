"""Persist passive WhatsApp intake into the normal Hermes session store."""

from __future__ import annotations

import time
from typing import Any

SILENT_MARKER = "NO_REPLY"


def _append(store: Any, session_id: str, role: str, content: str, **extra: Any) -> None:
    store.append_to_transcript(
        session_id,
        {"role": role, "content": content, "timestamp": time.time(), **extra},
    )


def ingest_without_reply(event: Any, store: Any) -> bool:
    if store is None or event is None or getattr(event, "source", None) is None:
        return False
    entry = store.get_or_create_session(event.source)
    session_id = getattr(entry, "session_id", "")
    if not session_id:
        return False

    message_id = str(getattr(event, "message_id", "") or "")
    if message_id and store.has_platform_message_id(session_id, message_id):
        return True

    history = store.load_transcript(session_id)
    if history and history[-1].get("role") == "user":
        _append(store, session_id, "assistant", SILENT_MARKER)

    text = str(getattr(event, "text", "") or "").strip()
    if not text:
        text = "[התקבלה הודעת WhatsApp ללא טקסט]"
    extra = {"message_id": message_id} if message_id else {}
    _append(store, session_id, "user", text, **extra)
    _append(store, session_id, "assistant", SILENT_MARKER)
    return True
