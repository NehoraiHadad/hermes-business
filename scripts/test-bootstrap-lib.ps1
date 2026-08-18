[CmdletBinding()]
param()

# test-bootstrap-lib.ps1 — offline-safe unit-test RUNNER for the installer/lib
# modules. It owns the shared harness (Test-Case / Assert-True + loopback mock
# server) and routes to the focused suites under scripts/lib/tests/*.tests.ps1 so
# no single file grows without bound. Everything runs against an isolated temp
# directory and a raw loopback TCP mock server: it NEVER touches a real Hermes
# install, never mutates HERMES_HOME, and never reaches the public internet.

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$lib = Join-Path $root 'installer\lib'

# --- Load modules under test. ------------------------------------------------
foreach ($module in @('Logging.ps1', 'Hashing.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1', 'FileOps.ps1', 'ZipPolicy.ps1', 'SafeZip.ps1', 'HermesEnv.ps1', 'Release.ps1', 'Payload.ps1', 'BackendEnable.ps1', 'BusinessInstall.ps1')) {
  . (Join-Path $lib $module)
}
# The companion installer resolves headers from $BootstrapVersion when dot-sourced.
$BootstrapVersion = [string](Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
. (Join-Path $root 'installer\bootstrap-companion.ps1')
# Verifier-side, not shipped: the external-gate seam verify-bootstrap.ps1 uses to
# tell an unreachable/rate-limited upstream apart from a defect in our own logic.
. (Join-Path $PSScriptRoot 'lib\external-gate.ps1')

$script:Passed = 0
$script:Failed = 0
function Test-Case {
  param([string]$Name, [scriptblock]$Body)
  try {
    & $Body
    $script:Passed++
    Write-Host "  PASS  $Name"
  }
  catch {
    $script:Failed++
    Write-Host "  FAIL  $Name -> $($_.Exception.Message)"
  }
}
function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

# --- Raw loopback HTTP mock server harness (shared by the HTTP suite). --------
$mockServerScript = Join-Path $PSScriptRoot 'mock-http-server.ps1'
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
function Start-MockServer {
  # RetryAfterSeconds only matters to the 'retryafter' mode; it is always passed
  # so the 403/429 rate-limit cases can drive the wait the server dictates.
  param([int]$Port, [string]$StopFile, [string]$Mode, [string]$BodyPath, [int]$FailCount = 0,
    [int]$RetryAfterSeconds = 2)
  if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force }
  $process = Start-Process -FilePath $powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $mockServerScript),
    '-Port', $Port, '-StopFile', ('"{0}"' -f $StopFile), '-Mode', $Mode,
    '-BodyPath', ('"{0}"' -f $BodyPath), '-FailCount', $FailCount,
    '-RetryAfterSeconds', $RetryAfterSeconds
  )
  # Let the child bind its listener; the retry logic under test also tolerates a
  # brief pre-bind window (connection-refused is retryable).
  Start-Sleep -Milliseconds 700
  return $process
}
function Stop-MockServer {
  param($Process, [string]$StopFile)
  Set-Content -LiteralPath $StopFile -Value 'stop'
  if ($Process) {
    if (-not $Process.WaitForExit(3000)) {
      try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

# --- Focused suites (each defines an Invoke-*Tests function). -----------------
foreach ($suite in @(
    'http-integrity.tests.ps1', 'payload-transaction.tests.ps1', 'version-gate.tests.ps1',
    'companion-contract.tests.ps1', 'safezip-entrypoint.tests.ps1',
    'companion-install.tests.ps1', 'release-acquisition.tests.ps1',
    'release-packaging.tests.ps1', 'backend-enable.tests.ps1', 'backend-bundling.tests.ps1',
    'business-install.tests.ps1', 'external-gate.tests.ps1')) {
  . (Join-Path $PSScriptRoot "lib\tests\$suite")
}

# --- Parse-check every installer + test PowerShell file. ---------------------
Write-Host 'Parse checks:'
$parseTargets = @(
  'installer\lib\Logging.ps1', 'installer\lib\Hashing.ps1', 'installer\lib\HttpRetry.ps1',
  'installer\lib\HttpDownload.ps1', 'installer\lib\FileOps.ps1', 'installer\lib\ZipPolicy.ps1',
  'installer\lib\SafeZip.ps1', 'installer\lib\SemVer.ps1', 'installer\lib\CompanionEntrypoint.ps1',
  'installer\lib\CompanionInstall.ps1',
  'installer\lib\CompanionManifest.ps1', 'installer\lib\HermesEnv.ps1',
  'installer\lib\Release.ps1', 'installer\lib\ReleaseSelection.ps1',
  'installer\lib\ReleaseAcquisition.ps1', 'installer\lib\Payload.ps1',
  'installer\lib\VerifyMode.ps1', 'installer\lib\BackendEnable.ps1', 'installer\lib\BusinessInstall.ps1', 'installer\bootstrap.ps1',
  'installer\bootstrap-companion.ps1', 'scripts\mock-http-server.ps1',
  'scripts\lib\static-file-server.ps1', 'scripts\lib\e2e-thin-installer-lib.ps1',
  'scripts\lib\e2e-thin-installer-cases.ps1', 'scripts\e2e-thin-network-installer.ps1',
  'scripts\lib\tests\http-integrity.tests.ps1', 'scripts\lib\tests\payload-transaction.tests.ps1',
  'scripts\lib\tests\version-gate.tests.ps1', 'scripts\lib\tests\companion-contract.tests.ps1',
  'scripts\lib\tests\safezip-entrypoint.tests.ps1',
  'scripts\lib\tests\companion-install.tests.ps1', 'scripts\lib\tests\release-acquisition.tests.ps1',
  'scripts\lib\tests\release-packaging.tests.ps1', 'scripts\lib\tests\backend-enable.tests.ps1',
  'scripts\lib\tests\backend-bundling.tests.ps1', 'scripts\lib\tests\business-install.tests.ps1',
  'scripts\lib\external-gate.ps1', 'scripts\lib\tests\external-gate.tests.ps1',
  'scripts\verify-bootstrap.ps1',
  'scripts\e2e-companion-nsis-contract.ps1', 'scripts\lib\fixture-companion-installer.ps1',
  'scripts\test-bootstrap-lib.ps1'
)
foreach ($target in $parseTargets) {
  Test-Case "parses: $target" {
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $target), [ref]$null, [ref]$errors)
    Assert-True (-not ($errors -and $errors.Count)) "parse errors in $target"
  }
}

# --- Isolated work root, then route to the focused suites. -------------------
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-bootstrap-tests-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
$validSha = 'A' * 64

try {
  Invoke-HttpIntegrityTests -WorkRoot $workRoot
  Invoke-PayloadTransactionTests -WorkRoot $workRoot
  Invoke-VersionGateTests -Root $root
  Invoke-CompanionContractTests -WorkRoot $workRoot -ValidSha $validSha
  Invoke-SafeZipEntrypointTests -WorkRoot $workRoot -ValidSha $validSha
  Invoke-CompanionInstallTests -WorkRoot $workRoot -RepoRoot $root
  Invoke-ReleaseAcquisitionTests -WorkRoot $workRoot
  Invoke-ReleasePackagingTests -Root $root
  Invoke-BackendEnableTests -WorkRoot $workRoot
  Invoke-BackendBundlingTests -Root $root
  Invoke-BusinessInstallTests -Root $root -WorkRoot $workRoot
  Invoke-ExternalGateTests -Root $root -WorkRoot $workRoot
}
finally {
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host "Results: $script:Passed passed, $script:Failed failed."
if ($script:Failed -gt 0) { exit 1 }
exit 0
