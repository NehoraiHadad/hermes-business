"""Business-shell companion backend — router + read-only scheduled-task projection.

Hermes 0.19.x mounts this file's ``router`` at ``/api/plugins/business-shell/``
(hermes_cli/web_server.py::_mount_plugin_api_routes), behind the same dashboard
auth middleware as every other ``/api`` route — the plugin inherits Hermes'
authentication, it does not add its own. The Desktop plugin reaches it through
``ctx.rest('/cron/jobs')``, which is namespace-locked BY CONSTRUCTION to this
plugin's own ``/api/plugins/business-shell`` prefix (apps/desktop/src/contrib/
plugin.ts::PluginContext.rest -> apps/desktop/src/hermes.ts::pluginRest).

This file is deliberately thin and strictly READ-ONLY: it owns the FastAPI routing
and the read-only scheduled-task PROJECTION (the ``GET /cron/jobs`` door below). It
adds NO write surface — the business-context skill is persisted entirely through the
official Hermes Skills API (immutable versioned create + enable/disable toggle), so
there is no companion write engine to mount here.

Why the cron door exists: the gateway JSON-RPC ``cronjob``/``cron.manage`` door
lists ``list_jobs(include_disabled=False)`` — active jobs only — so a paused task
disappears from the simple business surface. Rather than shadow a parallel store
(which would drift and lie), this endpoint calls the SAME authoritative scheduler
the core ``/api/cron/jobs`` route uses — ``list_jobs(include_disabled=True)`` — so
active+paused come from ONE source of truth. It is strictly read-only; creating,
pausing, resuming and deleting stay ``cron.manage`` operations. No cache.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping

try:
    from fastapi import APIRouter
except Exception:  # pragma: no cover - allows unit import without FastAPI present.
    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

router = APIRouter()

# Minimal, safe projection onto Hermes' AUTHORITATIVE normalized CronJob schema
# (cron/jobs.py::_normalize_job_record / the Desktop CronJob type). The desktop
# automations screen renders ONLY identity (id/name — also the cron.manage mutation
# key), the human cadence (schedule_display + the schedule dict fallback), the pause
# pill + toggle (enabled/state) and the next run (next_run_at) — never the prompt,
# delivery target or any other business content. Projecting to this allow-list means
# a prompt, recipient or secret can never leak through the paused-listing surface
# even if a scheduler row carries one. Legacy aliases (cron/paused/next_run) are kept
# so an older normalizer still renders; every field here is non-sensitive by construction.
_SAFE_FIELDS = (
    "id",
    "name",
    "enabled",
    "schedule",
    "schedule_display",
    "state",
    "next_run_at",
    # Legacy aliases from older Hermes normalizers, kept for back-compat.
    "cron",
    "paused",
    "next_run",
)
_MISSING = object()


def _safe_job(job: Any) -> Dict[str, Any]:
    """Copy ONLY the UI-required fields off a scheduler row, dropping everything
    else (prompt/deliver/args/...). Works for dict rows and attribute objects."""
    safe: Dict[str, Any] = {}
    for key in _SAFE_FIELDS:
        value = job.get(key, _MISSING) if isinstance(job, Mapping) else getattr(job, key, _MISSING)
        if value is not _MISSING:
            safe[key] = value
    return safe


def _list_scheduled_tasks(include_disabled: bool) -> List[Dict[str, Any]]:
    """Read jobs straight from Hermes' authoritative scheduler store, then project
    each to the safe field set BEFORE it leaves the process. This is the exact call
    the core ``/api/cron/jobs`` route makes (list_jobs(..., True)), so the two
    surfaces can never diverge. No cache, one source of truth."""
    from cron.jobs import list_jobs

    jobs = list_jobs(include_disabled=include_disabled)
    return [_safe_job(job) for job in (jobs or [])]


@router.get("/cron/jobs")
def cron_jobs() -> Dict[str, Any]:
    """Active + paused scheduled tasks, projected to the minimal safe field set.
    Fail closed: any scheduler error yields an empty, well-formed body (never the
    exception text), and the client degrades to the active-only cron.manage door."""
    try:
        jobs = _list_scheduled_tasks(include_disabled=True)
    except Exception:
        return {
            "jobs": [],
            "paused_listing_supported": False,
            "source": "unavailable",
            "degraded": True,
        }
    return {
        "jobs": jobs,
        "paused_listing_supported": True,
        "source": "cron.jobs.list_jobs(include_disabled=True)",
    }
