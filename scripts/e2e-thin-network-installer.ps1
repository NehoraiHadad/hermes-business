[CmdletBinding()]
param([switch]$Keep, [switch]$EmitQaArtifact)

# e2e-thin-network-installer.ps1 — hermetic, isolated proof of the thin network
# installer's download -> SHA-256 -> SAFE-extract pipeline and its fail-closed
# guards. Fully self-contained: it builds small portable-zip artifacts in a
# throwaway temp root, serves them + manifests over a repo-native loopback static
# server (no Python), downloads + verifies the EXACT SHA-256, extracts with
# per-entry validation into an ISOLATED install root, and asserts the security
# contract (zip-slip refusal, non-loopback rejection, no manifest InstallRoot
# injection, deterministic entrypoint). It never touches the live profile.
# Fixtures + case bodies live in scripts/lib/e2e-thin-installer-cases.ps1 and the
# artifact/server helpers in scripts/lib/e2e-thin-installer-lib.ps1 so this file
# stays a small orchestrator.

$ErrorActionPreference = 'Stop'
$RepoRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$BootstrapVersion = [string](Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json).version

foreach ($m in @('Logging.ps1', 'Hashing.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1', 'FileOps.ps1', 'ZipPolicy.ps1', 'SafeZip.ps1')) {
  . (Join-Path $RepoRoot "installer\lib\$m")
}
. (Join-Path $RepoRoot 'installer\bootstrap-companion.ps1')
. (Join-Path $PSScriptRoot 'lib\e2e-thin-installer-lib.ps1')
. (Join-Path $PSScriptRoot 'lib\e2e-thin-installer-cases.ps1')

$temporaryParent = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) 'hermes-thin-installer-e2e'))
$testRoot = Join-Path $temporaryParent "run-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
if (-not $testRoot.StartsWith($temporaryParent + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to use a test directory outside $temporaryParent"
}
$serverRoot = Join-Path $testRoot 'server'
$installRoot = Join-Path $testRoot 'install\Programs\hermes-business'   # ISOLATED, not the real profile
$hermesHome = Join-Path $testRoot 'hermes-home'                          # ISOLATED shared state
$stopFile = Join-Path $testRoot 'server.stop'
$serverProcess = $null

try {
  New-Item -ItemType Directory -Force -Path $serverRoot, $hermesHome | Out-Null

  # --- Pre-seed an existing Hermes user-state file and anchor its hash. --------
  $stateDir = Join-Path $hermesHome 'sessions'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $stateFile = Join-Path $stateDir 'state.db'
  Set-Content -LiteralPath $stateFile -Value "PRE-EXISTING-USER-STATE-$([guid]::NewGuid())" -Encoding ascii
  $stateHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $stateFile).Hash

  $port = Get-FreeLoopbackPort
  $ctx = @{
    RepoRoot = $RepoRoot; BootstrapVersion = $BootstrapVersion; ServerRoot = $serverRoot
    InstallRoot = $installRoot; HermesHome = $hermesHome; TestRoot = $testRoot
    StateFile = $stateFile; StateHashBefore = $stateHashBefore; Entrypoint = 'hermes-business.exe'
    BaseUrl = "http://127.0.0.1:$port"; DeadPort = (Get-FreeLoopbackPort)   # nothing listens on DeadPort
  }

  # --- Build + publish portable-zip artifacts (good, zip-slip, decoy) + manifests.
  New-ThinInstallerFixtures -Ctx $ctx

  $serverProcess = Start-StaticServer -Port $port -Root $serverRoot -StopFile $stopFile -BaseUrl $ctx.BaseUrl

  $results = Invoke-ThinInstallerCases -Ctx $ctx

  # --- Optional: publish the QA-only artifact + evidence next to the binaries. -
  if ($EmitQaArtifact) {
    $results.qaArtifact = Publish-QaArtifact -Ctx $ctx
  }

  [pscustomobject]@{
    ok = $true
    isolated = $true
    installRoot = $installRoot
    hermesHome = $hermesHome
    artifactBytes = $ctx.ZipBytes
    cases = $results
  } | ConvertTo-Json -Depth 6
}
finally {
  if ($serverProcess) { Stop-StaticServer -Process $serverProcess -StopFile $stopFile }
  if (-not $Keep -and (Test-Path -LiteralPath $testRoot)) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    # Remove the shared parent too, but only if this was the last run in flight.
    if ((Test-Path -LiteralPath $temporaryParent) -and -not (Get-ChildItem -LiteralPath $temporaryParent -Force)) {
      Remove-Item -LiteralPath $temporaryParent -Force -ErrorAction SilentlyContinue
    }
  }
}
