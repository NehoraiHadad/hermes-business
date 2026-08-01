[CmdletBinding()]
param([switch]$Keep)

# e2e-companion-nsis-contract.ps1 — hermetic, isolated proof of the manifest-driven
# NSIS companion contract. It drives the REAL production transaction
# (Invoke-CompanionInstall) with a real EXTERNAL fixture installer process
# (scripts/lib/fixture-companion-installer.ps1) writing real files into an ISOLATED
# install root, and proves: deterministic manifest-named executable resolution, a
# larger decoy exe never wins, installer-failure and post-install-contract-failure
# both roll back leaving the prior companion intact, Hebrew/space roots work, and a
# pre-seeded "live Hermes home" sentinel is never mutated. No network, no profile.

$ErrorActionPreference = 'Stop'
$RepoRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
foreach ($m in @('Logging.ps1', 'CompanionEntrypoint.ps1', 'CompanionInstall.ps1')) {
  . (Join-Path $RepoRoot "installer\lib\$m")
}
$fixture = Join-Path $PSScriptRoot 'lib\fixture-companion-installer.ps1'
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$entrypoint = 'hermes-business.exe'

function New-InstallAction {
  param([string]$Fixture, [string]$Powershell, [string]$Mode)
  return {
    param($root)
    $p = Start-Process -FilePath $Powershell -Wait -PassThru -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $Fixture),
      '-InstallDir', ('"{0}"' -f $root), '-Mode', $Mode)
    if ($p.ExitCode -ne 0) { throw "the companion installer exited with code $($p.ExitCode)." }
  }.GetNewClosure()
}

$temporaryParent = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) 'hermes-nsis-contract-e2e'))
$testRoot = Join-Path $temporaryParent "run-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
if (-not $testRoot.StartsWith($temporaryParent + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to use a test directory outside $temporaryParent"
}
try {
  # --- Pre-seed an isolated "live" Hermes home sentinel; anchor its hash. -------
  $hermesHome = Join-Path $testRoot 'hermes-home\sessions'
  New-Item -ItemType Directory -Force -Path $hermesHome | Out-Null
  $stateFile = Join-Path $hermesHome 'state.db'
  Set-Content -LiteralPath $stateFile -Value "LIVE-STATE-$([guid]::NewGuid())" -Encoding ascii
  $stateBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $stateFile).Hash

  # --- Isolated companion root with a Hebrew + space segment; seed a prior app. -
  # Hebrew built from code points so the source stays ASCII (Windows PowerShell 5.1
  # reads a no-BOM file as ANSI and would corrupt literal Hebrew characters).
  $hebrew = [string]::new([char[]](0x05E2, 0x05E1, 0x05E7, 0x20, 0x05D3, 0x05D2, 0x05DD))
  $installRoot = Join-Path $testRoot (Join-Path (Join-Path 'install' $hebrew) 'Programs\hermes-business')
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  $priorSentinel = Join-Path $installRoot 'prior-marker.txt'
  Set-Content -LiteralPath $priorSentinel -Value "PRIOR-$([guid]::NewGuid())" -Encoding ascii
  $priorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $priorSentinel).Hash
  $results = [ordered]@{}

  # === Case 1: deterministic entrypoint; larger decoy exe NOT selected. =========
  Write-Host '== Case 1: real fixture installer -> deterministic entrypoint =='
  $exe = Invoke-CompanionInstall -Entrypoint $entrypoint -InstallAction (New-InstallAction $fixture $powershell 'ok') -InstallRoot $installRoot
  if ((Split-Path -Leaf $exe) -ne $entrypoint) { throw "a non-entrypoint exe was selected: $exe" }
  if (-not $exe.StartsWith([System.IO.Path]::GetFullPath($installRoot))) { throw "exe escaped the isolated root: $exe" }
  $decoy = Join-Path $installRoot 'tools\updater-bigger.exe'
  if ((Get-Item -LiteralPath $decoy).Length -le (Get-Item -LiteralPath $exe).Length) { throw 'test invalid: decoy is not larger' }
  $results.deterministicEntrypoint = @{ ok = $true; exe = $exe; largerDecoyIgnored = $decoy }

  # After a successful install the prior sentinel is gone (replaced), so re-seed a
  # NEW prior companion to prove the rollback cases below preserve it.
  Set-Content -LiteralPath (Join-Path $installRoot 'prior-marker.txt') -Value "PRIOR2-$([guid]::NewGuid())" -Encoding ascii
  $priorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installRoot 'prior-marker.txt')).Hash

  # === Case 2: installer failure rolls back; prior companion intact. ============
  Write-Host '== Case 2: installer failure rolls back to the prior companion =='
  $threw = $false
  try { Invoke-CompanionInstall -Entrypoint $entrypoint -InstallAction (New-InstallAction $fixture $powershell 'fail') -InstallRoot $installRoot | Out-Null }
  catch { $threw = $true }
  if (-not $threw) { throw 'a failing installer was treated as success' }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installRoot 'prior-marker.txt')).Hash -ne $priorHash) { throw 'installer failure destroyed the prior companion' }
  if (Test-Path -LiteralPath (Join-Path $installRoot 'partial.exe')) { throw 'a partial install leaked past rollback' }
  $results.installFailureRollsBack = @{ ok = $true }

  # === Case 3: post-install contract failure rolls back; prior intact. ==========
  Write-Host '== Case 3: post-install contract failure rolls back =='
  $threw = $false
  try { Invoke-CompanionInstall -Entrypoint $entrypoint -InstallAction (New-InstallAction $fixture $powershell 'wrong') -InstallRoot $installRoot | Out-Null }
  catch { $threw = $true }
  if (-not $threw) { throw 'a broken post-install contract was accepted' }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installRoot 'prior-marker.txt')).Hash -ne $priorHash) { throw 'contract failure destroyed the prior companion' }
  if (Test-Path -LiteralPath (Join-Path $installRoot 'some-other.exe')) { throw 'the failed contract left its artifact behind' }
  $results.contractFailureRollsBack = @{ ok = $true }

  # === Case 4: the pre-seeded live Hermes home was never touched. ===============
  Write-Host '== Case 4: live Hermes home sentinel preserved =='
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $stateFile).Hash -ne $stateBefore) { throw 'the live Hermes state was mutated' }
  $results.hermesStatePreserved = @{ ok = $true; before = $stateBefore }

  [pscustomobject]@{ ok = $true; isolated = $true; installRoot = $installRoot; hermesHome = (Split-Path -Parent $hermesHome); cases = $results } | ConvertTo-Json -Depth 6
}
finally {
  if (-not $Keep -and (Test-Path -LiteralPath $testRoot)) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ((Test-Path -LiteralPath $temporaryParent) -and -not (Get-ChildItem -LiteralPath $temporaryParent -Force)) {
      Remove-Item -LiteralPath $temporaryParent -Force -ErrorAction SilentlyContinue
    }
  }
}
