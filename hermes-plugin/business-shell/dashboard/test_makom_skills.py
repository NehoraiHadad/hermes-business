"""Installed-skill upgrades preserve edits, profile authority and rollback."""
from hashlib import sha256
from pathlib import Path
import tempfile
from threading import RLock
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from makom import skills, store


class SkillUpgradeTests(TestCase):
    def test_only_receipted_or_exact_legacy_content_is_owned(self):
        binding = {"serverName": "makom-one"}
        content = b"previous shipped template"
        self.assertTrue(skills.owns(content, {**binding, "skillDigest": sha256(content).hexdigest()}))
        self.assertFalse(skills.owns(content + b"user edit", {**binding, "skillDigest": sha256(content).hexdigest()}))
        with patch.object(skills, "LEGACY_TEMPLATE_DIGESTS", {sha256(content).hexdigest()}):
            self.assertTrue(skills.owns(content + skills.suffix(binding).encode(), binding))
            self.assertFalse(skills.owns(content + skills.suffix({"serverName": "makom-other"}).encode(), binding))
        self.assertFalse(skills.owns(b"\xff", binding))

    def test_upgrade_is_idempotent_and_saves_receipt_without_changing_other_config(self):
        self.exercise()

    def test_user_edit_is_kept_and_does_not_save_config(self):
        self.exercise(edited=True)

    def test_config_failure_restores_previous_skill(self):
        self.exercise(fail=True)

    def exercise(self, edited=False, fail=False):
        binding = {"serverName": "makom-test", "revision": "rev", "communitySlug": "village"}
        before = b"previous product skill"
        binding["skillDigest"] = sha256(before).hexdigest()
        config = {"tachles_makom": binding, "model": {"provider": "keep"}}
        if edited:
            before += b"\nuser change"
        def save(_home, value):
            if fail:
                raise OSError("simulated write failure")
            config.clear()
            config.update(value)
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            target = skills.skill_path(home)
            target.parent.mkdir(parents=True)
            target.write_bytes(before)
            with patch.dict("sys.modules", {"hermes_cli.config": SimpleNamespace(_CONFIG_LOCK=RLock())}), \
                    patch.object(store, "read_config", return_value=config), patch.object(store, "save_config", side_effect=save) as persist:
                if fail:
                    with self.assertRaises(OSError):
                        skills.refresh(home, binding)
                    self.assertEqual(target.read_bytes(), before)
                elif edited:
                    self.assertFalse(skills.refresh(home, binding))
                    persist.assert_not_called()
                    self.assertEqual(target.read_bytes(), before)
                else:
                    self.assertTrue(skills.refresh(home, binding))
                    self.assertEqual(target.read_bytes(), skills.render_skill(binding))
                    self.assertEqual(config["model"], {"provider": "keep"})
                    self.assertEqual(config["tachles_makom"]["skillDigest"], sha256(target.read_bytes()).hexdigest())
                    self.assertFalse(skills.refresh(home, config["tachles_makom"]))
                    self.assertEqual(persist.call_count, 1)
