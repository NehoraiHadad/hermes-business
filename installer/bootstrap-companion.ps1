# bootstrap-companion.ps1 — optional business companion (Electron) installer.
#
# Small coordinator: it wires the companion library modules together and runs the
# download -> verify -> install/extract orchestration. The pieces it depends on
# live in installer/lib:
#   * CompanionManifest.ps1   — manifest read + release contract (URL/checksum).
#   * CompanionEntrypoint.ps1 — install-root + entrypoint validation/resolution.
#   * HttpRetry/HttpDownload  — retry-wrapped, bounded, hash-verified download.
#   * ZipPolicy/SafeZip       — fail-closed extraction of the untrusted ZIP payload.
#
# INTEGRITY MODEL (honest): the companion is verified by a SHA-256 CHECKSUM in the
# release manifest — content integrity, NOT an Authenticode/publisher signature.
#
# This file is dot-sourced by bootstrap.ps1 after the installer/lib modules are
# loaded; when loaded standalone it pulls the shared helpers in itself. Each module
# is loaded only when its probe command is not already defined, so re-loading over
# an already-initialized session is a no-op.

$companionLib = Join-Path $PSScriptRoot 'lib'
foreach ($dependency in @(
    @{ File = 'Logging.ps1';             Probe = 'Write-Step' },
    @{ File = 'Hashing.ps1';             Probe = 'Assert-Sha256Match' },
    @{ File = 'HttpRetry.ps1';           Probe = 'Invoke-HttpJson' },
    @{ File = 'HttpDownload.ps1';        Probe = 'Save-HttpFile' },
    @{ File = 'ZipPolicy.ps1';           Probe = 'Resolve-SafeZipTarget' },
    @{ File = 'SafeZip.ps1';             Probe = 'Expand-ArchiveSafely' },
    @{ File = 'CompanionEntrypoint.ps1'; Probe = 'Resolve-CompanionEntrypoint' },
    @{ File = 'CompanionInstall.ps1';    Probe = 'Invoke-CompanionInstall' },
    @{ File = 'CompanionManifest.ps1';   Probe = 'Assert-CompanionRelease' }
  )) {
  if (Get-Command $dependency.Probe -ErrorAction SilentlyContinue) { continue }
  $modulePath = Join-Path $companionLib $dependency.File
  if (Test-Path -LiteralPath $modulePath -PathType Leaf) {
    . $modulePath
  }
}

function Install-BusinessCompanion {
  param(
    [string]$PayloadRoot,
    [string]$ManifestUrl,
    [string]$InstallRoot,
    [switch]$AllowInsecureUrl
  )
  $release = Assert-CompanionRelease `
    -Release (Read-CompanionRelease -PayloadRoot $PayloadRoot -ManifestUrl $ManifestUrl -AllowInsecureUrl:$AllowInsecureUrl) `
    -AllowInsecureUrl:$AllowInsecureUrl
  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-business-shell-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
  try {
    $isZip = $release.format -eq 'zip'
    $artifact = Join-Path $temporaryDirectory ($(if ($isZip) { 'companion.zip' } else { 'companion-setup.exe' }))
    Write-Step "Downloading business companion $($release.version) ($($release.format))."
    # Retry-wrapped download with size bounds and mandatory SHA-256 verification;
    # a truncated or mismatched body is rejected before it is ever run/extracted.
    Save-HttpFile `
      -Uri $release.uri `
      -Destination $artifact `
      -Headers @{ 'User-Agent' = "Hermes-Business-Bootstrap/$BootstrapVersion" } `
      -ExpectedSha256 $release.sha256 `
      -MinBytes $(if ($isZip) { 128 } else { 1MB }) `
      -MaxBytes 300MB `
      -Description "business companion $($release.version)" | Out-Null
    Write-Step "Companion SHA-256 checksum verified: $($release.sha256)"

    $directory = Get-CompanionInstallRoot -InstallRoot $InstallRoot
    # Both formats install through ONE transaction (Invoke-CompanionInstall): the
    # prior companion is moved aside, the format-specific action mutates only the
    # isolated install root, and the app exe is resolved DETERMINISTICALLY from the
    # manifest-declared entrypoint. Any failure rolls back to the prior companion.
    if ($isZip) {
      # Host-agnostic portable payload: fail-closed per-entry validation + atomic
      # promotion into the install root. Never touches the shared Hermes state.
      $installAction = {
        param($root)
        Expand-ArchiveSafely -ArchivePath $artifact -Destination $root | Out-Null
      }.GetNewClosure()
    }
    else {
      # Trusted NSIS installer, directed INTO the isolated root. NSIS consumes the
      # whole tail after '/D=' verbatim (unquoted, last arg), so a single argument
      # string is the only form that survives spaces/Hebrew in $root.
      $installAction = {
        param($root)
        $process = Start-Process -FilePath $artifact -Wait -PassThru -WindowStyle Hidden `
          -ArgumentList ('/S /D={0}' -f $root)
        if ($process.ExitCode -ne 0) {
          throw "The companion installer exited with code $($process.ExitCode)."
        }
      }.GetNewClosure()
    }
    $executable = Invoke-CompanionInstall -Entrypoint $release.entrypoint -InstallAction $installAction -InstallRoot $InstallRoot
    if (-not $executable -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
      throw 'The companion install returned success without producing the application executable.'
    }
    Write-Step "Business companion $($release.version) installed to $directory."
    return $executable
  }
  finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
}
