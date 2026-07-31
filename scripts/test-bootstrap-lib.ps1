[CmdletBinding()]
param()

# test-bootstrap-lib.ps1 — offline-safe unit tests for the installer/lib modules.
#
# Everything here runs against an isolated temp directory and a raw loopback TCP
# mock server. It NEVER touches a real Hermes install, never mutates the user's
# HERMES_HOME, and never reaches the public internet. Coverage:
#   * HTTP 500 retry with backoff succeeds
#   * truncated / hash-mismatch download is rejected
#   * offline (connection refused) surfaces guided copy and fails closed
#   * payload transaction commits into a Hebrew + spaces HERMES_HOME
#   * an interrupted stage (activation failure) rolls back and preserves the
#     previous install; a pre-commit validation failure touches nothing

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$lib = Join-Path $root 'installer\lib'

# --- Load modules under test. ------------------------------------------------
foreach ($module in @('Logging.ps1', 'Hashing.ps1', 'Http.ps1', 'FileOps.ps1', 'HermesEnv.ps1', 'Release.ps1', 'Payload.ps1')) {
  . (Join-Path $lib $module)
}

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

# --- Parse-check every installer PowerShell file. ----------------------------
Write-Host 'Parse checks:'
$parseTargets = @(
  'installer\lib\Logging.ps1', 'installer\lib\Hashing.ps1', 'installer\lib\Http.ps1',
  'installer\lib\FileOps.ps1', 'installer\lib\HermesEnv.ps1', 'installer\lib\Release.ps1',
  'installer\lib\Payload.ps1', 'installer\bootstrap.ps1', 'installer\bootstrap-companion.ps1'
)
foreach ($target in $parseTargets) {
  Test-Case "parses: $target" {
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $target), [ref]$null, [ref]$errors)
    Assert-True (-not ($errors -and $errors.Count)) "parse errors in $target"
  }
}

# --- Raw loopback HTTP mock server (separate powershell.exe process). --------
$mockServerScript = Join-Path $PSScriptRoot 'mock-http-server.ps1'
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Start-MockServer {
  param([int]$Port, [string]$StopFile, [string]$Mode, [string]$BodyPath, [int]$FailCount = 0)
  if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force }
  $process = Start-Process -FilePath $powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $mockServerScript),
    '-Port', $Port, '-StopFile', ('"{0}"' -f $StopFile), '-Mode', $Mode,
    '-BodyPath', ('"{0}"' -f $BodyPath), '-FailCount', $FailCount
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

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-bootstrap-tests-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null

