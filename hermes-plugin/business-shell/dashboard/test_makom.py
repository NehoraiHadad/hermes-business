"""Pure connection boundary and configuration regression tests."""
from copy import deepcopy
from pathlib import Path
import tempfile
from threading import RLock
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from makom.contract import parse_link, bound_arguments, server_name
from makom import store
from makom.store import planned


class MakomContractTests(unittest.TestCase):
    def setUp(self):
        # Pure configuration tests model the native launch API; the real PM
        # bootstrap/stdio handshake is exercised by the installed-runtime E2E.
        native = SimpleNamespace(__file__=str(Path("engine/hermes_cli/_launchers.py").resolve()),
            runtime_command=lambda root, args, **kwargs: ["native-python", "-I", "-c", kwargs["code"], *args])
        self.launcher = patch.dict("sys.modules", {"hermes_cli": SimpleNamespace(_launchers=native), "hermes_cli._launchers": native,
            "pm.environments": SimpleNamespace(owning_home_root=lambda root: Path("install-owner"), dependency_home_root=lambda: Path("unrelated-profile"))})
        self.launcher.start()
        self.addCleanup(self.launcher.stop)

    def test_worker_uses_native_bootstrap_and_preserves_profile_arguments(self):
        config = store.server_config(Path("profile with spaces"), {"revision": "rev"})
        self.assertEqual(config["command"], "native-python")
        self.assertEqual(config["env"], {"HERMES_HOME": "install-owner"})
        self.assertEqual(config["args"][:2], ["-I", "-c"])
        self.assertEqual(config["args"][-2:], ["profile with spaces", "rev"])
        self.assertIn("runpy.run_path", config["args"][2])

    def test_native_probe_failure_does_not_write_configuration(self):
        import yaml
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            target = home / "config.yaml"
            target.write_bytes(b"# preserve exactly\n")
            def fail(*_):
                raise RuntimeError("native failure with private diagnostic")
            with patch.dict("sys.modules", {"hermes_yaml": yaml,
                    "hermes_cli.config": SimpleNamespace(_CONFIG_LOCK=RLock()),
                    "hermes_cli.mcp_config": SimpleNamespace(_probe_single_server=fail)}), \
                    patch.object(store, "profile_home", return_value=home):
                with self.assertRaises(ValueError) as error:
                    store.apply(["default"], {"revision": "rev"})
            self.assertNotIn("private diagnostic", str(error.exception))
            self.assertEqual(target.read_bytes(), b"# preserve exactly\n")
            self.assertFalse(store.skill_path(home).exists())

    def test_skill_is_valid_and_fits_hermes_discovery_budget(self):
        import yaml
        text = (Path(__file__).parent / "makom/SKILL.md").read_text(encoding="utf-8")
        metadata = yaml.safe_load(text.split("---", 2)[1])
        self.assertEqual(metadata["name"], "makom-community")
        self.assertLessEqual(len(metadata["description"]), 60)

    def test_link_resolves_only_explicit_community(self):
        self.assertEqual(parse_link("https://community.example/public/village")["communitySlug"], "village")
        self.assertEqual(parse_link("http://127.0.0.1:8000/c/village")["origin"], "http://127.0.0.1:8000")
        for value in ("https://community.example", "https://user:secret@community.example/public/village", "http://10.0.0.1/public/village", "https://community.example/public/village?token=secret"):
            with self.assertRaises(ValueError):
                parse_link(value)

    def test_agent_cannot_choose_community_or_write(self):
        binding = {"communitySlug": "village"}
        self.assertEqual(bound_arguments(binding, "get_public_prayer_day", {"localDate": "2026-10-18"})["communitySlug"], "village")
        for name, args in (("write_information", {}), ("get_public_prayer_day", {"communitySlug": "other"})):
            with self.assertRaises(ValueError):
                bound_arguments(binding, name, args)

    def test_connection_preserves_existing_fences_and_unrelated_configuration(self):
        before = {"model": {"provider": "existing"}, "platform_toolsets": {"whatsapp": ["web", "skills"]}, "messaging": {"whatsapp": {"enabled": False}}, "mcp_servers": {"existing": {"url": "https://example.com"}}}
        original = deepcopy(before)
        home, binding = Path("profile"), {"revision": "one"}
        name = server_name(home, binding)
        result = planned(before, home, binding)
        self.assertEqual(before, original)
        self.assertEqual(result["platform_toolsets"]["whatsapp"], ["web", "skills", "mcp-" + name])
        self.assertEqual(result["messaging"], before["messaging"])
        self.assertEqual(result["mcp_servers"]["existing"], before["mcp_servers"]["existing"])
        self.assertIn(name, result["mcp_servers"])
        disconnected = planned(result, Path("profile"), None)
        self.assertNotIn(name, disconnected["mcp_servers"])
        self.assertEqual(disconnected["platform_toolsets"], before["platform_toolsets"])

    def test_foreign_connection_and_manually_disabled_skill_are_not_overwritten(self):
        name = server_name(Path("profile"), {"revision": "one"})
        for config in ({"mcp_servers": {name: {"command": "manual"}}}, {"skills": {"disabled": ["makom-community"]}}):
            with self.assertRaises(ValueError):
                planned(config, Path("profile"), {"revision": "one"})

    def test_profile_and_revision_names_are_distinct_and_replace_exact_fence(self):
        home = Path("profile")
        first = planned({"platform_toolsets": {"whatsapp": ["web"]}}, home, {"revision": "one"})
        old = first["tachles_makom"]["serverName"]
        second = planned(first, home, {"revision": "two"})
        new = second["tachles_makom"]["serverName"]
        self.assertNotEqual(old, new)
        self.assertNotEqual(old, server_name(Path("another"), {"revision": "one"}))
        self.assertNotIn(old, second["mcp_servers"])
        self.assertEqual(second["platform_toolsets"]["whatsapp"], ["web", "mcp-" + new])
        self.assertLessEqual(len("mcp__" + new + "__list_public_prayer_calendars"), 64)

    def test_disconnect_rolls_back_exact_config_and_skill_bytes_across_profiles(self):
        import yaml
        with tempfile.TemporaryDirectory() as directory:
            homes, snapshots = {}, {}
            for name in ("one", "two"):
                home = Path(directory, name).resolve()
                home.mkdir()
                cfg = planned({}, home, {"revision": "test"})
                target = home / "config.yaml"
                target.write_text(yaml.safe_dump(cfg), encoding="utf-8")
                skill = store.skill_path(home)
                skill.parent.mkdir(parents=True)
                skill.write_bytes(store.render_skill(cfg["tachles_makom"]))
                homes[name] = home
                snapshots[target] = target.read_bytes()
                snapshots[skill] = skill.read_bytes()

            def save(home, cfg):
                if home == homes["two"]:
                    raise OSError("simulated second profile failure")
                (home / "config.yaml").write_text(yaml.safe_dump(cfg), encoding="utf-8")

            with patch.dict("sys.modules", {"hermes_cli.config": SimpleNamespace(_CONFIG_LOCK=RLock())}), \
                    patch.object(store, "profile_home", side_effect=homes.__getitem__), \
                    patch.object(store, "read_config", side_effect=lambda home: yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))), \
                    patch.object(store, "save_config", side_effect=save):
                with self.assertRaises(OSError):
                    store.apply(["one", "two"], None)
            for target, content in snapshots.items():
                self.assertEqual(target.read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
