# companion-install.tests.ps1 — deterministic, offline cases for the format-
# agnostic companion install TRANSACTION (Invoke-CompanionInstall): manifest-named
# executable resolution, decoy rejection, fail-closed shape checks, and rollback
# that leaves the prior companion intact. Dot-sourced by scripts/test-bootstrap-lib.ps1;
# uses its shared Test-Case / Assert-True harness. Never touches a real profile.

function New-PriorCompanion {
  # Seed an isolated install root with a prior companion + a sentinel, and return
  # the sentinel's hash so a test can prove rollback preserved it byte-for-byte.
  param([string]$Root)
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $sentinel = Join-Path $Root 'prior-marker.txt'
  Set-Content -LiteralPath $sentinel -Value "PRIOR-$([guid]::NewGuid())" -Encoding ascii
  [System.IO.File]::WriteAllBytes((Join-Path $Root 'hermes-business.exe'), ([byte[]](1..50)))
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $sentinel).Hash
}

function Assert-PriorIntact {
  param([string]$Root, [string]$Hash)
  $sentinel = Join-Path $Root 'prior-marker.txt'
  Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) 'the prior companion was destroyed by a failed install'
  Assert-True (((Get-FileHash -Algorithm SHA256 -LiteralPath $sentinel).Hash) -eq $Hash) 'the prior companion sentinel was mutated'
}

