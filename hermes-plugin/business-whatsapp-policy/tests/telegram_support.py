"""Telegram-specific test fixtures, kept out of support.py to hold both modules
under the line budget. Importing this also bootstraps the plugin package (via
support)."""

from __future__ import annotations

from pathlib import Path

from support import FakeSendResult, _write_policy


def write_telegram_policy(home: Path, mode: str, chats: list) -> None:
    _write_policy(home, "telegram-policy.json", mode, chats)


class FakeTelegramAdapter:
    """Minimal adapter mirroring the Telegram outbound surface the guard wraps."""

    def __init__(self):
        self.sent = []
        self.typed = []
        self.deleted = []
        self.topics = []

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.sent.append((chat_id, content))
        return FakeSendResult(success=True)

    async def send_typing(self, chat_id, metadata=None):
        self.typed.append(chat_id)

    async def delete_message(self, chat_id, message_id):
        self.deleted.append(chat_id)
        return True

    async def ensure_dm_topic(self, chat_id, topic_name, force_create=False):
        self.topics.append(chat_id)
        return "thread-1"

    def _is_callback_user_authorized(
        self, user_id, *, chat_id=None, chat_type=None, thread_id=None, user_name=None
    ):
        return True
