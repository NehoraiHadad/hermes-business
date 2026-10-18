"""Passive intake extension composed through Hermes' native platform registry."""
from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import replace
from functools import wraps

from .capture_store import capture
from .policy import load_policy, normalize_group_id

logger = logging.getLogger(__name__)


def _record(adapter, data, home_getter):
    try:
        if not isinstance(data, dict) or data.get('isGroup') is not True:
            return
        if (not isinstance(data.get('messageId'), str) or not data['messageId'].strip()
                or len(data['messageId']) > 512 or not isinstance(data.get('body'), str)
                or not data['body'].strip()):
            return
        group = normalize_group_id(data.get('chatId'))
        home = home_getter()
        policy = load_policy(home)
        if not policy.capture_enabled or group not in policy.groups:
            return
        if not adapter._is_group_allowed(group):
            return
        capture(home, policy, data)
    except Exception as error:
        # Retention fails closed, while ordinary native intake keeps its exact
        # behavior. No raw text, sender identifiers or secrets are logged.
        logger.error('Community passive capture failed (%s); no archive success is claimed', type(error).__name__)


def wrap_adapter(adapter, home_getter):
    if getattr(adapter, '_tachles_passive_archive', False):
        return adapter
    original = getattr(adapter, '_build_message_event', None)
    if not inspect.iscoroutinefunction(original) or not callable(getattr(adapter, '_is_group_allowed', None)):
        raise RuntimeError('Native WhatsApp intake contract changed; passive capture is unavailable')

    @wraps(original)
    async def build_event(data):
        # Retain one raw bridge message before native mention filtering/context
        # injection. Never dispatch, send, download media, or invoke the model.
        await asyncio.to_thread(_record, adapter, data, home_getter)
        return await original(data)

    adapter._build_message_event = build_event
    adapter._tachles_passive_archive = True
    return adapter


def install_observer(home_getter):
    from gateway.platform_registry import platform_registry

    entry = platform_registry.get('whatsapp')
    if entry is None:
        logger.warning('Native WhatsApp bridge is unavailable; passive community capture is inactive')
        return
    original = entry.adapter_factory

    def factory(config):
        adapter = original(config)
        if adapter is None:
            return None
        try:
            return wrap_adapter(adapter, home_getter)
        except RuntimeError:
            logger.error('Native WhatsApp intake changed; passive community capture is inactive')
            return adapter

    platform_registry.register(replace(entry, adapter_factory=factory))
