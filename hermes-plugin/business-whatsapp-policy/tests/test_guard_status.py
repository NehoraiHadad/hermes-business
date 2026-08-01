"""Contract tests for the live guard-status heartbeat builder/writer.

These verify the pure logic without a real Hermes: `enforcing` is true ONLY when the
transport is bound AND the dispatch hook is registered; the process role is classified
from argv; and `capture` writes a role-scoped heartbeat with the required verification
fields. They intentionally do NOT require the send_message engine — in a bare env the
transport is (correctly) reported unbound, so enforcing is false (honest, fail-closed).
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import guard_status  # noqa: E402


class BuildGuardStatusTests(unittest.TestCase):
    def _status(self, **over):
        base = dict(
            pid=1234,
            nonce="deadbeef",
            role="gateway",
            version="0.2.0",
            hooks=["pre_gateway_dispatch", "pre_tool_call"],
            transport_ok=True,
            families=guard_status.GUARD_FAMILIES,
            modes={"whatsapp": {"mode": "read_only", "reply_chats": 2}},
            started_at="2026-08-01T12:00:00.000000Z",
            updated_at="2026-08-01T12:00:10.000000Z",
        )
        base.update(over)
        return guard_status.build_guard_status(**base)

    def test_enforcing_requires_transport_and_dispatch_hook(self):
        self.assertTrue(self._status()["enforcing"])
        # No transport binding -> not enforcing, even with the hook.
        self.assertFalse(self._status(transport_ok=False)["enforcing"])
        # No dispatch hook -> not enforcing, even with transport bound.
        self.assertFalse(self._status(hooks=["pre_tool_call"])["enforcing"])

    def test_carries_verification_fields_and_flat_parser_fields(self):
        s = self._status()
        for key in (
            "plugin_loaded",
            "enforcing",
            "hooks",
            "mode",
            "reply_chats",
            "schema",
            "pid",
            "nonce",
            "process_role",
            "plugin_version",
            "transport_bound",
            "guard_families",
            "started_at",
            "updated_at",
            "ttl_seconds",
        ):
            self.assertIn(key, s)
        self.assertTrue(s["plugin_loaded"])
        self.assertEqual(s["process_role"], "gateway")
        self.assertEqual(s["mode"], "read_only")
        self.assertEqual(s["reply_chats"], 2)
        self.assertIn("pre_gateway_dispatch", s["hooks"])

    def test_never_leaks_business_content(self):
        # modes carry only mode + a count, never chat ids / prompts.
        s = self._status(modes={"whatsapp": {"mode": "selected_chats", "reply_chats": 3}})
        blob = json.dumps(s)
        self.assertNotIn("+", blob)  # no phone numbers
        self.assertEqual(s["reply_chats"], 3)


class ProcessRoleTests(unittest.TestCase):
    def test_classifies_gateway_serve_other(self):
        self.assertEqual(guard_status.process_role(["hermes", "gateway", "run"]), "gateway")
        self.assertEqual(guard_status.process_role(["hermes", "serve", "--port", "1"]), "serve")
        self.assertEqual(guard_status.process_role(["hermes", "dashboard"]), "serve")
        self.assertEqual(guard_status.process_role(["python", "-c", "x"]), "other")


class TransportBoundTests(unittest.TestCase):
    def test_unbound_when_engine_absent(self):
        # No tools.send_message_tool importable in this bare env -> honestly unbound.
        self.assertFalse(guard_status.transport_bound())


class CaptureTests(unittest.TestCase):
    def test_capture_writes_role_scoped_heartbeat(self):
        with tempfile.TemporaryDirectory() as home:
            status = guard_status.capture(
                home_getter=lambda: home,
                declared_hooks=("pre_gateway_dispatch", "pre_tool_call"),
                nonce="nonce-1",
                now_iso="2026-08-01T12:00:00.000000Z",
            )
            self.assertIsNotNone(status)
            path = guard_status.heartbeat_path(home, status["process_role"])
            self.assertTrue(os.path.exists(path))
            with open(path, encoding="utf-8") as handle:
                on_disk = json.load(handle)
            self.assertEqual(on_disk["nonce"], "nonce-1")
            self.assertIn("pre_gateway_dispatch", on_disk["hooks"])
            # In a bare env the transport is unbound → enforcing is honestly false.
            self.assertFalse(on_disk["enforcing"])

    def test_capture_returns_none_without_home(self):
        self.assertIsNone(guard_status.capture(home_getter=None))


if __name__ == "__main__":
    unittest.main()
