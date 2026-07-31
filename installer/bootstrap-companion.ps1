# bootstrap-companion.ps1 — optional business companion (Electron) installer.
#
# INTEGRITY MODEL (honest): the companion download is verified with a SHA-256
# CHECKSUM published in the release manifest. This is content integrity, not
# authenticity — it is NOT an Authenticode/code signature and does not prove
# publisher identity. We deliberately do not invent a signing key or a signature
# field we cannot actually verify. The manifest and installer must be served
# over HTTPS (loopback HTTP is allowed only for tests via -AllowInsecureUrl).
#
# This file is dot-sourced by bootstrap.ps1 after the installer/lib modules are
# loaded; when loaded standalone it pulls the shared helpers in itself.

if (-not (Get-Command Save-HttpFile -ErrorAction SilentlyContinue)) {
  $companionLib = Join-Path $PSScriptRoot 'lib'
  foreach ($module in @('Logging.ps1', 'Hashing.ps1', 'Http.ps1')) {
    $modulePath = Join-Path $companionLib $module
    if (Test-Path -LiteralPath $modulePath -PathType Leaf) {
      . $modulePath
    }
  }
}

function Get-CompanionExecutable {
  $directory = Join-Path $env:LOCALAPPDATA 'Programs\hermes-business'
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    return $null
  }
  $candidate = Get-ChildItem -LiteralPath $directory -Filter '*.exe' |
    Where-Object { $_.Name -notmatch '^Uninstall' } |
    Sort-Object Length -Descending |
    Select-Object -First 1
  return $candidate.FullName
}

function Read-CompanionRelease {
  param(
    [string]$PayloadRoot,
    [string]$ManifestUrl,
    [switch]$AllowInsecureUrl
  )
  if (-not [string]::IsNullOrWhiteSpace($ManifestUrl)) {
    $uri = [uri]$ManifestUrl
    if ($uri.Scheme -ne 'https' -and -not ($AllowInsecureUrl -and $uri.IsLoopback)) {
      throw 'The companion release manifest must use HTTPS.'
    }
    Write-Step "Downloading companion release manifest from $ManifestUrl."
    $headers = @{ 'User-Agent' = "Hermes-Business-Bootstrap/$BootstrapVersion" }
    $response = Invoke-HttpJson -Uri $uri -Headers $headers -Description 'companion release manifest'
    if ($response -is [string]) {
      $json = $response.TrimStart([char]0xFEFF)
      return $json | ConvertFrom-Json
    }
    return $response
  }

  $localManifest = Join-Path $PayloadRoot 'companion-release.json'
  if (Test-Path -LiteralPath $localManifest -PathType Leaf) {
    return Get-Content -Raw -LiteralPath $localManifest | ConvertFrom-Json
  }
  return $null
}

function Assert-CompanionRelease {
  param([object]$Release, [switch]$AllowInsecureUrl)
  if (-not $Release) {
    throw 'No companion release manifest was supplied.'
  }
  if ($Release -is [array]) {
    $Release = $Release | Select-Object -Last 1
  }
  $rawVersion = [string]$Release.version
  $rawUrl = [string]$Release.url
  $rawSha = [string]$Release.sha256
  if ([string]::IsNullOrWhiteSpace($rawVersion) -or [string]::IsNullOrWhiteSpace($rawUrl)) {
    throw 'The companion release manifest is missing version or URL.'
  }
  $version = [version]$rawVersion
  $uri = [uri]$rawUrl
  $sha = $rawSha.Trim().ToUpperInvariant()
  if ($version -lt [version]'0.3.3' -or $version -ge [version]'0.4.0') {
    throw "Companion $version is outside the tested range [0.3.3, 0.4.0)."
  }
  if ($uri.Scheme -ne 'https' -and -not ($AllowInsecureUrl -and $uri.IsLoopback)) {
    throw 'The companion installer URL must use HTTPS.'
  }
  # A full SHA-256 checksum is mandatory — this is the only integrity proof we
  # honestly have for the companion binary.
  if ($sha -notmatch '^[0-9A-F]{64}$') {
    throw 'The companion release manifest must contain a full SHA-256 checksum.'
  }
  return [pscustomobject]@{ version = $version; uri = $uri; sha256 = $sha }
}

function Install-BusinessCompanion {
  param(
    [string]$PayloadRoot,
    [string]$ManifestUrl,
    [switch]$AllowInsecureUrl
  )
  $release = Assert-CompanionRelease `
    -Release (Read-CompanionRelease -PayloadRoot $PayloadRoot -ManifestUrl $ManifestUrl -AllowInsecureUrl:$AllowInsecureUrl) `
    -AllowInsecureUrl:$AllowInsecureUrl
  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-business-shell-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
  try {
    $installer = Join-Path $temporaryDirectory 'companion-setup.exe'
    Write-Step "Downloading business companion $($release.version)."
    # Retry-wrapped download with size bounds and mandatory SHA-256 verification;
    # a truncated or mismatched body is rejected before the installer ever runs.
    Save-HttpFile `
      -Uri $release.uri `
      -Destination $installer `
      -Headers @{ 'User-Agent' = "Hermes-Business-Bootstrap/$BootstrapVersion" } `
      -ExpectedSha256 $release.sha256 `
      -MinBytes 1MB `
      -MaxBytes 300MB `
      -Description "business companion $($release.version)" | Out-Null
    Write-Step "Companion SHA-256 checksum verified: $($release.sha256)"

    $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
      throw "The companion installer exited with code $($process.ExitCode)."
    }
    $executable = Get-CompanionExecutable
    if (-not $executable -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
      throw 'The companion installer returned success without creating the application executable.'
    }
    Write-Step "Business companion $($release.version) installed."
    return $executable
  }
  finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
}
