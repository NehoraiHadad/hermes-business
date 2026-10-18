"""Passive capture is opt-in, scoped, durable and independent of replies."""
import asyncio
import hashlib
import json
import sqlite3
import unittest
from contextlib import closing
from unittest.mock import patch

from support import ArchiveHome
from community_archive.capture_store import archive_path, database_for_read
from community_archive.observer import wrap_adapter
from community_archive.policy import load_policy
from community_archive.query import query_archive

GROUP = '120363000000000001@g.us'


class NativeIntake:
    def __init__(self):
        self.allowed = True
        self.calls = []

    def _is_group_allowed(self, group):
        return self.allowed

    async def _build_message_event(self, data):
        self.calls.append(data)
        return None  # native mention filtering drops an unmentioned message


class PassiveObserver(ArchiveHome, unittest.TestCase):
    def configure(self, enabled=True, groups=None):
        path = self.home / 'community/archive-policy.json'
        data = json.loads(path.read_text(encoding='utf-8'))
        data['capture'] = {'enabled': enabled}
        if groups is not None:
            data['groups'] = groups
        path.write_text(json.dumps(data), encoding='utf-8')

    def message_data(self, message_id='live', **extra):
        return {'isGroup': True, 'chatId': GROUP, 'messageId': message_id,
                'body': 'מחר תפילה בשעה 7', 'senderId': 'u1', 'senderName': 'דנה',
                'timestamp': 1700000000, **extra}

    def deliver(self, adapter, data):
        return asyncio.run(adapter._build_message_event(data))

    def read(self):
        return query_archive(database_for_read(self.home), load_policy(self.home), {'action': 'recent'})

    def test_opt_in_and_native_filtering_are_independent(self):
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        self.assertIsNone(self.deliver(native, self.message_data()))
        self.assertFalse(archive_path(self.home).exists())
        self.configure()
        self.assertIsNone(self.deliver(native, self.message_data()))
        self.assertEqual(len(native.calls), 2)
        self.assertEqual(self.read()['messages'][0]['content'], 'מחר תפילה בשעה 7')
        self.assertIs(wrap_adapter(native, lambda: self.home), native)
        self.deliver(native, self.message_data())
        self.assertEqual(len(self.read()['messages']), 1)

    def test_only_approved_group_text_passes_both_retention_and_native_gates(self):
        self.configure()
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        for data in [self.message_data(chatId='120363999999999999@g.us'),
                     self.message_data(isGroup=False), self.message_data(message_id='empty', body=''),
                     self.message_data(message_id='missing', messageId=None)]:
            self.deliver(native, data)
        native.allowed = False
        self.deliver(native, self.message_data())
        self.assertFalse(archive_path(self.home).exists())
        self.assertEqual(len(native.calls), 5)

    def test_disable_and_scope_revocation_take_effect_without_restart(self):
        self.configure()
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        self.deliver(native, self.message_data())
        self.configure(False)
        self.deliver(native, self.message_data('paused'))
        self.assertEqual(len(self.read()['messages']), 1)
        self.configure(True, [{'id': '120363000000000002@g.us', 'name': 'Other'}])
        self.deliver(native, self.message_data('revoked'))
        self.assertEqual(self.read()['messages'], [])

    def test_imports_approved_legacy_history_once_without_mutating_hermes(self):
        self.session('public', GROUP)
        self.message('public', '[Dana|u2] older message', 1600000000, message_id='old')
        self.session('private', '120363999999999999@g.us')
        self.message('private', 'private text', 1600000000, message_id='private')
        before = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        self.configure()
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        self.deliver(native, self.message_data())
        self.assertEqual(len(self.read()['messages']), 2)
        self.assertEqual(hashlib.sha256(self.db_path.read_bytes()).hexdigest(), before)
        # New adapter, same durable archive; duplicate live and legacy IDs stay unique.
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        self.deliver(native, self.message_data())
        self.assertEqual(len(self.read()['messages']), 2)

    def test_capture_failure_never_changes_native_intake(self):
        self.configure()
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        with patch('community_archive.observer.capture', side_effect=OSError('disk unavailable')):
            self.assertIsNone(self.deliver(native, self.message_data()))
        self.assertEqual(len(native.calls), 1)
        self.assertFalse(archive_path(self.home).exists())

    def test_failed_migration_does_not_hide_the_existing_archive(self):
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.execute('DROP TABLE messages')
            conn.commit()
        self.configure()
        native = wrap_adapter(NativeIntake(), lambda: self.home)
        self.deliver(native, self.message_data())
        self.assertEqual(database_for_read(self.home), self.db_path)

    def test_contract_drift_refuses_capture_instead_of_overriding_native_intake(self):
        class Drifted:
            def _build_message_event(self, data):
                return data
        with self.assertRaises(RuntimeError):
            wrap_adapter(Drifted(), lambda: self.home)
