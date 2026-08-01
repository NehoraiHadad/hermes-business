# business-whatsapp-policy

Fail-closed business **messaging** reply policy for the business shell. One
policy engine governs two families:

- **WhatsApp** (`whatsapp`, `whatsapp_cloud`): `read_only` (default) or
  `selected_chats`.
- **Telegram** (`telegram`): `read_only` (default), `selected_chats`, or
  `full_access`.

The package id stays `business-whatsapp-policy` for install/migration
compatibility; it is the general business messaging-policy engine.

Policy files (per Hermes home), fail-closed to `read_only` when absent/garbled:

- `business/whatsapp-policy.json`
- `business/telegram-policy.json`

```json
{ "version": 1, "mode": "selected_chats", "reply_chats": ["-100777", "@shop"] }
```

## Enforcement points (all fail-closed, one shared decision engine)

Every door consults the same normalization + `can_reply` logic
(`families.py` → `egress.py`), so the three modes mean the same thing
everywhere and cannot drift between doors.

1. **Inbound** — `pre_gateway_dispatch` hook. Unauthorized inbound messages are
   passively ingested and never dispatched to the agent (no reply).
2. **Adapter / standalone / interactive transport** — the gateway
   `platform_registry` adapter factory, `standalone_sender_fn` (cron/scheduled
   delivery), and inline-button authorizers are wrapped. A surface that has
   drifted beyond the verified contract **disables** the connection rather than
   serving it unguarded.
3. **`send_message` transport engine** (`tool_transport.py`) — closes the
   confirmed Telegram egress bypass: `tools.send_message_tool._send_telegram`
   builds a raw `telegram.Bot(token=...)` and sends, **below** the guarded
   adapter/`standalone_sender_fn`. cron, the `hermes send` CLI, and the MCP
   `messages_send` tool all reach it via call-time imports, so we wrap the two
   shared chokepoints (`_send_to_platform`, `_send_telegram`) in place. A
   blocked send returns the engine's own `{"error": ...}` shape. This door is
   **fail-closed**: `install_tool_guards` validates that the engine imports and
   that **both** chokepoints are present, async, and carry their destination
   params, then binds them atomically (rollback on a partial bind). Any drift
   raises `ToolTransportContractError`, and `register()` treats that as a family
   safety failure — it **disables every controlled platform** (`telegram`,
   `whatsapp`, `whatsapp_cloud`) rather than let connectors run beside an
   unproven, unguarded transport. It never log-and-continues.
4. **Tool hook** (`tool_hook.py`) — `pre_tool_call` guard for outbound
   messaging *model tools*. Returns `{"action": "block", "message": ...}` for a
   Telegram/WhatsApp send the policy denies. Verified caveat: in the installed
   Hermes (0.19.1) `send_message` is **not** a registered model tool, so this
   hook is defense-in-depth for any registered send_message-shaped tool; door 3
   is what actually closes the confirmed bypass.

Unknown/malformed targets under a controlled family **deny** (never allow),
even under Telegram `full_access`. Non-WhatsApp/Telegram platforms (Discord,
Slack, Signal, …) are never touched.

## Known gaps (honest boundary)

**WhatsApp Cloud external senders.** WhatsApp Cloud numbers can be messaged by
processes outside Hermes (other API clients sharing the same phone-number id).
This plugin governs only sends that flow through Hermes; it cannot prevent an
external system that holds the Cloud API token from sending on the same number.

**Processes that do not load this plugin.** Every door — including the transport
guard (door 3) — is installed by `register()` *within a process*. A bare `hermes
send` invocation or an MCP `serve` process that does **not** load the business
plugin is outside this boundary: neither the guard nor the fail-closed
platform-disable runs there. The guarantee is "in any process where this plugin
is loaded, a controlled-family send is guarded or the family is disabled" — not
"the Hermes binary can never send." The `test_tool_contract.py` drift probe
documents that `send_message` is not a registered model tool, so the transport
door (not `pre_tool_call`) is what closes the confirmed bypass where the plugin
*is* loaded.

## Tests

Pure-stdlib, no network, no live Hermes:

```
python -m pytest hermes-plugin/business-whatsapp-policy/tests -q
```

`test_installed_contract.py` and `test_tool_contract.py` additionally probe the
*installed* Hermes (skipped when absent) and **fail** on surface/hook drift —
including a functional check that the installed `pre_tool_call` resolver still
honors `{action: block, message}` and ignores malformed returns.