Write-Host 'HTTP + integrity:'
try {
  # --- HTTP 500 retry succeeds. ---------------------------------------------
  Test-Case 'HTTP 500 retried with backoff, then succeeds' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $workRoot "stop-flaky-$port"
    $bodyPath = Join-Path $workRoot 'flaky.json'
    Set-Content -LiteralPath $bodyPath -Value '{"ok":true,"value":42}' -Encoding ascii
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'flaky' -BodyPath $bodyPath -FailCount 2
    try {
      $result = Invoke-HttpJson -Uri "http://127.0.0.1:$port/api" -MaxAttempts 6 -TimeoutSec 5 -Description 'flaky test endpoint'
      Assert-True ($result.value -eq 42) 'did not receive the eventual 200 body'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Truncated / hash mismatch rejected. ----------------------------------
  Test-Case 'download with wrong SHA-256 is rejected (truncated/tampered)' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $workRoot "stop-trunc-$port"
    $bodyPath = Join-Path $workRoot 'served.bin'
    [System.IO.File]::WriteAllBytes($bodyPath, ([byte[]](1..2048 | ForEach-Object { $_ % 256 })))
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'ok' -BodyPath $bodyPath
    try {
      $wrongHash = ('a' * 64)
      $dest = Join-Path $workRoot 'download.bin'
      $threw = $false
      try {
        Save-HttpFile -Uri "http://127.0.0.1:$port/file.bin" -Destination $dest -ExpectedSha256 $wrongHash -MaxAttempts 3 -TimeoutSec 5 | Out-Null
      }
      catch {
        $threw = $true
        Assert-True ($_.Exception.Message -match 'mismatch|truncated|tampered') "unexpected error: $($_.Exception.Message)"
      }
      Assert-True $threw 'a mismatched hash did not raise an error'
      Assert-True (-not (Test-Path -LiteralPath $dest)) 'a failed download left a destination file behind'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Correct SHA-256 accepted (positive control). -------------------------
  Test-Case 'download with correct SHA-256 succeeds and is atomic' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $workRoot "stop-ok-$port"
    $bodyPath = Join-Path $workRoot 'served-ok.bin'
    [System.IO.File]::WriteAllBytes($bodyPath, ([byte[]](1..4096 | ForEach-Object { ($_ * 7) % 256 })))
    $expected = (Get-FileHash -Algorithm SHA256 -LiteralPath $bodyPath).Hash
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'ok' -BodyPath $bodyPath
    try {
      $dest = Join-Path $workRoot 'download-ok.bin'
      Save-HttpFile -Uri "http://127.0.0.1:$port/file.bin" -Destination $dest -ExpectedSha256 $expected -MaxAttempts 4 -TimeoutSec 5 | Out-Null
      Assert-True (Test-Path -LiteralPath $dest) 'verified download was not written'
      Assert-True (-not (Test-Path -LiteralPath "$dest.$PID.part")) 'a .part temp file leaked'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Offline: connection refused fails closed with guidance. --------------
  Test-Case 'offline (connection refused) fails closed with guided copy' {
    $deadPort = Get-FreeLoopbackPort  # nothing is listening on it
    $threw = $false
    try {
      Invoke-HttpJson -Uri "http://127.0.0.1:$deadPort/api" -MaxAttempts 2 -TimeoutSec 3 -Description 'offline endpoint' | Out-Null
    }
    catch {
      $threw = $true
      Assert-True ($_.Exception.Message -match 'offline|connection|refused|reach|proxy|firewall') "offline error lacked guidance: $($_.Exception.Message)"
    }
    Assert-True $threw 'a request to a dead port did not fail'
  }
}
finally {
  # Best-effort mock cleanup already handled per-case.
}

Write-Host 'Payload transaction:'

function New-FakePayload {
  param([string]$Directory)
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $plugin = Join-Path $Directory 'plugin.js'
  $skill = Join-Path $Directory 'business-bootstrap.SKILL.md'
  Set-Content -LiteralPath $plugin -Value "// business shell plugin $([guid]::NewGuid())" -Encoding UTF8
  Set-Content -LiteralPath $skill -Value "# Business bootstrap skill $([guid]::NewGuid())" -Encoding UTF8
  return [pscustomobject]@{ Plugin = $plugin; Skill = $skill }
}

# --- Hebrew + spaces HERMES_HOME commit. -------------------------------------
Test-Case 'commits payload into a Hebrew + spaces HERMES_HOME' {
  # Build the Hebrew "בדיקת הרמס 123" from code points so this .ps1 stays ASCII
  # (Windows PowerShell 5.1 decodes BOM-less scripts as ANSI, mangling literals).
  $hebrewName = -join ([int[]](0x05D1, 0x05D3, 0x05D9, 0x05E7, 0x05EA, 0x20, 0x05D4, 0x05E8, 0x05DE, 0x05E1, 0x20, 0x31, 0x32, 0x33) | ForEach-Object { [char]$_ })
  $hermesHome = Join-Path $workRoot $hebrewName
  New-Item -ItemType Directory -Force -Path $hermesHome | Out-Null
  $payload = New-FakePayload -Directory (Join-Path $workRoot 'payload-he')
  $pluginTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
  $skillTarget = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
  $receiptTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
  $files = @(
    @{ Source = $payload.Plugin; Target = $pluginTarget },
    @{ Source = $payload.Skill;  Target = $skillTarget }
  )
  Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files `
    -BootstrapVersion '0.3.3' -ReceiptTarget $receiptTarget | Out-Null
  Assert-True (Test-Path -LiteralPath $pluginTarget -PathType Leaf) 'plugin not committed into unicode home'
  Assert-True (Test-Path -LiteralPath $skillTarget -PathType Leaf) 'skill not committed into unicode home'
  Assert-True (Test-Path -LiteralPath $receiptTarget -PathType Leaf) 'completion receipt missing'
  $receipt = Get-Content -Raw -LiteralPath $receiptTarget | ConvertFrom-Json
  Assert-True ($receipt.status -eq 'installed') 'receipt status not installed'
  $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pluginTarget).Hash.ToLowerInvariant()
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $payload.Plugin).Hash.ToLowerInvariant()
  Assert-True ($installedHash -eq $sourceHash) 'installed plugin hash differs from source'
}

# --- Interrupted stage / activation failure preserves previous install. ------
Test-Case 'activation failure rolls back and preserves the previous install' {
  $hermesHome = Join-Path $workRoot 'rollback home'
  $pluginTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
  $skillTarget = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
  $receiptTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
  # Seed a PREVIOUS install of the plugin only.
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginTarget) | Out-Null
  Set-Content -LiteralPath $pluginTarget -Value 'PREVIOUS-INSTALL' -Encoding UTF8
  $payload = New-FakePayload -Directory (Join-Path $workRoot 'payload-rb')
  $files = @(
    @{ Source = $payload.Plugin; Target = $pluginTarget },
    @{ Source = $payload.Skill;  Target = $skillTarget }
  )
  $threw = $false
  try {
    Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files `
      -BootstrapVersion '0.3.3' -ReceiptTarget $receiptTarget `
      -Activate { throw 'simulated hermes plugins enable failure' } | Out-Null
  }
  catch {
    $threw = $true
    Assert-True ($_.Exception.Message -match 'rolled back|rollback') "unexpected rollback error: $($_.Exception.Message)"
  }
  Assert-True $threw 'activation failure did not raise'
  $restored = Get-Content -Raw -LiteralPath $pluginTarget
  Assert-True ($restored.Trim() -eq 'PREVIOUS-INSTALL') 'previous plugin was not restored on rollback'
  Assert-True (-not (Test-Path -LiteralPath $skillTarget)) 'newly-created skill was not removed on rollback'
  Assert-True (-not (Test-Path -LiteralPath $receiptTarget)) 'a completion receipt was written despite rollback'
  $rollbackReceipt = Join-Path $hermesHome '.business-bootstrap-receipts\business-shell-rollback.json'
  Assert-True (Test-Path -LiteralPath $rollbackReceipt) 'rollback receipt missing'
}

# --- Pre-commit validation failure (interrupted stage) touches nothing. ------
Test-Case 'missing-source validation fails before touching the previous install' {
  $hermesHome = Join-Path $workRoot 'validate home'
  $pluginTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
  $skillTarget = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
  $receiptTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginTarget) | Out-Null
  Set-Content -LiteralPath $pluginTarget -Value 'PREVIOUS-INSTALL' -Encoding UTF8
  $payload = New-FakePayload -Directory (Join-Path $workRoot 'payload-validate')
  $files = @(
    @{ Source = $payload.Plugin; Target = $pluginTarget },
    @{ Source = (Join-Path $workRoot 'does-not-exist.md'); Target = $skillTarget }
  )
  $threw = $false
  try {
    Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files `
      -BootstrapVersion '0.3.3' -ReceiptTarget $receiptTarget | Out-Null
  }
  catch { $threw = $true }
  Assert-True $threw 'a missing source did not fail closed'
  Assert-True ((Get-Content -Raw -LiteralPath $pluginTarget).Trim() -eq 'PREVIOUS-INSTALL') 'previous install was modified before validation passed'
  Assert-True (-not (Test-Path -LiteralPath $receiptTarget)) 'a receipt was written despite validation failure'
}

# --- Version gate: fail closed + preserve-existing guidance. ------------------
Write-Host 'Version gate:'
Test-Case 'incompatible (too new) version fails closed with guidance' {
  $threw = $false
  try {
    Assert-CompatibleVersion -Version ([version]'0.21.0') -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0')
  }
  catch {
    $threw = $true
    Assert-True ($_.Exception.Message -match 'left (it )?untouched|untouched') 'no preserve-existing guidance in incompatible error'
  }
  Assert-True $threw 'an out-of-range version was accepted'
}
Test-Case 'compatible version passes the gate' {
  Assert-CompatibleVersion -Version ([version]'0.19.5') -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0')
}
Test-Case 'release version comes from source __version__, never the CalVer tag' {
  # Real upstream tags are CalVer (vYYYY.M.D); the authoritative semver lives in
  # hermes_cli/__init__.py. Selection must resolve via a source read, so a
  # CalVer tag like v2026.7.30 maps to its true installed version 0.19.1.
  $releases = @(
    [pscustomobject]@{ tag_name = 'v2026.7.31'; name = 'Next'; published_at = '2026-07-31T00:00:00Z'; draft = $false; prerelease = $false },
    [pscustomobject]@{ tag_name = 'v2026.7.30'; name = 'Stable'; published_at = '2026-07-30T00:00:00Z'; draft = $false; prerelease = $false },
    [pscustomobject]@{ tag_name = 'v2026.7.20'; name = 'Prev'; published_at = '2026-07-20T00:00:00Z'; draft = $false; prerelease = $false }
  )
  # Deterministic resolver standing in for the source read: the NEWEST release
  # is a future 0.20.0 (out of range) and must be skipped in favour of 0.19.1.
  $sourceVersions = @{ 'v2026.7.31' = '0.20.0'; 'v2026.7.30' = '0.19.1'; 'v2026.7.20' = '0.19.0' }
  $resolver = { param($Release) [version]$sourceVersions[[string]$Release.tag_name] }
  $selected = Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -VersionResolver $resolver
  Assert-True ($selected.tag -eq 'v2026.7.30') "expected v2026.7.30, got $($selected.tag)"
  Assert-True ($selected.version -eq '0.19.1') "expected resolved version 0.19.1, got $($selected.version)"
}
Test-Case 'a CalVer tag is never mistaken for a semver version' {
  # If the selector fell back to parsing the tag, v2026.7.30 would read as
  # 2026.7.30 and be rejected as out-of-range. Prove it does NOT.
  $releases = @(
    [pscustomobject]@{ tag_name = 'v2026.7.30'; name = 'Stable'; published_at = '2026-07-30T00:00:00Z'; draft = $false; prerelease = $false }
  )
  $resolver = { param($Release) [version]'0.19.1' }
  $selected = Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -VersionResolver $resolver
  Assert-True ($selected.version -eq '0.19.1') "CalVer tag leaked into version resolution: $($selected.version)"
}
Test-Case 'Get-ReleaseSourceVersion falls back to the pinned map when the read fails' {
  # No network here: the source read throws (bad ApiBase), so the pinned manifest
  # under our control must supply the authoritative version.
  $pins = Get-DefaultPinnedReleases
  $v = Get-ReleaseSourceVersion -Repository 'NousResearch/hermes-agent' -Tag 'v2026.7.30' `
    -Headers @{ 'User-Agent' = 'test' } -PinnedReleases $pins -ApiBase 'http://127.0.0.1:9'
  Assert-True ($v -eq [version]'0.19.1') "expected pinned 0.19.1, got $v"
}
Test-Case 'selection fails closed when no release is in range' {
  $releases = @(
    [pscustomobject]@{ tag_name = 'v2026.6.19'; name = 'Old'; published_at = '2026-06-19T00:00:00Z'; draft = $false; prerelease = $false }
  )
  $resolver = { param($Release) [version]'0.17.0' }
  $threw = $false
  try {
    Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -VersionResolver $resolver | Out-Null
  }
  catch { $threw = $true }
  Assert-True $threw 'an all-incompatible release list was not rejected'
}
Test-Case 'the pinned map is single-sourced with hermes-compat.json' {
  $canonical = Get-Content -Raw -LiteralPath (Join-Path $root 'hermes-compat.json') | ConvertFrom-Json
  $pins = Get-DefaultPinnedReleases
  foreach ($canonicalPin in $canonical.pinnedReleases) {
    $match = @($pins | Where-Object { $_.tag -eq $canonicalPin.tag -and $_.version -eq $canonicalPin.version })
    Assert-True ($match.Count -eq 1) "Release.ps1 pin drift for $($canonicalPin.tag) -> $($canonicalPin.version)"
  }
}

if (Test-Path -LiteralPath $workRoot) {
  Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Results: $script:Passed passed, $script:Failed failed."
if ($script:Failed -gt 0) { exit 1 }
exit 0
