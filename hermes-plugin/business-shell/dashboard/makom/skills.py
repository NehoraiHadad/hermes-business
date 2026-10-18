"""Upgrade only a provably product-owned skill; keep user edits untouched."""
from hashlib import sha256
from pathlib import Path
import os

# Installed alpha.13 bindings predate skill receipts. Recognize that exact
# shipped template by digest, without keeping its obsolete instructions alive.
LEGACY_TEMPLATE_DIGESTS = {"2136ef0e7864ca28b06ae6f736c0bba1fc39e09c910a09be0923c01ffb0d0631"}


def skill_path(home):
    target = home / "skills" / "community" / "makom-community" / "SKILL.md"
    if not target.resolve().is_relative_to(home):
        raise ValueError("תיקיית הסקיל נמצאת מחוץ למרחב שנבחר")
    return target


def suffix(binding):
    return "\n\nחיבור המרחב: `" + binding["serverName"] + "`.\n"


def render_skill(binding):
    template = Path(__file__).with_name("SKILL.md").read_text(encoding="utf-8")
    # Known native names let Hermes invoke a deferred tool without search/describe.
    prefix = "mcp__" + binding["serverName"].replace("-", "_") + "__"
    names = "\n\nשמות הכלים המלאים בחיבור:\n" + "\n".join(
        "- `" + prefix + name + "`" for name in (
            "get_public_prayer_day", "get_public_service_hours", "get_public_event_timetable",
            "get_public_resource", "search_public_information", "list_public_prayer_calendars"))
    return (template.rstrip() + names + suffix(binding)).encode("utf-8")


def owns(content, binding):
    if content == render_skill(binding):
        return True
    if binding.get("skillDigest") == sha256(content).hexdigest():
        return True
    tail = suffix(binding)
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return text.endswith(tail) and sha256(text[:-len(tail)].encode()).hexdigest() in LEGACY_TEMPLATE_DIGESTS


def refresh(home, binding):
    from . import store
    from hermes_cli.config import _CONFIG_LOCK
    with _CONFIG_LOCK:
        return _refresh(home, binding, store)


def _refresh(home, binding, store):
    target = skill_path(home)
    before = target.read_bytes() if target.exists() else None
    wanted = render_skill(binding)
    if before is None or not owns(before, binding):
        return False
    config = store.read_config(home)
    current = config.get("tachles_makom", {})
    if current.get("revision") != binding["revision"]:
        raise ValueError("Connection changed during skill update")
    digest = sha256(wanted).hexdigest()
    if before == wanted and current.get("skillDigest") == digest:
        return False
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(wanted)
    os.replace(temporary, target)
    try:
        store.save_config(home, {**config, "tachles_makom": {**current, "skillDigest": digest}})
    except Exception:
        target.write_bytes(before)
        raise
    return True
