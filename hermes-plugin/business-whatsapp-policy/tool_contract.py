"""The verified ``send_message`` transport + ``pre_tool_call`` contract.

Records the exact identifiers this plugin's tool-level enforcement depends on in
the installed Hermes, so a drift test can prove the shapes still hold and the fix
still binds. Verified against ``tools/send_message_tool.py`` and
``hermes_cli/plugins.py`` (send_message is intentionally NOT a registered model
tool; cron/CLI/MCP invoke the transport engine directly).
"""

from __future__ import annotations

from .contract import AdapterContractError

# Transport chokepoints wrapped by :mod:`.tool_transport`, and the parameter each
# guard reads to resolve the destination. These are REQUIRED: a target missing a
# param, not async, or absent is a surface drift the guard cannot bind, so
# :func:`.tool_transport.install_tool_guards` raises rather than binding a guard
# that could not prove the destination. Every declared target must bind or none do.
TRANSPORT_TARGETS = {
    "_send_to_platform": ("platform", "chat_id"),
}

# Sentinel attributes stamped on a guard so a re-install can prove idempotency is
# OURS (not a foreign wrapper that merely reused the flag name) and that the
# wrapped signature still carries the required destination params.
GUARD_FLAG = "__business_policy_guarded__"
GUARD_PARAMS_ATTR = "__business_policy_guard_params__"


class ToolTransportContractError(AdapterContractError):
    """The ``send_message`` transport surface drifted beyond what the guard can
    bind (engine not importable, chokepoint missing, non-async, signature lost a
    required param, or a binding assignment failed). A subclass of
    :class:`AdapterContractError` so :func:`register` treats it on the single
    existing fail-closed path: disable the controlled platforms, never
    log-and-continue with a live-but-unguarded outbound transport."""

# pre_tool_call block contract consumed by hermes_cli.plugins
# .get_pre_tool_call_block_message: a callback must return this exact shape to
# block, and a malformed return must be ignored (fail-open for the return, so a
# well-formed block is the only thing honored).
PRE_TOOL_CALL_BLOCK = {"action": "block", "message": "<non-empty str>"}
PRE_TOOL_CALL_HOOK = "pre_tool_call"
BLOCK_MESSAGE_RESOLVER = "get_pre_tool_call_block_message"
