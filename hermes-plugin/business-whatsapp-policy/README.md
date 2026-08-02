# WhatsApp business reply policy

This Hermes user plugin adds the optional `read_only` and `selected_chats`
boundary required when a business connects an existing WhatsApp account.

It does not intercept Telegram. Telegram is a dedicated bot connection and uses
Hermes' native authorization, pairing, group policy, replies and sending paths.

The only policy file owned here is:

- `business/whatsapp-policy.json`
