[CmdletBinding()]
param([switch]$Keep)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$temporaryParent = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) 'hermes-business-e2e'))
$testRoot = [System.IO.Path]::GetFullPath((Join-Path $temporaryParent "hb-$([guid]::NewGuid().ToString('N').Substring(0, 8))"))
$payloadRoot = Join-Path $testRoot 'payload'
$hermesHome = Join-Path $testRoot 'home'

if (-not $testRoot.StartsWith($temporaryParent + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to use a clean-install directory outside $temporaryParent"
}

New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\business-shell\plugin.js') `
  -Destination (Join-Path $payloadRoot 'plugin.js')
Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md') `
  -Destination (Join-Path $payloadRoot 'business-bootstrap.SKILL.md')

try {
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File (Join-Path $root 'installer\bootstrap.ps1') `
    -PayloadRoot $payloadRoot `
    -HermesHome $hermesHome `
    -SkipGatewaySetup `
    -NoLaunch
  if ($LASTEXITCODE -ne 0) {
    throw "Clean Hermes bootstrap exited with code $LASTEXITCODE."
  }

  $hermesExe = Join-Path $hermesHome 'hermes-agent\venv\Scripts\hermes.exe'
  $plugin = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
  $skill = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
  $receipt = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
  foreach ($required in @($hermesExe, $plugin, $skill, $receipt)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Clean bootstrap did not create required file: $required"
    }
  }
  $versionOutput = (& $hermesExe --version 2>&1 | Out-String).Trim()
  if ($versionOutput -notmatch '0\.19\.\d+') {
    throw "Clean bootstrap installed an untested Hermes version: $versionOutput"
  }
  $installReceipt = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
  if (
    $installReceipt.pluginSha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $plugin).Hash -or
    $installReceipt.bootstrapSkillSha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $skill).Hash
  ) {
    throw 'Clean bootstrap receipt hashes do not match the installed payload.'
  }

  [pscustomobject]@{
    ok = $true
    isolatedHermesHome = $hermesHome
    version = $versionOutput
    plugin = $true
    bootstrapSkill = $true
    receiptVerified = $true
    cleaned = -not $Keep
  } | ConvertTo-Json
}
finally {
  if (-not $Keep -and (Test-Path -LiteralPath $testRoot)) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
