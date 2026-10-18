"""Transactional configuration of the one existing Hermes installation.

Only the named connection, its shipped skill and its exact toolset membership
are owned here. No gateway, messaging, credentials or model configuration.
"""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import os
import sys
import tempfile
import uuid
from .contract import server_name, SKILL


@contextmanager
def scope(home):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    token = set_hermes_home_override(str(home))
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def profiles():
    # Native list_profiles also probes gateways and installed shell aliases.
    # A source picker needs only native profile identities and their labels.
    from hermes_cli import profiles as native
    names = ["default"]
    root = native._get_profiles_root()
    if root.exists():
        with os.scandir(root) as entries:
            names += sorted(entry.name for entry in entries if entry.is_dir() and native._PROFILE_ID_RE.fullmatch(entry.name))
    return [{"id": name, "label": native.read_profile_meta(native.get_profile_dir(name)).get("description") or ("העוזר הראשי" if name == "default" else name)} for name in names]


def profile_home(name):
    from hermes_cli.profiles import get_profile_dir, profile_exists, validate_profile_name
    validate_profile_name(name)
    if not profile_exists(name):
        raise ValueError("המרחב שנבחר אינו קיים")
    return get_profile_dir(name).resolve()


def read_config(home):
    from hermes_cli.config import load_config
    with scope(home):
        return load_config()


def save_config(home, config):
    from hermes_cli.config import save_config as native_save
    with scope(home):
        native_save(config)


def binding_for(name):
    config = read_config(profile_home(name))
    binding = config.get("tachles_makom")
    return binding if isinstance(binding, dict) else None


def server_config(home, binding):
    entry = Path(__file__).resolve().parent.parent / "makom_bridge.py"
    return {"command": sys.executable, "args": [str(entry), str(home), binding["revision"]],
        "enabled": True, "timeout": 18, "connect_timeout": 20}


def skill_path(home):
    target = home / "skills" / "community" / SKILL / "SKILL.md"
    if not target.resolve().is_relative_to(home):
        raise ValueError("תיקיית הסקיל נמצאת מחוץ למרחב שנבחר")
    return target


def configured(name):
    home = profile_home(name)
    cfg = read_config(home)
    binding = cfg.get("tachles_makom")
    if not binding:
        return False
    skill = skill_path(home)
    return (binding.get("serverName") == server_name(home, binding)
        and cfg.get("mcp_servers", {}).get(binding["serverName"]) == server_config(home, binding)
        and skill.exists() and skill.read_bytes() == render_skill(binding)
        and all(not isinstance(tools, list) or "mcp-" + binding["serverName"] in tools for tools in cfg.get("platform_toolsets", {}).values()))


def render_skill(binding):
    template = Path(__file__).with_name("SKILL.md").read_text(encoding="utf-8")
    return (template.rstrip() + "\n\nחיבור המרחב: `" + binding["serverName"] + "`.\n").encode("utf-8")


def planned(config, home, binding):
    result = deepcopy(config)
    servers = result.setdefault("mcp_servers", {})
    previous = result.get("tachles_makom")
    old_name = previous.get("serverName") if previous else None
    if previous and old_name != server_name(home, previous):
        raise ValueError("הגדרת החיבור השתנתה ידנית; לא ניתן להחליף חיבור אחר")
    if old_name in servers and servers[old_name] != server_config(home, previous):
        raise ValueError("הגדרת שרת מקום שונתה ידנית; היא לא תוחלף")
    next_binding = {**binding, "serverName": server_name(home, binding)} if binding else None
    if next_binding and next_binding["serverName"] in servers and next_binding["serverName"] != old_name:
        raise ValueError("קיים חיבור ידני באותו שם; הוא לא יוחלף")
    if old_name:
        servers.pop(old_name, None)
    if binding:
        result["tachles_makom"] = next_binding
        servers[next_binding["serverName"]] = server_config(home, next_binding)
    else:
        result.pop("tachles_makom", None)
    # Preserve every other native fence. The admin/default runtime has no pin.
    for tools in result.get("platform_toolsets", {}).values():
        if isinstance(tools, list):
            tools[:] = [item for item in tools if not old_name or item != "mcp-" + old_name]
            if binding:
                tools.append("mcp-" + next_binding["serverName"])
    disabled = result.get("skills", {}).get("disabled", [])
    if binding and isinstance(disabled, list) and SKILL in disabled:
        raise ValueError("הסקיל של מקום כובה ידנית; הפעילו אותו לפני החיבור")
    return result


def apply(selection, binding):
    """All selected profiles commit together; rollback uses exact file bytes."""
    from hermes_cli.config import _CONFIG_LOCK
    if not selection or len(selection) > 50 or len(set(selection)) != len(selection):
        raise ValueError("בחרו מרחב אחד לפחות, ללא כפילויות")
    homes = [profile_home(name) for name in selection]
    if binding:
        # Probe the SAME bridge with a disposable binding before taking Hermes'
        # config lock. MCP discovery itself may read native configuration.
        import hermes_yaml as yaml
        from hermes_cli.mcp_config import _probe_single_server
        with tempfile.TemporaryDirectory(prefix="tachles-makom-probe-") as directory:
            temporary_home = Path(directory)
            probe_binding = {**binding, "serverName": server_name(temporary_home, binding)}
            config = {"tachles_makom": probe_binding, "mcp_servers": {probe_binding["serverName"]: {"enabled": True}}}
            (temporary_home / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
            tools = _probe_single_server(probe_binding["serverName"], server_config(temporary_home, probe_binding))
            if len(tools) != 6:
                raise ValueError("כלי מקום לא נטענו ב־Hermes")
    snapshots = []
    with _CONFIG_LOCK:
        plans = []
        for home in homes:
            config = read_config(home)
            skill = skill_path(home)
            before = skill.read_bytes() if skill.exists() else None
            if before is not None and not config.get("tachles_makom"):
                raise ValueError("במרחב קיים סקיל אחר בשם מקום; הוא לא יוחלף")
            if before is not None and before != render_skill(config["tachles_makom"]):
                raise ValueError("הסקיל של מקום השתנה ידנית; הוא לא יוחלף")
            target = home / "config.yaml"
            snapshots.append((target, target.read_bytes() if target.exists() else None, skill, before))
            next_config = planned(config, home, binding)
            template = render_skill(next_config["tachles_makom"]) if binding else None
            plans.append((home, next_config, skill, template))
        try:
            for home, config, skill, template in plans:
                if binding:
                    skill.parent.mkdir(parents=True, exist_ok=True)
                    temporary = skill.with_suffix(".tmp")
                    temporary.write_bytes(template)
                    os.replace(temporary, skill)
                save_config(home, config)
                written = read_config(home)
                if written.get("tachles_makom") != config.get("tachles_makom") or written.get("mcp_servers", {}) != config["mcp_servers"]:
                    raise ValueError("Hermes לא אישר את שמירת החיבור")
                if not binding and skill.exists():
                    skill.unlink()
        except Exception:
            for target, before, skill, previous in reversed(snapshots):
                for path, content in ((target, before), (skill, previous)):
                    if content is None:
                        path.unlink(missing_ok=True)
                    else:
                        path.write_bytes(content)
            raise


def new_binding(resolved):
    return {**resolved, "revision": str(uuid.uuid4())}
