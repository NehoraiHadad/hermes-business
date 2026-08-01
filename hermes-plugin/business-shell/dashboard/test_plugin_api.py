"""Security + contract unit tests for the read-only companion backend door.

Run: ``python -m unittest hermes-plugin/business-shell/dashboard/test_plugin_api.py``
(or point unittest at this file). It loads ``plugin_api.py`` directly and injects a
fake ``cron.jobs`` module, so it needs neither FastAPI nor a real Hermes install.

The door is the ONLY new network surface, so these tests pin its security
contract: (1) it emits only the minimal UI fields and never leaks a prompt or
delivery target, (2) it reads the authoritative scheduler live on every call with
no cache, (3) it fails closed — a scheduler error yields an empty body, never the
exception text — and (4) it stays read-only (only a GET handler exists).
"""
import importlib.util
import os
import sys
import types
import unittest
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))


def _install_fake_cron(list_jobs):
    cron = types.ModuleType("cron")
    jobs_mod = types.ModuleType("cron.jobs")
    jobs_mod.list_jobs = list_jobs
    cron.jobs = jobs_mod
    sys.modules["cron"] = cron
    sys.modules["cron.jobs"] = jobs_mod


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "business_shell_plugin_api", os.path.join(_HERE, "plugin_api.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PluginApiSecurityTests(unittest.TestCase):
    def tearDown(self):
        sys.modules.pop("cron.jobs", None)
        sys.modules.pop("cron", None)

    def test_projection_drops_prompt_and_business_content(self):
        module = _load_module()
        raw = {
            "id": "job-1",
            "name": "Morning summary",
            "schedule": "0 8 * * 0-4",
            "enabled": False,
            "next_run": "2026-08-02T05:00:00Z",
            "prompt": "SECRET business prompt with client names",
            "deliver": "telegram:+972500000000",
            "args": {"phone": "+972500000000"},
        }
        safe = module._safe_job(raw)
        self.assertEqual(safe["name"], "Morning summary")
        self.assertIs(safe["enabled"], False)
        self.assertEqual(safe["schedule"], "0 8 * * 0-4")
        for leaked in ("prompt", "deliver", "args"):
            self.assertNotIn(leaked, safe)

    def test_projection_emits_official_schema_fields(self):
        # Hermes' authoritative normalized CronJob schema (cron/jobs.py::
        # _normalize_job_record / Desktop CronJob): the door must project the
        # official fields — including schedule_display/state/next_run_at — while
        # still dropping business content.
        module = _load_module()
        raw = {
            "id": "job-1",
            "name": "Morning summary",
            "enabled": False,
            "schedule": {"kind": "cron", "expr": "0 9 * * *"},
            "schedule_display": "כל יום בשעה 09:00",
            "state": "paused",
            "next_run_at": "2026-08-02T09:00:00Z",
            "prompt": "SECRET prompt",
            "deliver": "telegram:+972500000000",
            "args": {"phone": "+972500000000"},
        }
        safe = module._safe_job(raw)
        for key in ("id", "name", "enabled", "schedule", "schedule_display", "state", "next_run_at"):
            self.assertIn(key, safe)
        self.assertEqual(safe["schedule_display"], "כל יום בשעה 09:00")
        self.assertEqual(safe["state"], "paused")
        for leaked in ("prompt", "deliver", "args"):
            self.assertNotIn(leaked, safe)

    def test_projection_handles_attribute_objects(self):
        module = _load_module()

        class Row:
            id = "j"
            name = "n"
            enabled = True
            prompt = "secret"

        safe = module._safe_job(Row())
        self.assertEqual(safe, {"id": "j", "name": "n", "enabled": True})

    def test_endpoint_lists_active_and_paused_without_leaking(self):
        list_jobs = mock.Mock(return_value=[
            {"id": "a", "name": "active", "enabled": True, "prompt": "p1"},
            {"id": "b", "name": "paused", "enabled": False, "prompt": "p2"},
        ])
        _install_fake_cron(list_jobs)
        module = _load_module()
        body = module.cron_jobs()
        list_jobs.assert_called_once_with(include_disabled=True)
        self.assertTrue(body["paused_listing_supported"])
        self.assertEqual(len(body["jobs"]), 2)
        paused = next(j for j in body["jobs"] if j["name"] == "paused")
        self.assertIs(paused["enabled"], False)
        self.assertNotIn("prompt", paused)

    def test_no_cache_reads_scheduler_on_every_call(self):
        list_jobs = mock.Mock(return_value=[])
        _install_fake_cron(list_jobs)
        module = _load_module()
        module.cron_jobs()
        module.cron_jobs()
        self.assertEqual(list_jobs.call_count, 2)

    def test_fails_closed_and_never_leaks_the_error(self):
        list_jobs = mock.Mock(side_effect=RuntimeError("boom: /secret/path prompt"))
        _install_fake_cron(list_jobs)
        module = _load_module()
        body = module.cron_jobs()
        self.assertEqual(body["jobs"], [])
        self.assertFalse(body["paused_listing_supported"])
        self.assertTrue(body.get("degraded"))
        self.assertNotIn("boom", str(body))

    def test_door_stays_read_only(self):
        # The companion backend is strictly READ-ONLY: no write verb anywhere. The
        # business-context skill is persisted through the official Hermes Skills API
        # (immutable versioned create + enable/disable toggle), so there is NO custom
        # write route — no POST/PUT/DELETE/PATCH of any kind on this router.
        with open(os.path.join(_HERE, "plugin_api.py"), encoding="utf-8") as handle:
            source = handle.read()
        for verb in ("router.post", "router.put", "router.delete", "router.patch"):
            self.assertNotIn(verb, source)


if __name__ == "__main__":
    unittest.main()