function Invoke-CompanionInstallTests {
  param([Parameter(Mandatory)][string]$WorkRoot, [Parameter(Mandatory)][string]$RepoRoot)
  Write-Host 'Companion install transaction:'

  Test-Case 'the packaged NSI bundles every companion loader module (no drift)' {
    $loader = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'installer\bootstrap-companion.ps1')
    $modules = [regex]::Matches($loader, "File\s*=\s*'([^']+\.ps1)'") | ForEach-Object { $_.Groups[1].Value }
    Assert-True ($modules -contains 'CompanionInstall.ps1') 'the loader no longer references CompanionInstall.ps1'
    $nsi = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'installer\business-bootstrap.nsi')
    foreach ($module in $modules) {
      Assert-True ($nsi -match [regex]::Escape("lib\$module")) "the packaged NSI does not bundle loader module '$module'"
    }
  }
  $ep = 'hermes-business.exe'
  # A fixture "installer" that lands the named entrypoint AND a larger decoy exe.
  $layFiles = {
    param($root)
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'tools') | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $root 'hermes-business.exe'), ([byte[]](0..255)))
    [System.IO.File]::WriteAllBytes((Join-Path $root 'tools\updater-bigger.exe'), ([byte[]](0..8191 | ForEach-Object { $_ % 256 })))
  }

  Test-Case 'the build-bootstrap NSIS manifest (productName entrypoint) satisfies the contract' {
    $pkg = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json
    $entrypoint = "$([string]$pkg.productName).exe"
    $r = Assert-CompanionRelease -Release ([pscustomobject]@{
        version = '0.3.3'; url = 'https://example.test/companion-setup.exe'; sha256 = ('A' * 64); entrypoint = $entrypoint })
    Assert-True ($r.format -eq 'nsis') "expected default nsis, got $($r.format)"
    Assert-True ($r.entrypoint -eq $entrypoint) "productName entrypoint not carried: $($r.entrypoint)"
  }

  Test-Case 'resolves the manifest-named exe; larger decoy is never selected' {
    $root = Join-Path $WorkRoot 'txn-good'
    $exe = Invoke-CompanionInstall -Entrypoint $ep -InstallAction $layFiles -InstallRoot $root
    Assert-True ((Split-Path -Leaf $exe) -eq $ep) "a non-entrypoint exe was selected: $exe"
    Assert-True ($exe.StartsWith([System.IO.Path]::GetFullPath($root))) "exe landed outside the root: $exe"
    $decoy = Join-Path $root 'tools\updater-bigger.exe'
    Assert-True ((Get-Item -LiteralPath $decoy).Length -gt (Get-Item -LiteralPath $exe).Length) 'test invalid: decoy is not larger'
  }
  Test-Case 'missing/wrong entrypoint fails closed and produces no executable' {
    $root = Join-Path $WorkRoot 'txn-missing'
    $wrongName = { param($root) New-Item -ItemType Directory -Force -Path $root | Out-Null; [System.IO.File]::WriteAllBytes((Join-Path $root 'not-the-app.exe'), ([byte[]](0..99))) }
    $threw = $false
    try { Invoke-CompanionInstall -Entrypoint $ep -InstallAction $wrongName -InstallRoot $root | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'does not exist') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a wrong-entrypoint install was accepted'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root $ep))) 'a failed install left an executable behind'
  }
  Test-Case 'traversal / absolute entrypoints are rejected BEFORE any mutation' {
    foreach ($bad in @('..\evil.exe', '../evil.exe', 'C:\evil.exe', '/evil.exe', 'a:stream.exe')) {
      $root = Join-Path $WorkRoot 'txn-shape'
      $priorHash = New-PriorCompanion -Root $root
      $ran = $false
      $probe = { param($root) $script:__ran = $true }.GetNewClosure()
      $script:__ran = $false
      $threw = $false
      try { Invoke-CompanionInstall -Entrypoint $bad -InstallAction $probe -InstallRoot $root | Out-Null }
      catch { $threw = $true }
      Assert-True $threw "a hostile entrypoint was accepted: '$bad'"
      Assert-True (-not $script:__ran) "the install action ran despite a hostile entrypoint: '$bad'"
      Assert-PriorIntact -Root $root -Hash $priorHash
      Remove-Item -LiteralPath $root -Recurse -Force
    }
  }
  Test-Case 'install-action failure rolls back and leaves the prior companion intact' {
    $root = Join-Path $WorkRoot 'txn-fail'
    $priorHash = New-PriorCompanion -Root $root
    $boom = { param($root) New-Item -ItemType Directory -Force -Path $root | Out-Null; [System.IO.File]::WriteAllBytes((Join-Path $root 'partial.exe'), ([byte[]](1..9))); throw 'installer exited with code 1' }
    $threw = $false
    try { Invoke-CompanionInstall -Entrypoint $ep -InstallAction $boom -InstallRoot $root | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'exited') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a failing installer was treated as success'
    Assert-PriorIntact -Root $root -Hash $priorHash
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root 'partial.exe'))) 'a partial install leaked past rollback'
  }
  Test-Case 'post-install contract failure rolls back to the prior companion' {
    $root = Join-Path $WorkRoot 'txn-contract'
    $priorHash = New-PriorCompanion -Root $root
    # Install "succeeds" but lands the wrong exe name => contract fails => rollback.
    $wrongName = { param($root) New-Item -ItemType Directory -Force -Path $root | Out-Null; [System.IO.File]::WriteAllBytes((Join-Path $root 'other.exe'), ([byte[]](0..99))) }
    $threw = $false
    try { Invoke-CompanionInstall -Entrypoint $ep -InstallAction $wrongName -InstallRoot $root | Out-Null }
    catch { $threw = $true }
    Assert-True $threw 'a broken post-install contract was accepted'
    Assert-PriorIntact -Root $root -Hash $priorHash
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root 'other.exe'))) 'the failed contract left its artifact behind'
  }
  Test-Case 'Hebrew + spaces install roots resolve correctly' {
    # Build the Hebrew segment from code points so the source stays ASCII (Windows
    # PowerShell 5.1 reads a no-BOM file as ANSI and would corrupt literal Hebrew).
    $hebrew = [string]::new([char[]](0x05E2, 0x05E1, 0x05E7, 0x20, 0x05D3, 0x05D2, 0x05DD))
    $root = Join-Path $WorkRoot (Join-Path $hebrew 'hermes business')
    $exe = Invoke-CompanionInstall -Entrypoint $ep -InstallAction $layFiles -InstallRoot $root
    Assert-True (Test-Path -LiteralPath $exe -PathType Leaf) "exe not resolved under a Hebrew/space path: $exe"
    Assert-True ($exe.StartsWith([System.IO.Path]::GetFullPath($root))) "exe escaped the Hebrew/space root: $exe"
  }
  Test-Case 'no leftover backup sibling after a successful install' {
    $root = Join-Path $WorkRoot 'txn-clean'
    New-PriorCompanion -Root $root | Out-Null
    Invoke-CompanionInstall -Entrypoint $ep -InstallAction $layFiles -InstallRoot $root | Out-Null
    Assert-True (-not (Get-ChildItem -LiteralPath (Split-Path -Parent $root) -Filter '*.prev-*' -Force)) 'a rollback backup sibling leaked'
  }
}
