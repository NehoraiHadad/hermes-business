"""Read-only, incremental import of approved history from older Tachles releases."""
from __future__ import annotations

from contextlib import closing

from .storage import connect_readonly


def import_history(target, legacy_path, policy) -> None:
    completed = {row[0] for row in target.execute('SELECT chat_id FROM legacy_imports WHERE complete=1')}
    pending = {group: name for group, name in policy.groups.items() if group not in completed}
    if not pending:
        return
    if not legacy_path.is_file():
        with target:
            target.executemany('INSERT OR REPLACE INTO legacy_imports VALUES (?, 0, 1)', [(group,) for group in pending])
        return
    from .capture_store import write_message

    with closing(connect_readonly(legacy_path)) as source:
        for group, name in pending.items():
            progress = target.execute('SELECT last_id FROM legacy_imports WHERE chat_id=?', (group,)).fetchone()
            last = progress[0] if progress else 0
            # Same historical scope as the existing read-only archive API:
            # approved group, user intake, stable platform ID, active content.
            rows = source.execute('''
                SELECT m.id, m.timestamp, m.platform_message_id,
                       archive_text(m.display_metadata,m.content) AS body,
                       archive_sender_id(m.display_metadata,m.content) AS sender_id,
                       archive_sender_name(m.display_metadata,m.content) AS sender_name
                FROM messages m JOIN sessions s ON s.id=m.session_id
                WHERE LOWER(s.source)='whatsapp' AND LOWER(s.chat_type)='group'
                  AND LOWER(s.chat_id)=? AND m.role='user' AND COALESCE(m.active,1)=1
                  AND m.platform_message_id IS NOT NULL AND m.id>?
                ORDER BY m.id
            ''', (group, last))
            imported_id = last
            while batch := rows.fetchmany(250):
                with target:
                    for row in batch:
                        if not row['body'] or not row['platform_message_id']:
                            continue
                        write_message(target, group=group, name=name,
                                      message_id=row['platform_message_id'], text=row['body'],
                                      timestamp=row['timestamp'], metadata={
                                          'archive_text': row['body'], 'sender_id': row['sender_id'],
                                          'sender_name': row['sender_name'], 'capture_source': 'legacy_hermes'})
                    imported_id = batch[-1]['id']
                    target.execute('INSERT OR REPLACE INTO legacy_imports VALUES (?, ?, 0)', (group, imported_id))
            with target:
                target.execute('INSERT OR REPLACE INTO legacy_imports VALUES (?, ?, 1)', (group, imported_id))
