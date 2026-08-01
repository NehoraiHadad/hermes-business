"""Enable — or verify — a Hermes plugin in <HERMES_HOME>/config.yaml, robustly.

Usage:
  python enable_plugin.py <config_path> <plugin_id>            # enable (idempotent)
  python enable_plugin.py --check <config_path> <plugin_id>    # health query

A dashboard-only backend plugin (business-shell) is not agent-discoverable, so
`hermes plugins enable` cannot resolve it — the sanctioned enable is the
config.yaml `plugins.enabled` allow-list the web server's mount gate reads
(hermes_cli/plugins_cmd.py::_get_enabled_set). Mirrors the Electron/dev installers
(electron/backend-install.cjs, scripts/install-plugin.mjs) for the PowerShell path.
Using Hermes' own PyYAML means we never hand-edit YAML. Fails closed (non-zero).

Enabling mirrors `hermes plugins enable` (cmd_enable) EXACTLY: add the id to
plugins.enabled AND remove it from plugins.disabled — Hermes' disabled list takes
precedence, so an id in both never loads. `--check` is the SEMANTIC health gate: it
exits 0 only when the id is an exact element of plugins.enabled AND absent from
plugins.disabled, failing closed (non-zero) on malformed YAML, a missing file/key,
a comment-only mention, a disabled-only or enabled-AND-disabled entry, or a
substring. It never echoes config or secrets.
"""
import sys

import yaml


def _load_config(config_path: str) -> dict:
    """Parse the YAML config into a dict; a non-dict document yields {}.

    Raises FileNotFoundError for a missing file and yaml.YAMLError for malformed
    YAML — callers decide whether that is an empty-config default or a failure.
    """
    with open(config_path, "r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    return loaded if isinstance(loaded, dict) else {}


def is_enabled(config_path: str, plugin_id: str) -> bool:
    """True only when plugin_id is an EXACT element of plugins.enabled AND is not
    present in plugins.disabled (which Hermes honours with precedence).

    Fails closed to False for a non-dict config/plugins map, a non-list enabled
    list, a substring/comment/disabled-only mention, and — critically — an id in
    BOTH enabled and disabled (Hermes would never load it). Propagates
    FileNotFoundError / yaml.YAMLError so the caller can tell it from "unreadable".
    """
    config = _load_config(config_path)
    plugins = config.get("plugins")
    if not isinstance(plugins, dict):
        return False
    enabled = plugins.get("enabled")
    if not isinstance(enabled, list):
        return False
    disabled = plugins.get("disabled")
    if isinstance(disabled, list) and plugin_id in disabled:
        return False  # disabled precedence blocks load even when also enabled
    return plugin_id in enabled


def enable(config_path: str, plugin_id: str) -> str:
    """Idempotently add plugin_id to plugins.enabled, fail-closed on a config we
    cannot safely rewrite.

    An absent or empty document is a legitimate empty config. A non-mapping document
    is a real user config we NEVER clobber (raise ValueError); malformed YAML
    propagates as yaml.YAMLError. Mirrors `hermes plugins enable`: add the id to
    plugins.enabled AND drop it from plugins.disabled (disabled precedence would
    otherwise keep a both-listed plugin from loading). Only when the id is already
    enabled AND absent from a well-formed disabled list do we return WITHOUT
    rewriting, so an already-correct config survives byte-for-byte.
    """
    try:
        with open(config_path, "r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle)
    except FileNotFoundError:
        loaded = None

    if loaded is None:
        config: dict = {}
    elif isinstance(loaded, dict):
        config = loaded
    else:
        raise ValueError("config.yaml is not a mapping")

    plugins = config.get("plugins")
    if not isinstance(plugins, dict):
        plugins = {}
    enabled = plugins.get("enabled")
    if not isinstance(enabled, list):
        enabled = []
    disabled = plugins.get("disabled")
    disabled_is_list = isinstance(disabled, list)
    already = (
        plugin_id in enabled and disabled_is_list
        and plugin_id not in disabled and config.get("plugins") is plugins
    )
    if already:
        return "already-enabled"  # no write — preserve the config byte-for-byte
    if plugin_id not in enabled:
        enabled.append(plugin_id)
    plugins["enabled"] = enabled
    # Drop the id from disabled so Hermes' disabled precedence can't block load.
    plugins["disabled"] = [x for x in disabled if x != plugin_id] if disabled_is_list else []
    config["plugins"] = plugins

    with open(config_path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(config, handle, allow_unicode=True, sort_keys=False)
    return "enabled"


def _run_check(config_path: str, plugin_id: str) -> int:
    # Report only the failure CLASS on stderr; never echo config or secrets.
    try:
        ok = is_enabled(config_path, plugin_id)
    except FileNotFoundError:
        sys.stderr.write("check: config.yaml is missing\n")
        return 1
    except yaml.YAMLError:
        sys.stderr.write("check: config.yaml is not valid YAML\n")
        return 1
    if ok:
        print("enabled")
        return 0
    sys.stderr.write("check: plugin is not an enabled (and not-disabled) plugin\n")
    return 1


def main() -> int:
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == "--check":
        return _run_check(args[1], args[2])
    if len(args) == 2 and not args[0].startswith("--"):
        # Report only the failure CLASS on stderr; never echo config text or a
        # parser message (a YAMLError str embeds the offending config snippet).
        try:
            result = enable(args[0], args[1])
        except yaml.YAMLError:
            sys.stderr.write("enable: config.yaml is not valid YAML\n")
            return 1
        except ValueError:
            sys.stderr.write("enable: config.yaml is not a mapping\n")
            return 1
        print(result)
        return 0
    sys.stderr.write("usage: enable_plugin.py [--check] <config_path> <plugin_id>\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
