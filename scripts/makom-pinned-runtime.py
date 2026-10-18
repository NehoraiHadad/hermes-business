"""Prepare an immutable TEST runtime without modifying installed Hermes.

Exports the locally available reviewed community-engine SHA and builds a CLI
launcher using the installed Python/dependencies. Never copies credentials.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from pip._vendor.distlib.scripts import ScriptMaker

repo = Path(__file__).resolve().parent.parent
policy = json.loads((repo / "hermes-compat.json").read_text(encoding="utf-8"))["communityEngine"]
installed = Path(sys.executable).resolve().parents[2]
root = Path(tempfile.mkdtemp(prefix="tachles-makom-runtime-")).resolve()
engine = root / "hermes-agent"
engine.mkdir()
archive = root / "source.zip"
subprocess.run(["git", "-C", str(installed), "archive", "--format=zip", "--output=" + str(archive), policy["sha"]], check=True)
with zipfile.ZipFile(archive) as source:
    source.extractall(engine)
archive.unlink()


class PinnedLauncher(ScriptMaker):
    def _get_script_text(self, entry):
        return f"import sys\nsys.path.insert(0, {str(engine)!r})\nfrom hermes_cli.main import main\nif __name__ == '__main__':\n    sys.exit(main())\n"


bin_dir = engine / "venv/Scripts"
bin_dir.mkdir(parents=True)
maker = PinnedLauncher(None, str(bin_dir))
maker.executable = sys.executable
maker.variants = {""}
maker.make("hermes = hermes_cli.main:main")
metadata = {"root": str(root), "engine": str(engine), "launcher": str(bin_dir / "hermes.exe"), "sha": policy["sha"]}
output = repo / ".artifacts/makom"
output.mkdir(parents=True, exist_ok=True)
(output / "pinned-runtime.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print(json.dumps(metadata))
