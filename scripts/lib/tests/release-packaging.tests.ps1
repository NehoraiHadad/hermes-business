# release-packaging.tests.ps1 — drift guard for the split Release facade. Release.ps1
# is a thin loader that dot-sources cohesive parts (Get-ReleaseModuleParts); a
# packaged thin install copies lib modules by an EXPLICIT File list in
# business-bootstrap.nsi, so a split part that is loaded-but-not-bundled would only
# fail on a customer's clean machine. This suite proves, offline, that every part
# the facade loads is (a) present on disk, (b) File-bundled in the NSI, (c)
# parse-gated by the test runner in facade load order, and (d) actually defines the
# public functions bootstrap/tests depend on — with no orphan or monolith regression.
# Dot-sourced by scripts/test-bootstrap-lib.ps1; uses its shared harness.

function Invoke-ReleasePackagingTests {
  param([Parameter(Mandatory)][string]$Root)
  Write-Host 'Release packaging drift:'

  $parts = @(Get-ReleaseModuleParts)
  $libDir = Join-Path $Root 'installer\lib'
  $nsiText = Get-Content -Raw -LiteralPath (Join-Path $Root 'installer\business-bootstrap.nsi')
  $runnerText = Get-Content -Raw -LiteralPath (Join-Path $Root 'scripts\test-bootstrap-lib.ps1')
  # Public functions each part must own; asserts the split PRESERVED them (not a
  # facade that quietly dropped a function) and did not leave a monolith behind.
  $partFunctions = @{
    'ReleaseSelection.ps1'   = @('Get-DefaultPinnedReleases', 'Get-ReleaseSourceVersion',
      'Select-CompatibleRelease', 'Get-GitHubApiHeaders', 'Resolve-LatestCompatibleRelease')
    'ReleaseAcquisition.ps1' = @('Assert-VerifiedInstallerBlob', 'Save-VerifiedOfficialInstaller',
      'Install-LatestCompatibleHermes')
  }

  Test-Case 'the facade advertises at least one split part' {
    Assert-True ($parts.Count -ge 1) 'Get-ReleaseModuleParts returned nothing'
    Assert-True ($null -ne ($partFunctions.Keys)) 'no part->function expectations defined'
  }

  foreach ($part in $parts) {
    $captured = $part
    Test-Case "split part on disk, bundled, and parse-gated: $captured" {
      Assert-True (Test-Path -LiteralPath (Join-Path $libDir $captured) -PathType Leaf) "part missing on disk: $captured"
      # (b) File-bundled in the NSI (a clean packaged install ships it).
      Assert-True ($nsiText -match [regex]::Escape("File `"lib\$captured`"")) "part not File-bundled in the NSI: $captured"
      # (c) parse-gated by the runner so a broken part fails the offline gate.
      Assert-True ($runnerText -match [regex]::Escape("installer\lib\$captured")) "part not parse-gated by the runner: $captured"
      $errors = $null
      $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $libDir $captured), [ref]$null, [ref]$errors)
      Assert-True (-not ($errors -and $errors.Count)) "part has parse errors: $captured"
    }
  }

  Test-Case 'the facade itself is bundled and stays a thin loader (no monolith)' {
    Assert-True ($nsiText -match [regex]::Escape('File "lib\Release.ps1"')) 'the Release.ps1 facade is not File-bundled'
    $facadeText = Get-Content -Raw -LiteralPath (Join-Path $libDir 'Release.ps1')
    Assert-True ($facadeText -match 'Get-ReleaseModuleParts') 'the facade does not expose its parts'
    Assert-True ($facadeText -match 'throw') 'the facade loader is not fail-closed on a missing part'
    foreach ($heavy in @('Install-LatestCompatibleHermes', 'Resolve-LatestCompatibleRelease', 'Save-VerifiedOfficialInstaller')) {
      Assert-True (-not ($facadeText -match "function\s+$heavy")) "the facade still defines the moved function $heavy (monolith not split)"
    }
  }

  Test-Case 'every bundled Release part is a known facade part (no orphan File line)' {
    $bundled = [regex]::Matches($nsiText, 'File\s+"lib\\(Release[^"\\]+\.ps1)"') |
      ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne 'Release.ps1' }
    foreach ($file in $bundled) {
      Assert-True ($parts -contains $file) "the NSI bundles an orphan Release part not loaded by the facade: $file"
    }
  }

  Test-Case 'parts are parse-gated in facade load order' {
    $positions = $parts | ForEach-Object { $runnerText.IndexOf("installer\lib\$_") }
    for ($i = 1; $i -lt $positions.Count; $i++) {
      Assert-True ($positions[$i - 1] -ge 0 -and $positions[$i] -gt $positions[$i - 1]) `
        "parse-gate order does not match facade load order at part '$($parts[$i])'"
    }
  }

  foreach ($part in $partFunctions.Keys) {
    $capturedPart = $part
    Test-Case "part defines and preserves its public functions: $capturedPart" {
      $text = Get-Content -Raw -LiteralPath (Join-Path $libDir $capturedPart)
      foreach ($fn in $partFunctions[$capturedPart]) {
        Assert-True ($text -match "function\s+$fn\b") "part '$capturedPart' no longer defines $fn"
        Assert-True ($null -ne (Get-Command $fn -ErrorAction SilentlyContinue)) "public function not loaded via the facade: $fn"
      }
    }
  }
}
