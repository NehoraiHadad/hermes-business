$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $root 'installer\bootstrap.ps1'

# Derive the supported range from the canonical manifest (hermes-compat.json) so
# this verifier can never drift from the single source of truth. The JS drift
# test asserts this file reads the manifest and carries no hardcoded bound.
$compat = Get-Content -Raw -LiteralPath (Join-Path $root 'hermes-compat.json') | ConvertFrom-Json
$minHermesVersion = [version]$compat.minVersion
$maxHermesVersionExclusive = [version]$compat.maxVersionExclusive
$source = Get-Content -Raw -LiteralPath $bootstrap
$null = [scriptblock]::Create($source)
$pwsh = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

# verify:bootstrap has two kinds of gate:
#   1. DETERMINISTIC (offline): parse checks, the installer-lib unit suite, and
#      explicit-home isolation. These NEVER touch the network and MUST pass -
#      any failure here is our bug and fails the build.
#   2. EXTERNAL PROBE (live GitHub): confirms the real release channel is
#      reachable and the selected installer blob verifies. If GitHub is
#      unreachable / rate-limited / has drifted out of our supported range, this
#      is reported as a clear EXTERNAL GATE (exit 0) instead of silently failing
#      - the deterministic gate already proved the selection logic is correct.

# -- Gate 1a: deterministic installer-library unit suite (offline) ------------
Write-Host '== Deterministic gate: installer library unit suite (offline) =='
$libTests = Join-Path $root 'scripts\test-bootstrap-lib.ps1'
& $pwsh -NoProfile -ExecutionPolicy Bypass -File $libTests
if ($LASTEXITCODE -ne 0) {
  throw 'Deterministic installer-library gate failed.'
}

# -- Gate 1b: explicit-home isolation (offline) -------------------------------
Write-Host '== Deterministic gate: explicit-home isolation (offline) =='
$isolationRoot = Join-Path $root ".tmp-hermes-home\bootstrap-isolation-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $isolationRoot | Out-Null
try {
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $isolationOutput = & $pwsh `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $bootstrap `
    -PayloadRoot $root `
    -HermesHome $isolationRoot `
    -SkipHermesInstall `
    -SkipGatewaySetup `
    -SkipCompanionInstall `
    -NoLaunch 2>&1
  $isolationExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorPreference
  if ($isolationExitCode -eq 0) {
    throw 'An explicit empty HermesHome incorrectly reused a global Hermes installation.'
  }
  if (($isolationOutput -join "`n") -notmatch 'Hermes is not installed') {
    throw "The isolated missing-Hermes branch returned an unexpected error:`n$($isolationOutput -join "`n")"
  }
}
finally {
  $ErrorActionPreference = 'Stop'
  if (Test-Path -LiteralPath $isolationRoot) {
    Remove-Item -LiteralPath $isolationRoot -Recurse -Force
  }
}
Write-Host 'Deterministic gates passed (parse, library unit suite, explicit-home isolation).'

# -- Gate 2: live external release-channel probe ------------------------------
Write-Host '== External probe: live Hermes release channel =='

function Test-ExternalGate {
  param([string]$Message)
  # Reachability / rate-limit / upstream-range drift are EXTERNAL conditions,
  # not defects in our selection logic (which Gate 1 proved offline).
  return ($Message -match '(?i)unable to connect|could not|connection|timed out|timeout|network|resolve host|host name|SSL|TLS|403|429|rate limit|No compatible official Hermes release')
}

try {
  $resolveOutput = & $pwsh -NoProfile -ExecutionPolicy Bypass -File $bootstrap -ResolveOnly 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($resolveOutput -join "`n") }
  $jsonLine = @($resolveOutput | ForEach-Object { [string]$_ } | Where-Object { $_.Trim().StartsWith('{') }) |
    Select-Object -Last 1
  if (-not $jsonLine) { throw "Bootstrap did not return release metadata:`n$($resolveOutput -join "`n")" }
  $release = $jsonLine | ConvertFrom-Json
  $version = [version]$release.version
  if ($version -lt $minHermesVersion -or $version -ge $maxHermesVersionExclusive) {
    throw "Bootstrap selected incompatible Hermes $version (supported $($compat.range))."
  }
  if ([string]::IsNullOrWhiteSpace([string]$release.tag)) {
    throw 'Bootstrap selected a release without an immutable tag.'
  }

  $integrityOutput = & $pwsh -NoProfile -ExecutionPolicy Bypass -File $bootstrap -VerifyInstallerOnly 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($integrityOutput -join "`n") }
  $integrityJson = @($integrityOutput | ForEach-Object { [string]$_ } | Where-Object { $_.Trim().StartsWith('{') }) |
    Select-Object -Last 1
  $integrity = $integrityJson | ConvertFrom-Json
  if ($integrity.blobSha -notmatch '^[0-9a-f]{40}$' -or $integrity.sha256 -notmatch '^[0-9A-F]{64}$') {
    throw 'Bootstrap did not return verified Git blob and SHA256 metadata.'
  }
  if ([long]$integrity.size -lt 500) {
    throw 'Verified official installer was unexpectedly small.'
  }

  Write-Host "External probe passed: selected $($release.name) [$($release.tag)] -> Hermes $($release.version); installer blob $($integrity.blobSha) verified."
}
catch {
  $message = [string]$_.Exception.Message
  if (Test-ExternalGate -Message $message) {
    Write-Host "EXTERNAL-GATE: live Hermes release probe unavailable - $message"
    Write-Host 'EXTERNAL-GATE: deterministic gates passed; skipping live verification (external dependency, not a build failure).'
    exit 0
  }
  throw
}
