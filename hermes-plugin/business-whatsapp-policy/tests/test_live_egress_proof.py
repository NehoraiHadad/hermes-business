"""End-to-end egress proof against the REAL installed Hermes adapter.

Every other test in this package exercises the guard against fakes. This one
closes the last gap: it loads the genuine installed WhatsApp adapter class
(``plugins.platforms.whatsapp.adapter``) inside the installed Hermes venv,
guards it with this plugin's real ``guard_adapter``/``guard_standalone``
machinery, and then proves both directions of the policy through all three
outbound doors:

    adapter.send            — the agent's own send surface
    standalone sender       — the CRON / out-of-process delivery path
    _send_to_platform       — the shared tool/CLI/MCP chokepoint

The final network hop is replaced by a TRIPWIRE that records the call and
raises, so the proof is unambiguous and nothing can leave the machine:

    blocked  => the tripwire was never reached (transport was never handed the
                message at all — not merely "the send failed")
    allowed  => the tripwire fired (the guard let it through) and stopped there

Why this matters: native Hermes 0.19.1 gates INBOUND messages (dm_policy /
pairing) but has no outbound gate — verified by reading all four send paths.
Nothing but this plugin stops a cron job or a prompt-injected tool call from
messaging an arbitrary contact, so "the guard actually blocks the real adapter"
is a claim worth proving against the real thing rather than a fake.

Each scenario writes its policy into its own temp HERMES_HOME, so the operator's
live policy file is never read or written.
"""

import asyncio
import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from installed_probe import hermes_agent_root
from support import PACKAGE  # importing `support` loads the plugin package

TARGET = "972500000009@s.whatsapp.net"

POLICIES = {
    "read_only": {"version": 2, "mode": "read_only", "reply_chats": [], "reply_groups": []},
    "selected_other": {
        "version": 2, "mode": "selected_chats",
        "reply_chats": ["972500000001"], "reply_groups": [],
    },
    "selected_target": {
        "version": 2, "mode": "selected_chats",
        "reply_chats": ["972500000009"], "reply_groups": [],
    },
    "missing_file": None,  # an absent policy must fail closed, not open
}


class Tripwire(Exception):
    """Raised INSTEAD of touching the network; reaching it proves the guard allowed."""


def _temp_home(policy):
    home = Path(tempfile.mkdtemp(prefix="egress-proof-"))
    business = home / "business"
    business.mkdir(parents=True)
    if policy is not None:
        (business / "whatsapp-policy.json").write_text(json.dumps(policy), encoding="utf-8")
    return home


def _installed_adapter_available():
    root = hermes_agent_root()
    if root is None:
        return None
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    try:
        return importlib.import_module("plugins.platforms.whatsapp.adapter")
    except Exception:
        return None


@unittest.skipIf(_installed_adapter_available() is None,
                 "installed Hermes WhatsApp adapter not importable in this environment")
class LiveEgressProof(unittest.TestCase):
    """Both directions of the policy, through all three doors, on the real adapter."""

    @classmethod
    def setUpClass(cls):
        cls.pkg = PACKAGE
        cls.adapter_module = _installed_adapter_available()

    def _assert_door(self, *, scenario, reached, expect_allowed, door):
        if expect_allowed:
            self.assertTrue(
                reached,
                f"{door} under {scenario}: the guard blocked a send the policy authorizes",
            )
        else:
            self.assertFalse(
                reached,
                f"{door} under {scenario}: transport was handed the message — the guard did NOT block",
            )

    def _adapter_door(self, policy, expect_allowed, scenario):
        transport = importlib.import_module(f"{self.pkg}.transport")
        # No __init__: the instance carries no client and no network path at all.
        adapter = object.__new__(self.adapter_module.WhatsAppAdapter)
        state = {"reached": False}

        async def tripwire_send(chat_id, *args, **kwargs):
            state["reached"] = True
            raise Tripwire(chat_id)

        adapter.send = tripwire_send  # the guard wraps THIS — no real sender exists
        home = _temp_home(policy)
        guarded = transport.guard_adapter(adapter, "whatsapp", lambda: home)
        try:
            asyncio.run(guarded.send(TARGET, "proof"))
        except Tripwire:
            pass
        self._assert_door(scenario=scenario, reached=state["reached"],
                          expect_allowed=expect_allowed, door="adapter.send")

    def _standalone_door(self, policy, expect_allowed, scenario):
        guards = importlib.import_module(f"{self.pkg}.guards")
        state = {"reached": False}

        async def tripwire_standalone(config, chat_id, message_text, **kwargs):
            state["reached"] = True
            raise Tripwire(chat_id)

        home = _temp_home(policy)
        guarded = guards.guard_standalone_sender(tripwire_standalone, lambda: home)
        try:
            asyncio.run(guarded({}, TARGET, "proof"))
        except Tripwire:
            pass
        self._assert_door(scenario=scenario, reached=state["reached"],
                          expect_allowed=expect_allowed, door="standalone sender (cron)")

    def _tool_transport_door(self, policy, expect_allowed, scenario, platform="whatsapp"):
        tool_transport = importlib.import_module(f"{self.pkg}.tool_transport")
        state = {"reached": False}

        async def tripwire_send_to_platform(platform_, chat_id, message, **kwargs):
            state["reached"] = True
            raise Tripwire(chat_id)

        home = _temp_home(policy)
        guarded = tool_transport._make_guard(
            tripwire_send_to_platform, lambda: home, tool_transport._resolve_platform
        )
        try:
            asyncio.run(guarded(platform, TARGET, "proof"))
        except Tripwire:
            pass
        self._assert_door(scenario=scenario, reached=state["reached"],
                          expect_allowed=expect_allowed, door="_send_to_platform (tool/cron)")

    def test_denied_policies_never_reach_transport_on_any_door(self):
        for scenario in ("read_only", "selected_other", "missing_file"):
            with self.subTest(scenario=scenario):
                policy = POLICIES[scenario]
                self._adapter_door(policy, False, scenario)
                self._standalone_door(policy, False, scenario)
                self._tool_transport_door(policy, False, scenario)

    def test_an_approved_chat_reaches_transport_on_every_door(self):
        policy = POLICIES["selected_target"]
        self._adapter_door(policy, True, "selected_target")
        self._standalone_door(policy, True, "selected_target")
        self._tool_transport_door(policy, True, "selected_target")

    def test_uncontrolled_platform_passes_through_untouched(self):
        # Telegram is delegated entirely to native Hermes; this policy must not
        # touch it even while WhatsApp is fully locked down.
        self._tool_transport_door(POLICIES["read_only"], True, "telegram", platform="telegram")


if __name__ == "__main__":
    unittest.main()
