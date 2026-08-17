# CompanionManifest.ps1 — companion release MANIFEST read + contract validation.
#
# INTEGRITY MODEL (honest): the companion download is verified with a SHA-256
# CHECKSUM published in the release manifest. This is content integrity, not
# authenticity — it is NOT an Authenticode/code signature and does not prove
# publisher identity. We deliberately do not invent a signing key or a signature
# field we cannot actually verify. The manifest and installer must be served over
# HTTPS (loopback HTTP is allowed only for tests via -AllowInsecureUrl).
#
# This is the manifest/URL/checksum half of the companion contract; entrypoint
# path validation lives in CompanionEntrypoint.ps1 and download/extract
# orchestration in bootstrap-companion.ps1.
#
# Depends on: HttpRetry.ps1 (Invoke-HttpJson), Logging.ps1 (Write-Step),
#             CompanionEntrypoint.ps1 (Assert-CompanionEntrypoint).
#             Resolves headers from the caller's $BootstrapVersion when dot-sourced.

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
    # Explicit UTF-8, framework-direct: release names/notes may carry non-ASCII
    # and must parse identically under Windows PowerShell 5.1 (ANSI default)
    # and PowerShell 7. Inline (not FileOps' Read-Utf8File) because
    # bootstrap-companion.ps1 loads this module WITHOUT FileOps.ps1.
    return [System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($localManifest), (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
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
  $version = ConvertTo-BusinessSemVer $rawVersion
  $uri = [uri]$rawUrl
  $sha = $rawSha.Trim().ToUpperInvariant()
  # 'format' is optional and defaults to the production NSIS installer. 'zip' is a
  # host-agnostic portable payload that is extracted in place rather than run — it
  # requires no per-machine installer and is what the hermetic isolated E2E uses.
  $format = ([string]$Release.format).Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($format)) { $format = 'nsis' }
  if ($format -notin @('nsis', 'zip')) {
    throw "Unsupported companion release format '$format' (expected 'nsis' or 'zip')."
  }
  $range = Get-CompanionVersionRange -BootstrapVersion $BootstrapVersion
  if ((Compare-BusinessSemVer $version $range.minimum) -lt 0 -or
      (Compare-BusinessSemVer $version $range.maximumExclusive) -ge 0) {
    throw "Companion $rawVersion is outside the tested range [$($range.minimum.raw), $($range.maximumExclusive.raw))."
  }
  if ($uri.Scheme -ne 'https' -and -not ($AllowInsecureUrl -and $uri.IsLoopback)) {
    throw 'The companion installer URL must use HTTPS.'
  }
  # A full SHA-256 checksum is mandatory — this is the only integrity proof we
  # honestly have for the companion binary.
  if ($sha -notmatch '^[0-9A-F]{64}$') {
    throw 'The companion release manifest must contain a full SHA-256 checksum.'
  }
  # BOTH formats MUST declare the exact app entrypoint so the installed executable
  # is NAMED, never guessed (no "largest exe wins" scan). A 'zip' is attacker-shaped
  # content; an 'nsis' payload is trusted but its result is still resolved
  # deterministically against this declared path. Shape is validated now; existence
  # strictly under the install root is re-checked after install (see
  # Resolve-CompanionEntrypoint via Invoke-CompanionInstall).
  $entrypoint = Assert-CompanionEntrypoint -Entrypoint ([string]$Release.entrypoint)
  return [pscustomobject]@{ version = $version.raw; uri = $uri; sha256 = $sha; format = $format; entrypoint = $entrypoint }
}
