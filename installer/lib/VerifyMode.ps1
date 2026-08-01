# VerifyMode.ps1 — the bootstrap's verification-only entrypoints (-ResolveOnly
# and -VerifyInstallerOnly). Each emits compact JSON describing the selected
# official release / verified installer blob and exits 0 without touching the
# local machine, so verify:bootstrap can probe the live release channel offline
# of any install side effects. Dot-sourced by bootstrap.ps1.

function Invoke-VerificationOnlyMode {
  param(
    [switch]$ResolveOnly,
    [switch]$VerifyInstallerOnly,
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum,
    [Parameter(Mandatory)]$Headers
  )

  if ($ResolveOnly) {
    Resolve-LatestCompatibleRelease -Repository $Repository -Minimum $Minimum -Maximum $Maximum -Headers $Headers |
      ConvertTo-Json -Compress
    exit 0
  }

  if ($VerifyInstallerOnly) {
    $resolved = Resolve-LatestCompatibleRelease -Repository $Repository -Minimum $Minimum -Maximum $Maximum -Headers $Headers
    $temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-installer-$([guid]::NewGuid().ToString('N')).ps1"
    try {
      $blobSha = Save-VerifiedOfficialInstaller -Repository $Repository -Tag $resolved.tag -Destination $temporaryPath -Headers $Headers
      [ordered]@{
        tag     = $resolved.tag
        version = $resolved.version
        blobSha = $blobSha
        sha256  = (Get-Sha256Hash -Path $temporaryPath).ToUpperInvariant()
        size    = (Get-Item -LiteralPath $temporaryPath).Length
      } | ConvertTo-Json -Compress
      exit 0
    }
    finally {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
}
