# Community archive Hermes plugin

This plugin exposes one read-only tool, `community_archive`. It queries the
canonical Hermes `<process HERMES_HOME>/state.db`; it does not create another
database or accept a database/profile path from the model.

The installer must generate `<process HERMES_HOME>/community/archive-policy.json`:

```json
{"version":1,"groups":[{"id":"120363000000000001@g.us","name":"Main group"}]}
```

Only exact group IDs in that file can be queried. A missing or malformed policy
fails closed. The policy is process-global: a resident-facing shared profile
must list only that shared space's groups and must never include isolated or
sensitive groups. Isolated profiles should not receive this toolset.

The WhatsApp observer should persist one message per row with a
`platform_message_id` and this display metadata contract:

```json
{"archive_text":"one raw message","sender_id":"...","sender_name":"...","chat_id":"...","chat_name":"..."}
```

`archive_text` deliberately contains only the single raw message. This keeps an
immediate context block (for example, the recent 50 messages injected into an
addressed turn) from being counted or searched as though it were one new message.
For backward compatibility, sender attribution can also be read from a leading
`[sender name|sender id]` marker.
