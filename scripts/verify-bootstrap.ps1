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

# Invoke-ProbeProcess / Test-ExternalGate / ConvertTo-SingleLineText. Kept in
# their own module so the EXTERNAL-vs-OUR-BUG boundary is unit-testable offline
# (scripts/lib/tests/external-gate.tests.ps1) rather than only observable on a
# bad network day. See that file for the CI run 32149075429 post-mortem: `2>&1`
# on a native command under ErrorActionPreference='Stop' truncated a failure to
# one console-wrapped fragment and hid the 403 from this gate. EVERY child
# process this script launches and then INSPECTS goes through that runner.
. (Join-Path $PSScriptRoot 'lib\external-gate.ps1')

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
  # Routed through Invoke-ProbeProcess for the same reason Gate 2 is: this gate
  # asserts on the CHILD'S TEXT, so it must see all of it. The old `2>&1` form
  # needed an ErrorActionPreference='Continue' dance to survive at all, and still
  # matched against newline-joined records - a console wrap landing inside
  # "Hermes is not installed" would have failed a perfectly correct run.
  $isolation = Invoke-ProbeProcess -FilePath $pwsh -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $bootstrap),
    '-PayloadRoot', ('"{0}"' -f $root),
    '-HermesHome', ('"{0}"' -f $isolationRoot),
    '-SkipHermesInstall', '-SkipGatewaySetup', '-SkipCompanionInstall', '-NoLaunch'
  )
  if ($isolation.ExitCode -eq 0) {
    throw 'An explicit empty HermesHome incorrectly reused a global Hermes installation.'
  }
  if ($isolation.Text -notmatch 'Hermes is not installed') {
    throw "The isolated missing-Hermes branch returned an unexpected error: $($isolation.Text)"
  }
}
finally {
  if (Test-Path -LiteralPath $isolationRoot) {
    Remove-Item -LiteralPath $isolationRoot -Recurse -Force
  }
}
Write-Host 'Deterministic gates passed (parse, library unit suite, explicit-home isolation).'

# -- Gate 2: live external release-channel probe ------------------------------
Write-Host '== External probe: live Hermes release channel =='

# Prefix that marks a throw as "external condition, swallow it". ONLY
# Invoke-ReleaseProbe ever applies it, and only to a failing CHILD PROCESS.
# Every assertion this script makes itself throws WITHOUT the marker and is
# therefore always fatal - that is the boundary, enforced structurally rather
# than by hoping a regex never over-matches our own error text.
$externalGateMarker = 'EXTERNAL-GATE-CONDITION: '

function Invoke-ReleaseProbe {
  # Runs one bootstrap probe mode and returns its STDOUT lines. A non-zero exit
  # is classified against the child's COMPLETE output; a success returns the
  # lines for this script's own (always-fatal) assertions to inspect.
  param([Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][string]$Mode)
  $probe = Invoke-ProbeProcess -FilePath $pwsh -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $bootstrap), $Mode
  )
  if ($probe.ExitCode -eq 0) { return $probe.Output }
  if (Test-ExternalGate -Message $probe.Text) {
    throw "$externalGateMarker$Label exited $($probe.ExitCode): $($probe.Text)"
  }
  throw "$Label exited $($probe.ExitCode): $($probe.Text)"
}

try {
  $resolveOutput = Invoke-ReleaseProbe -Label 'the release-resolution probe (-ResolveOnly)' -Mode '-ResolveOnly'
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

  $integrityOutput = Invoke-ReleaseProbe -Label 'the installer-integrity probe (-VerifyInstallerOnly)' -Mode '-VerifyInstallerOnly'
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
  # Only a CHILD-PROCESS failure that Invoke-ReleaseProbe already classified as
  # external is swallowed. This script's own assertions carry no marker and fall
  # through to the rethrow, so a genuine selection-logic defect still fails CI.
  if ($message.StartsWith($externalGateMarker)) {
    Write-Host "EXTERNAL-GATE: live Hermes release probe unavailable - $($message.Substring($externalGateMarker.Length))"
    Write-Host 'EXTERNAL-GATE: deterministic gates passed; skipping live verification (external dependency, not a build failure).'
    exit 0
  }
  throw
}
