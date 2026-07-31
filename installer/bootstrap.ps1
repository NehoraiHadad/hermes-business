[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$PayloadRoot,
  [string]$HermesHome = '',
  [switch]$SkipHermesInstall,
  [switch]$SkipGatewaySetup,
  [switch]$NoLaunch,
  [switch]$ResolveOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$MinimumHermesVersion = [version]'0.19.0'
$MaximumHermesVersion = [version]'0.20.0'
$Repository = 'NousResearch/hermes-agent'
$BootstrapVersion = '0.3.2'
$HermesHomeWasExplicit = -not [string]::IsNullOrWhiteSpace($HermesHome)

if (-not $HermesHomeWasExplicit) {
  $HermesHome = Join-Path $env:LOCALAPPDATA 'hermes'
}
$HermesHome = [System.IO.Path]::GetFullPath($HermesHome)
$LogDirectory = Join-Path $env:LOCALAPPDATA 'HermesBusinessBootstrap'
$LogPath = Join-Path $LogDirectory 'install.log'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-Step {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Find-Hermes {
  $candidates = @((Join-Path $HermesHome 'hermes-agent\venv\Scripts\hermes.exe'))
  if (-not $HermesHomeWasExplicit) {
    $candidates += @(
      (Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\venv\Scripts\hermes.exe'),
      (Join-Path $env:USERPROFILE '.hermes\hermes-agent\venv\Scripts\hermes.exe')
    )
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  if ($HermesHomeWasExplicit) {
    return $null
  }
  $command = Get-Command hermes.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command hermes -ErrorAction SilentlyContinue
  }
  if ($command) {
    return $command.Source
  }
  return $null
}

function Get-HermesVersion {
  param([string]$HermesExe)
  $text = (& $HermesExe --version 2>&1 | Out-String).Trim()
  $match = [regex]::Match($text, '\d+\.\d+\.\d+')
  if (-not $match.Success) {
    throw "Could not parse Hermes version from: $text"
  }
  return [version]$match.Value
}

function Assert-CompatibleVersion {
  param([version]$Version)
  if ($Version -lt $MinimumHermesVersion -or $Version -ge $MaximumHermesVersion) {
    throw "Hermes $Version is outside the tested range [$MinimumHermesVersion, $MaximumHermesVersion). Update the business bootstrap before continuing."
  }
}

function Get-ReleaseHermesVersion {
  param([object]$Release)
  $candidates = @(
    [string]$Release.name,
    [string]$Release.body,
    [string]$Release.tag_name
  )
  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    $match = [regex]::Match($candidate, '(?i)(?:Hermes(?:\s+Agent)?\s+v?)?(\d+\.\d+\.\d+)')
    if ($match.Success) {
      return [version]$match.Groups[1].Value
    }
  }
  return $null
}

function Resolve-LatestCompatibleRelease {
  $headers = @{
    'User-Agent' = "Hermes-Business-Bootstrap/$BootstrapVersion"
    'Accept' = 'application/vnd.github+json'
  }
  Write-Step "Resolving the newest official Hermes release in [$MinimumHermesVersion, $MaximumHermesVersion)."
  $releases = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/$Repository/releases?per_page=100" `
    -Headers $headers `
    -Method Get

  $compatible = foreach ($release in @($releases)) {
    if ($release.draft -or $release.prerelease) {
      continue
    }
    $version = Get-ReleaseHermesVersion -Release $release
    if ($null -ne $version -and $version -ge $MinimumHermesVersion -and $version -lt $MaximumHermesVersion) {
      [pscustomobject]@{
        release = $release
        version = $version
        publishedAt = [datetimeoffset]$release.published_at
      }
    }
  }
  $selected = $compatible |
    Sort-Object -Property @{ Expression = 'version'; Descending = $true }, @{ Expression = 'publishedAt'; Descending = $true } |
    Select-Object -First 1
  if (-not $selected) {
    throw "No compatible official Hermes release was found in [$MinimumHermesVersion, $MaximumHermesVersion)."
  }

  $tag = [string]$selected.release.tag_name
  if ($tag -notmatch '^v?[0-9][0-9A-Za-z.-]+$') {
    throw "The selected official release returned an unexpected tag: $tag"
  }
  return [pscustomobject]@{
    tag = $tag
    version = [string]$selected.version
    name = [string]$selected.release.name
    publishedAt = [string]$selected.release.published_at
  }
}

function Install-LatestCompatibleHermes {
  Write-Step 'Hermes was not found.'
  $headers = @{
    'User-Agent' = "Hermes-Business-Bootstrap/$BootstrapVersion"
    'Accept' = 'application/vnd.github+json'
  }
  $release = Resolve-LatestCompatibleRelease
  $tag = [string]$release.tag
  $releaseVersion = [version]$release.version
  Write-Step "Selected $($release.name) at immutable tag $tag."

  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-business-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
  try {
    $installerPath = Join-Path $temporaryDirectory 'install.ps1'
    $installerUri = "https://raw.githubusercontent.com/$Repository/$tag/scripts/install.ps1"
    Write-Step "Downloading immutable official installer for $tag."
    Invoke-WebRequest -Uri $installerUri -Headers $headers -OutFile $installerPath
    $installerInfo = Get-Item -LiteralPath $installerPath
    if ($installerInfo.Length -lt 500 -or $installerInfo.Length -gt 2MB) {
      throw "The downloaded installer has an unexpected size: $($installerInfo.Length) bytes"
    }
    $installerText = Get-Content -Raw -LiteralPath $installerPath
    if ($installerText -notmatch 'hermes' -or $installerText -notmatch 'python') {
      throw 'The downloaded installer did not pass the expected-content check.'
    }
    $installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash
    Write-Step "Installer SHA256: $installerHash"
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

function Assert-PluginSdkContract {
  $sdkPath = Join-Path $HermesHome 'hermes-agent\apps\desktop\src\sdk\index.ts'
  if (-not (Test-Path -LiteralPath $sdkPath -PathType Leaf)) {
    throw "Hermes Desktop Plugin SDK source was not found at $sdkPath."
  }
  $sdk = Get-Content -Raw -LiteralPath $sdkPath
  $requiredSymbols = @(
    'Badge',
    'Button',
    'Input',
    'Loader',
    'PALETTE_AREA',
    'ROUTES_AREA',
    'SIDEBAR_NAV_AREA',
    'StatusDot',
    'Textarea',
    'evaluateRuntimeReadiness',
    'host',
    'useValue'
  )
  $missing = @($requiredSymbols | Where-Object { $sdk -notmatch "(?m)\b$([regex]::Escape($_))\b" })
  if ($missing.Count -gt 0) {
    throw "Hermes Desktop Plugin SDK is incompatible; missing: $($missing -join ', ')."
  }
  Write-Step 'Hermes Desktop Plugin SDK contract check passed.'
}

function Copy-Atomic {
  param(
    [string]$Source,
    [string]$Target
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Required payload is missing: $Source"
  }
  $targetDirectory = Split-Path -Parent $Target
  New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  $temporaryTarget = "$Target.$PID.tmp"
  Copy-Item -LiteralPath $Source -Destination $temporaryTarget -Force
  Move-Item -LiteralPath $temporaryTarget -Destination $Target -Force
}

function Install-BusinessComponents {
  $pluginSource = Join-Path $PayloadRoot 'plugin.js'
  $skillSource = Join-Path $PayloadRoot 'business-bootstrap.SKILL.md'
  $pluginDirectory = Join-Path $HermesHome 'desktop-plugins\business-shell'
  $pluginTarget = Join-Path $pluginDirectory 'plugin.js'
  $skillTarget = Join-Path $HermesHome 'skills\productivity\business-bootstrap\SKILL.md'

  Write-Step 'Installing the Hermes Desktop business Plugin and first-run Skill.'
  Copy-Atomic -Source $pluginSource -Target $pluginTarget
  Copy-Atomic -Source $skillSource -Target $skillTarget

  $receipt = [ordered]@{
    id = 'business-shell'
    bootstrapVersion = $BootstrapVersion
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
    plugin = $pluginTarget
    pluginSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pluginTarget).Hash
    bootstrapSkill = $skillTarget
    bootstrapSkillSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $skillTarget).Hash
    preservesExistingHermesState = $true
  }
  $receiptPath = Join-Path $pluginDirectory 'install-receipt.json'
  $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Write-Step "Components installed. Receipt: $receiptPath"
}

function Ensure-Gateway {
  param([string]$HermesExe)
  Write-Step 'Checking the Hermes background gateway.'
  $statusOutput = (& $HermesExe gateway status 2>&1 | Out-String)
  $running = $LASTEXITCODE -eq 0 -and $statusOutput -match 'running'
  $startsOnLogin = $statusOutput -match 'login item installed|scheduled task (installed|registered)'
  if (-not ($running -and $startsOnLogin)) {
    Write-Step 'Installing and starting the official Hermes gateway service.'
    & $HermesExe gateway install --start-now --start-on-login
    if ($LASTEXITCODE -ne 0) {
      throw "Hermes gateway installation failed with exit code $LASTEXITCODE."
    }
  }

  $deepStatus = (& $HermesExe gateway status --deep 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $deepStatus -notmatch 'PASS') {
    throw "Hermes gateway health check failed.`n$deepStatus"
  }
  Write-Step 'Hermes gateway health check passed.'
}

try {
  Write-Step "Starting Hermes Business bootstrap $BootstrapVersion."
  Write-Step "Hermes home: $HermesHome"
  if ($ResolveOnly) {
    $resolved = Resolve-LatestCompatibleRelease
    $resolved | ConvertTo-Json -Compress
    exit 0
  }
  if ([string]::IsNullOrWhiteSpace($PayloadRoot)) {
    throw 'PayloadRoot is required unless ResolveOnly is used.'
  }
  $hermesExe = Find-Hermes
  if (-not $hermesExe -and -not $SkipHermesInstall) {
    Install-LatestCompatibleHermes
    $hermesExe = Find-Hermes
  }
  if (-not $hermesExe) {
    throw 'Hermes is not installed and installation was skipped or did not complete.'
  }

  $version = Get-HermesVersion -HermesExe $hermesExe
  Assert-CompatibleVersion $version
  Write-Step "Compatible Hermes $version detected at $hermesExe."

  Assert-PluginSdkContract
  Install-BusinessComponents
  if (-not $SkipGatewaySetup) {
    Ensure-Gateway -HermesExe $hermesExe
  }

  if (-not $NoLaunch) {
    Write-Step 'Opening Hermes Desktop. Choose the business assistant item to begin guided setup.'
    Start-Process -FilePath $hermesExe -ArgumentList 'desktop' -WindowStyle Hidden
  }

  Write-Step 'Bootstrap completed successfully.'
  exit 0
}
catch {
  Write-Step "ERROR: $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
