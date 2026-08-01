# safezip-entrypoint.tests.ps1 — fail-closed safe-ZIP extraction and deterministic
# companion-entrypoint resolution cases. Dot-sourced by scripts/test-bootstrap-lib.ps1
# and uses its shared Test-Case / Assert-True harness.

Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

function New-TestZip {
  param([string]$Destination, [object[]]$Entries)
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
  $archive = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($e in $Entries) {
      $entry = $archive.CreateEntry($e.Name)
      $s = $entry.Open()
      try { $s.Write($e.Bytes, 0, $e.Bytes.Length) } finally { $s.Dispose() }
    }
  }
  finally { $archive.Dispose() }
}

function Invoke-SafeZipEntrypointTests {
  param([Parameter(Mandatory)][string]$WorkRoot, [Parameter(Mandatory)][string]$ValidSha)
  Write-Host 'Safe ZIP + entrypoint:'

  Test-Case 'zip release without an entrypoint is rejected' {
    $threw = $false
    try { Assert-CompanionRelease -Release ([pscustomobject]@{ version = $BootstrapVersion; url = 'https://x/y.zip'; sha256 = $ValidSha; format = 'zip' }) | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'entrypoint') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a zip release without an entrypoint was accepted'
  }
  Test-Case 'zip release with a valid entrypoint normalizes' {
    $r = Assert-CompanionRelease -Release ([pscustomobject]@{ version = $BootstrapVersion; url = 'https://x/y.zip'; sha256 = $ValidSha; format = 'zip'; entrypoint = 'app/hermes-business.exe' })
    Assert-True ($r.entrypoint -eq 'app/hermes-business.exe') "entrypoint not normalized: $($r.entrypoint)"
  }
  Test-Case 'entrypoint validator rejects traversal / absolute / colon / non-exe / dir' {
    foreach ($bad in @('..\hermes.exe', '../hermes.exe', 'C:\hermes.exe', '/hermes.exe', 'a:stream.exe', 'app/hermes.dll', 'app/')) {
      $threw = $false
      try { Assert-CompanionEntrypoint -Entrypoint $bad | Out-Null } catch { $threw = $true }
      Assert-True $threw "entrypoint validator accepted a hostile value: '$bad'"
    }
  }
  Test-Case 'Expand-ArchiveSafely extracts a benign zip and promotes atomically' {
    $zip = Join-Path $WorkRoot 'benign.zip'
    New-TestZip -Destination $zip -Entries @(
      @{ Name = 'hermes-business.exe'; Bytes = [byte[]](1..64) },
      @{ Name = 'sub/data.txt'; Bytes = [System.Text.Encoding]::ASCII.GetBytes('ok') }
    )
    $dest = Join-Path $WorkRoot 'benign-out'
    Expand-ArchiveSafely -ArchivePath $zip -Destination $dest | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $dest 'hermes-business.exe') -PathType Leaf) 'entrypoint not extracted'
    Assert-True (Test-Path -LiteralPath (Join-Path $dest 'sub\data.txt') -PathType Leaf) 'nested file not extracted'
    $exe = Resolve-CompanionEntrypoint -InstallRoot $dest -Entrypoint 'hermes-business.exe'
    Assert-True ($exe.StartsWith([System.IO.Path]::GetFullPath($dest))) "entrypoint resolved outside root: $exe"
    # No staging siblings leak next to the promoted destination.
    Assert-True (-not (Get-ChildItem -LiteralPath $WorkRoot -Filter '.hermes-zip-stage-*' -Force)) 'a staging dir leaked'
  }
  Test-Case 'Expand-ArchiveSafely refuses a zip-slip entry and writes nothing' {
    $zip = Join-Path $WorkRoot 'slip.zip'
    New-TestZip -Destination $zip -Entries @(
      @{ Name = 'hermes-business.exe'; Bytes = [byte[]](1..64) },
      @{ Name = '../../slip-sentinel.txt'; Bytes = [System.Text.Encoding]::ASCII.GetBytes('PWNED') }
    )
    $dest = Join-Path $WorkRoot 'slip-out'
    $sentinel = Join-Path $WorkRoot 'slip-sentinel.txt'  # where '../../' would land
    $threw = $false
    try { Expand-ArchiveSafely -ArchivePath $zip -Destination $dest | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'traversal|outside|Refusing') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a zip-slip archive was not refused'
    Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'zip-slip wrote a file outside the destination'
    Assert-True (-not (Test-Path -LiteralPath $dest)) 'zip-slip promoted a partial destination'
    Assert-True (-not (Get-ChildItem -LiteralPath $WorkRoot -Filter '.hermes-zip-stage-*' -Force)) 'zip-slip leaked a staging dir'
  }
  Test-Case 'Resolve-CompanionEntrypoint fails closed when the entrypoint is absent' {
    $dest = Join-Path $WorkRoot 'no-ep-out'
    $zip = Join-Path $WorkRoot 'no-ep.zip'
    New-TestZip -Destination $zip -Entries @(@{ Name = 'readme.txt'; Bytes = [System.Text.Encoding]::ASCII.GetBytes('no exe') })
    Expand-ArchiveSafely -ArchivePath $zip -Destination $dest | Out-Null
    $threw = $false
    try { Resolve-CompanionEntrypoint -InstallRoot $dest -Entrypoint 'hermes-business.exe' | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'does not exist') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a missing entrypoint after extraction was not rejected'
  }
}
