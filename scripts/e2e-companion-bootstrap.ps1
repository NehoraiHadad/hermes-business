[CmdletBinding()]
param([switch]$Keep)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$productVersion = [string](Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
$installer = Get-ChildItem -LiteralPath (Join-Path $root 'release') -Filter "*Setup $productVersion.exe" |
  Where-Object { $_.Length -gt 1MB } |
  Sort-Object Length -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw 'The full companion installer was not found. Run npm run package:win first.'
}
$temporaryParent = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) 'hermes-business-companion-e2e'))
$testRoot = Join-Path $temporaryParent "run-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$serverRoot = Join-Path $testRoot 'server'
$payloadRoot = Join-Path $testRoot 'payload'
$serverProcess = $null

if (-not $testRoot.StartsWith($temporaryParent + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to use a test directory outside $temporaryParent"
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
}

try {
  New-Item -ItemType Directory -Force -Path $serverRoot, $payloadRoot | Out-Null
  $servedInstaller = Join-Path $serverRoot 'companion-setup.exe'
  Copy-Item -LiteralPath $installer.FullName -Destination $servedInstaller
  $sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $servedInstaller).Hash
  $port = Get-FreePort
  $manifestJson = [ordered]@{
    version = $productVersion
    url = "http://127.0.0.1:$port/companion-setup.exe"
    sha256 = $sha256
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText(
    (Join-Path $serverRoot 'manifest.json'),
    $manifestJson,
    [System.Text.UTF8Encoding]::new($false)
  )

  $python = (Get-Command python.exe -ErrorAction Stop).Source
  $serverProcess = Start-Process `
    -FilePath $python `
    -ArgumentList @('-m', 'http.server', [string]$port, '--bind', '127.0.0.1') `
    -WorkingDirectory $serverRoot `
    -WindowStyle Hidden `
    -PassThru

  Copy-Item -LiteralPath (Join-Path $root 'installer\bootstrap-companion.ps1') `
    -Destination (Join-Path $payloadRoot 'bootstrap-companion.ps1')
  Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\business-shell\plugin.js') `
    -Destination (Join-Path $payloadRoot 'plugin.js')
  Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md') `
    -Destination (Join-Path $payloadRoot 'business-bootstrap.SKILL.md')
  $policyPayload = Join-Path $payloadRoot 'whatsapp-policy'
  New-Item -ItemType Directory -Force -Path $policyPayload | Out-Null
  foreach ($name in @('__init__.py', 'policy.py', 'ingest.py', 'contract.py', 'surface.py', 'guards.py', 'transport.py', 'registry.py', 'guard_core.py', 'surface_core.py', 'dispatch.py', 'telegram_policy.py', 'telegram_contract.py', 'telegram_surface.py', 'telegram_transport.py', 'telegram_registry.py', 'plugin.yaml')) {
    Copy-Item -LiteralPath (Join-Path $root "hermes-plugin\business-whatsapp-policy\$name") `
      -Destination (Join-Path $policyPayload $name)
  }

  $manifestUrl = "http://127.0.0.1:$port/manifest.json"
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing | Out-Null
      break
    }
    catch {
      if ($attempt -eq 29) { throw }
      Start-Sleep -Milliseconds 200
    }
  }

  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File (Join-Path $root 'installer\bootstrap.ps1') `
    -PayloadRoot $payloadRoot `
    -HermesHome (Join-Path $env:LOCALAPPDATA 'hermes') `
    -SkipHermesInstall `
    -SkipGatewaySetup `
    -CompanionManifestUrl $manifestUrl `
    -AllowInsecureCompanionUrl `
    -NoLaunch
  if ($LASTEXITCODE -ne 0) {
    throw "Companion bootstrap exited with code $LASTEXITCODE."
  }

  $installed = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\hermes-business') -Filter '*.exe' |
    Where-Object { $_.Name -notmatch '^Uninstall' } |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if (-not $installed) {
    throw 'Companion bootstrap did not create the installed application executable.'
  }
  [pscustomobject]@{
    ok = $true
    downloadedOverHttpLoopbackForTestOnly = $true
    sha256Verified = $true
    installed = $installed.FullName
  } | ConvertTo-Json
}
finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
    $serverProcess.WaitForExit()
  }
  if (-not $Keep -and (Test-Path -LiteralPath $testRoot)) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
