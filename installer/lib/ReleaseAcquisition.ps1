# ReleaseAcquisition.ps1 — the "fetch and run it safely" half of the release
# contract: download the official installer pinned to an immutable tag, prove it
# against GitHub's git blob SHA-1 before it touches disk, then run it into
# $HermesHome. Never bundles Hermes. Loaded via the Release.ps1 facade. Depends on
# Logging.ps1, HttpRetry.ps1 (Invoke-HttpJson), Hashing.ps1; release SELECTION
# (which tag to install) lives in ReleaseSelection.ps1.

function Assert-VerifiedInstallerBlob {
  # Pure, network-free IMMUTABILITY check for the official installer. Recomputes
  # GitHub's git blob SHA-1 over the exact bytes and refuses to write unless it
  # matches BOTH the ref-resolved id AND the id the blob endpoint reported, so a
  # tampered mirror/MITM cannot substitute a payload. Also enforces a sane size
  # and an expected-content probe. Returns the verified blob id; throws otherwise.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][byte[]]$Content,
    [Parameter(Mandatory)][string]$ExpectedBlobSha,
    [Parameter(Mandatory)][string]$ReportedBlobSha,
    [Parameter(Mandatory)][string]$Destination,
    [string]$Tag = 'the pinned tag'
  )
  $expected = ([string]$ExpectedBlobSha).ToLowerInvariant()
  if ($expected -notmatch '^[0-9a-f]{40}$') {
    throw "GitHub returned invalid installer metadata for $Tag."
  }
  $actualBlobSha = Get-GitBlobSha1 -Content $Content
  if ($actualBlobSha -ne $expected -or ([string]$ReportedBlobSha).ToLowerInvariant() -ne $expected) {
    throw "The official installer failed git blob integrity verification for $Tag."
  }
  if ($Content.Length -lt 500 -or $Content.Length -gt 2MB) {
    throw "The downloaded installer has an unexpected size: $($Content.Length) bytes."
  }
  $text = [System.Text.Encoding]::UTF8.GetString($Content)
  if ($text -notmatch 'hermes' -or $text -notmatch 'python') {
    throw 'The downloaded installer did not pass the expected-content check.'
  }
  [System.IO.File]::WriteAllBytes($Destination, $Content)
  return $expected
}

function Save-VerifiedOfficialInstaller {
  # Downloads scripts/install.ps1 pinned to an immutable tag via the GitHub
  # Contents/Blobs API and verifies it against the git blob SHA-1 GitHub
  # advertises, so a tampered mirror or MITM cannot substitute a payload.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$Tag,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][hashtable]$Headers
  )
  $path = 'scripts/install.ps1'
  $encodedTag = [uri]::EscapeDataString($Tag)
  $metadata = Invoke-HttpJson `
    -Uri "https://api.github.com/repos/$Repository/contents/$path`?ref=$encodedTag" `
    -Headers $Headers `
    -Description "installer metadata for $Tag"
  $expectedBlobSha = ([string]$metadata.sha).ToLowerInvariant()
  if ($metadata.type -ne 'file' -or $expectedBlobSha -notmatch '^[0-9a-f]{40}$') {
    throw "GitHub returned invalid installer metadata for $Tag."
  }

  $blob = Invoke-HttpJson `
    -Uri "https://api.github.com/repos/$Repository/git/blobs/$expectedBlobSha" `
    -Headers $Headers `
    -Description "installer blob for $Tag"
  if ($blob.encoding -ne 'base64' -or [string]::IsNullOrWhiteSpace([string]$blob.content)) {
    throw "GitHub returned an unsupported installer blob for $Tag."
  }
  try {
    [byte[]]$installerBytes = [Convert]::FromBase64String(([string]$blob.content -replace '\s', ''))
  }
  catch {
    throw "GitHub returned malformed installer content for $Tag."
  }
  return Assert-VerifiedInstallerBlob `
    -Content $installerBytes `
    -ExpectedBlobSha $expectedBlobSha `
    -ReportedBlobSha ([string]$blob.sha) `
    -Destination $Destination `
    -Tag $Tag
}

function Install-LatestCompatibleHermes {
  # Detect-then-download flow entry point: pick the newest compatible tagged
  # release, verify+run the official installer into $HermesHome, and confirm the
  # expected hermes.exe was produced. Never bundles or vendors Hermes.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum,
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][hashtable]$Headers
  )
  Write-Step 'Hermes was not found; downloading the newest compatible official release.'
  $release = Resolve-LatestCompatibleRelease -Repository $Repository -Minimum $Minimum -Maximum $Maximum -Headers $Headers
  $tag = [string]$release.tag
  Write-Step "Selected $($release.name) at immutable tag $tag."

  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-business-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
  try {
    $installerPath = Join-Path $temporaryDirectory 'install.ps1'
    Write-Step "Downloading and verifying the official installer blob for $tag."
    $installerBlobSha = Save-VerifiedOfficialInstaller -Repository $Repository -Tag $tag -Destination $installerPath -Headers $Headers
    Write-Step "Verified installer git blob: $installerBlobSha"
    Write-Step "Installer SHA256: $(Get-Sha256Hash -Path $installerPath)"

    $stdoutPath = Join-Path $temporaryDirectory 'installer.stdout.log'
    $stderrPath = Join-Path $temporaryDirectory 'installer.stderr.log'
    $process = Start-Process `
      -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
      -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $installerPath),
        '-Tag', $tag,
        '-HermesHome', ('"{0}"' -f $HermesHome),
        '-InstallDir', ('"{0}"' -f (Join-Path $HermesHome 'hermes-agent')),
        '-NonInteractive',
        '-Json',
        '-IncludeDesktop'
      ) `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -WindowStyle Hidden `
      -PassThru `
      -Wait
    $installerOutput = @(
      (Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue),
      (Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue)
    ) -join "`n"
    if ($installerOutput.Length -gt 6000) {
      $installerOutput = $installerOutput.Substring($installerOutput.Length - 6000)
    }
    if ($process.ExitCode -ne 0) {
      throw "The official Hermes installer exited with code $($process.ExitCode).`n$installerOutput"
    }
    $expectedHermes = Join-Path $HermesHome 'hermes-agent\venv\Scripts\hermes.exe'
    if (-not (Test-Path -LiteralPath $expectedHermes -PathType Leaf)) {
      throw "The official Hermes installer returned success without creating $expectedHermes.`n$installerOutput"
    }
  }
  finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
}
