"""Prepare an immutable TEST runtime without modifying installed Hermes.

Resolves the latest official stable release and provisions its hash-locked
Python/dependencies through the official PM, then builds a test CLI entrypoint. The upstream stamp writer records its verified
release identity. Never modifies the operator's engine or copies credentials.
"""
import json
from pathlib import Path
import subprocess
import os
import shutil
import sys
import tempfile
import re
import urllib.request
import zipfile

repo = Path(__file__).resolve().parent.parent
def github(path):
    request = urllib.request.Request("https://api.github.com/repos/NousResearch/hermes-agent/" + path,
                                     headers={"User-Agent": "Tachles-integration-test"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


release = github("releases/latest")
tag = release["tag_name"]
if release["draft"] or release["prerelease"] or not re.fullmatch(r"v(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", tag):
    raise RuntimeError("The latest official release is not a stable SemVer release")
commit = github("commits/" + tag)["sha"]
if not re.fullmatch(r"[0-9a-f]{40}", commit):
    raise RuntimeError("Invalid official release commit")
root = Path(tempfile.mkdtemp(prefix="tachles-makom-runtime-")).resolve()
engine = root / "hermes-agent"
engine.mkdir()
archive = root / "source.zip"
urllib.request.urlretrieve("https://api.github.com/repos/NousResearch/hermes-agent/zipball/" + commit, archive)
with zipfile.ZipFile(archive) as source:
    for item in source.infolist():
        relative = Path(*Path(item.filename).parts[1:])
        target = (engine / relative).resolve()
        if not target.is_relative_to(engine):
            raise RuntimeError("Unsafe archive member")
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read(item))
archive.unlink()
# Mirror scripts/install.ps1: bootstrap Python at PM's pinned minor, then let
# PM own interpreter/dependency acquisition. No dependency borrowing from the
# operator's installation and no editable engine-source patches.
uv = shutil.which("uv")
if not uv or sys.platform != "win32":
    raise RuntimeError("The Windows test runtime requires uv on PATH")
pin = json.loads((engine / "pm/lock.json").read_text(encoding="utf-8"))["packages"]["python"]["version"]
minor = ".".join(pin.split("+")[0].split(".")[:2])
request = f"cpython-{minor}-windows-x86_64-none"
subprocess.run([uv, "python", "install", "--no-bin", "--no-registry", request], check=True)
bootstrap = subprocess.check_output([uv, "python", "find", "--managed-python", "--no-project", request], text=True).strip()
env = {**os.environ, "HERMES_HOME": str(root), "PYTHONUTF8": "1"}
subprocess.run([bootstrap, "-m", "pm.cli", "install", "--without", "agent-browser", "--without", "cua-driver"],
               cwd=engine, env=env, check=True)
resolved = subprocess.check_output([bootstrap, "-c",
    "from pathlib import Path; from pm.environments import project_python; print(project_python(Path.cwd()))"],
    cwd=engine, env=env, text=True).strip()
python = Path(resolved)
if not python.is_file():
    raise RuntimeError("Official PM did not produce the expected native interpreter")
subprocess.run([str(python), str(engine / "scripts/write_install_stamp.py"),
                "--output", str(engine / "install-stamp.json"), "--commit", commit,
                "--base-version", tag[1:], "--distance", "0", "--source", "local",
                "--update-mechanism", "external"], cwd=engine, env=env, check=True)


bin_dir = root / "test-bin"
bin_dir.mkdir()
# Native bootstrap with PM's own venv interpreter: disposable homes have no PM
# selection record. A store-only source launcher requires one in each home.
subprocess.run([sys.executable, "-c",
    "from pathlib import Path; from hermes_cli._launchers import mint_launcher; "
    "import sys; mint_launcher('hermes', Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), None)",
    str(engine), str(bin_dir), str(python)],
               cwd=engine, env={**env, "PYTHONPATH": str(engine)}, check=True)
if not (bin_dir / "hermes.exe").is_file():
    raise RuntimeError("Native Windows launcher needs distlib or pip in the test helper's Python")

metadata = {"root": str(root), "engine": str(engine), "launcher": str(bin_dir / "hermes.exe"), "sha": commit, "tag": tag, "python": str(python)}
output = repo / ".artifacts/makom"
output.mkdir(parents=True, exist_ok=True)
(output / "runtime.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print(json.dumps(metadata))
