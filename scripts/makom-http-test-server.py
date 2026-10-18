"""Actual Hermes backend in a disposable home, used by the browser test."""
import os
from pathlib import Path
import shutil
import sys
import tempfile

home = Path(sys.argv[1]).resolve()
if not home.is_relative_to(Path(tempfile.gettempdir()).resolve()) or not home.name.startswith("tachles-makom-ui-"):
    raise SystemExit("ISOLATED_MAKOM_TEST_HOME_REQUIRED")
os.environ["HERMES_HOME"] = str(home)
os.environ.pop("HERMES_PROFILE", None)
source = Path(__file__).resolve().parent.parent / "hermes-plugin/business-shell/dashboard"
target = home / "plugins/business-shell/dashboard"
shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "test_*.py"))
(home / "config.yaml").write_text("plugins:\n  enabled: [business-shell]\nmodel:\n  provider: openrouter\n  default: test-not-used\n", encoding="utf-8")
from hermes_cli.profiles import create_profile, get_profile_dir
assert get_profile_dir("default").resolve() == home
create_profile("residents", no_alias=True, no_skills=True, description="תושבי קהילת הבדיקה")
from hermes_cli.web_server import start_server
start_server(host="127.0.0.1", port=int(sys.argv[2]), open_browser=False, headless=True)
