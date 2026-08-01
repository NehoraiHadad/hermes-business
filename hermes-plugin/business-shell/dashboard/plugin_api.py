"""Business-shell companion backend — read-only scheduled-task listing.

Hermes 0.19.x mounts this file's ``router`` at ``/api/plugins/business-shell/``
(hermes_cli/web_server.py::_mount_plugin_api_routes), behind the same dashboard
auth middleware as every other ``/api`` route — the plugin inherits Hermes'
authentication, it does not add its own. The Desktop plugin reaches it through
``ctx.rest('/cron/jobs')``, which is namespace-locked BY CONSTRUCTION to this
plugin's own ``/api/plugins/business-shell`` prefix (apps/desktop/src/contrib/
plugin.ts::PluginContext.rest -> apps/desktop/src/hermes.ts::pluginRest).

Why this endpoint exists: the gateway JSON-RPC ``cronjob``/``cron.manage`` door
lists ``list_jobs(include_disabled=False)`` — active jobs only — so a paused task
disappears from the simple business surface. The product requires paused tasks to
stay visible. Rather than shadow a parallel store (which would drift and lie),
this endpoint calls the SAME authoritative scheduler the core ``/api/cron/jobs``
route uses — ``cron.jobs.list_jobs(include_disabled=True)`` — so active+paused
come from ONE source of truth. It is strictly read-only: creating, pausing,
resuming and deleting stay official scheduler operations on the ``cron.manage``
RPC. No secrets, no filesystem paths, no cache.
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
# (cron/jobs.py::_normalize_job_record / the Desktop CronJob type): id, name,
# enabled, schedule (a dict), schedule_display, state, next_run_at. The desktop
# automations screen renders ONLY identity (id/name — also the cron.manage
# mutation key), the human cadence (schedule_display, with the schedule dict as a
# structured fallback), the pause pill + toggle (enabled/state) and the next run
# (next_run_at). It never shows the prompt, delivery target, or any other business
# content — so this read-only door refuses to EMIT them. Projecting to this
# allow-list means a prompt, recipient or secret can never leak through the
# paused-listing surface even if a scheduler row happens to carry one. Legacy
# aliases (cron/paused/next_run) are kept so an older normalizer still renders;
# every field listed here is non-sensitive by construction.
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
    each to the safe field set BEFORE it leaves the process.

    This is the exact call the core ``/api/cron/jobs`` route makes
    (hermes_cli/web_server.py::_list_cron_jobs_sync -> list_jobs(..., True)),
    so the two surfaces can never diverge. The running backend process is the
    active profile's process (its own HERMES_HOME), so an in-process read
    resolves the correct profile's jobs — no cache, one source of truth.
    """
    from cron.jobs import list_jobs

    jobs = list_jobs(include_disabled=include_disabled)
    return [_safe_job(job) for job in (jobs or [])]


@router.get("/cron/jobs")
def cron_jobs() -> Dict[str, Any]:
    """Active + paused scheduled tasks, from the one authoritative scheduler,
    projected to the minimal safe field set.

    Shape mirrors the gateway ``cron.manage`` list the Desktop plugin already
    normalizes (``{"jobs": [...]}``), so the client treats both doors
    identically — this one simply also includes ``enabled: false`` (paused)
    rows. Fail closed: any scheduler error yields an empty, well-formed body
    (never the exception text, which could echo a prompt or path), and the
    client degrades to the active-only cron.manage door.
    """
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
