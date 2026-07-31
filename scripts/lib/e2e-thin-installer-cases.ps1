# e2e-thin-installer-cases.ps1 — fixtures + case bodies for the thin-installer E2E.
#
# Keeps scripts/e2e-thin-network-installer.ps1 a small orchestrator: this file owns
# (a) building + publishing the manifest/zip fixtures, (b) the nine declarative
# security/behaviour assertions, and (c) the optional QA-artifact publisher. Every
# function takes a single $Ctx bag so no ambient state leaks between the runner and
# the cases. Dot-sourced by the runner alongside e2e-thin-installer-lib.ps1.

function Write-CaseManifest {
  # Serialize one companion manifest into the server root.
  param([hashtable]$Ctx, [string]$Name, [hashtable]$Fields)
  [System.IO.File]::WriteAllText((Join-Path $Ctx.ServerRoot $Name),
    ([pscustomobject]$Fields | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
}

function New-ThinInstallerFixtures {
  # Build the portable-zip artifacts (good / zip-slip / decoy), hash them, and
  # publish every manifest variant the cases exercise. Populates $Ctx with the
  # resulting hashes/paths the assertions read back.
  param([hashtable]$Ctx)
  $ver = $Ctx.BootstrapVersion
  $ep = $Ctx.Entrypoint
  $baseUrl = $Ctx.BaseUrl

  $zip = Join-Path $Ctx.ServerRoot 'companion.zip'
  New-PortableCompanionZip -Destination $zip -Version $ver
  $Ctx.Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash
  $Ctx.ZipBytes = (Get-Item -LiteralPath $zip).Length

  $slipZip = Join-Path $Ctx.ServerRoot 'companion-slip.zip'
  New-ZipSlipCompanionZip -Destination $slipZip
  $slipSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $slipZip).Hash

  $decoyZip = Join-Path $Ctx.ServerRoot 'companion-decoy.zip'
  New-DecoyEntrypointZip -Destination $decoyZip
  $decoySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $decoyZip).Hash

  $Ctx.EvilRoot = Join-Path $Ctx.TestRoot 'MANIFEST-CHOSEN-ROOT'

  Write-CaseManifest $Ctx 'manifest.json'         @{ version = $ver; url = "$baseUrl/companion.zip"; sha256 = $Ctx.Sha256; format = 'zip'; entrypoint = $ep }
  Write-CaseManifest $Ctx 'manifest-bad.json'     @{ version = $ver; url = "$baseUrl/companion.zip"; sha256 = ('0' * 64); format = 'zip'; entrypoint = $ep }
  Write-CaseManifest $Ctx 'manifest-offline.json' @{ version = $ver; url = "http://127.0.0.1:$($Ctx.DeadPort)/companion.zip"; sha256 = $Ctx.Sha256; format = 'zip'; entrypoint = $ep }
  Write-CaseManifest $Ctx 'manifest-nonloop.json' @{ version = $ver; url = 'http://203.0.113.5/companion.zip'; sha256 = $Ctx.Sha256; format = 'zip'; entrypoint = $ep }
  Write-CaseManifest $Ctx 'manifest-slip.json'    @{ version = $ver; url = "$baseUrl/companion-slip.zip"; sha256 = $slipSha; format = 'zip'; entrypoint = $ep }
  Write-CaseManifest $Ctx 'manifest-decoy.json'   @{ version = $ver; url = "$baseUrl/companion-decoy.zip"; sha256 = $decoySha; format = 'zip'; entrypoint = $ep }
  Write-CaseManifest $Ctx 'manifest-inject.json'  @{ version = $ver; url = "$baseUrl/companion.zip"; sha256 = $Ctx.Sha256; format = 'zip'; entrypoint = $ep; installRoot = $Ctx.EvilRoot; destination = $Ctx.EvilRoot; path = $Ctx.EvilRoot }
}

function Invoke-ThinInstallerCases {
  # The nine end-to-end assertions over the download -> verify -> safe-extract
  # pipeline and its fail-closed guards. Returns the ordered results map.
  param([hashtable]$Ctx)
  $baseUrl = $Ctx.BaseUrl
  $installRoot = $Ctx.InstallRoot
  $testRoot = $Ctx.TestRoot
  $stateFile = $Ctx.StateFile
  $stateBefore = $Ctx.StateHashBefore
  $ep = $Ctx.Entrypoint
  $results = [ordered]@{}

  # === Case 1: positive — download, verify SHA-256, safe-extract into isolation.
  Write-Host '== Case 1: download + verify + safe-extract (isolated) =='
  $exe = Install-BusinessCompanion -ManifestUrl "$baseUrl/manifest.json" -InstallRoot $installRoot -AllowInsecureUrl
  Assert-True ([bool]$exe) 'positive install returned no executable'
  Assert-True (Test-Path -LiteralPath $exe -PathType Leaf) "installed exe missing at $exe"
  Assert-True ($exe.StartsWith([System.IO.Path]::GetFullPath($installRoot))) "exe landed outside the isolated root: $exe"
  Assert-True ((Split-Path -Leaf $exe) -eq $ep) "resolved exe is not the declared entrypoint: $exe"
  Assert-True (Test-Path -LiteralPath (Join-Path $installRoot 'plugin.js')) 'zip payload not fully extracted'
  $results.positive = @{ ok = $true; exe = $exe; sha256Verified = $Ctx.Sha256; downloadedOverHttpLoopbackForTestOnly = $true }

  # === Case 2: preservation — the pre-existing Hermes state is untouched. ======
  Write-Host '== Case 2: existing Hermes user state preserved =='
  $stateAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $stateFile).Hash
  Assert-True ($stateAfter -eq $stateBefore) 'pre-existing Hermes user state was modified'
  $results.statePreserved = @{ ok = $true; before = $stateBefore; after = $stateAfter }

  # === Case 3: fail closed on SHA-256 mismatch. ================================
  Write-Host '== Case 3: hash mismatch fails closed =='
  $results.hashMismatchFailsClosed = @{ ok = $true; error =
    (Invoke-ExpectFailClosed -ManifestUrl "$baseUrl/manifest-bad.json" -InstallRoot (Join-Path $testRoot 'install-mismatch') -Pattern 'mismatch|tampered|truncated' -AllowInsecureUrl) }

  # === Case 4: fail closed on a network failure (dead endpoint). ==============
  Write-Host '== Case 4: network failure fails closed =='
  $results.networkFailureFailsClosed = @{ ok = $true; error =
    (Invoke-ExpectFailClosed -ManifestUrl "$baseUrl/manifest-offline.json" -InstallRoot (Join-Path $testRoot 'install-offline') -Pattern 'offline|connection|reach|attempt' -AllowInsecureUrl) }

  # === Case 5: HTTPS contract enforced — plain-HTTP URL rejected w/o override. =
  Write-Host '== Case 5: HTTPS contract enforced =='
  $results.httpsContractEnforced = @{ ok = $true; error =
    (Invoke-ExpectFailClosed -ManifestUrl "$baseUrl/manifest.json" -InstallRoot (Join-Path $testRoot 'install-https') -Pattern 'HTTPS') }

  # === Case 6: non-loopback HTTP rejected even WITH -AllowInsecureUrl. =========
  Write-Host '== Case 6: non-loopback HTTP rejected despite AllowInsecureUrl =='
  $results.nonLoopbackRejected = @{ ok = $true; error =
    (Invoke-ExpectFailClosed -ManifestUrl "$baseUrl/manifest-nonloop.json" -InstallRoot (Join-Path $testRoot 'install-nonloop') -Pattern 'HTTPS' -AllowInsecureUrl) }

  # === Case 7: zip-slip cannot write outside the install root. ================
  Write-Host '== Case 7: zip-slip entry refused; Hermes state sentinel untouched =='
  $slipError = Invoke-ExpectFailClosed -ManifestUrl "$baseUrl/manifest-slip.json" -InstallRoot (Join-Path $testRoot 'install-slip') -Pattern 'traversal|outside|Refusing' -AllowInsecureUrl
  Assert-True (((Get-FileHash -Algorithm SHA256 -LiteralPath $stateFile).Hash) -eq $stateBefore) 'zip-slip overwrote the Hermes state sentinel'
  $results.zipSlipRefused = @{ ok = $true; error = $slipError }

  # === Case 8: manifest cannot inject the InstallRoot. ========================
  Write-Host '== Case 8: manifest-declared InstallRoot is ignored =='
  $injectRoot = Join-Path $testRoot 'install-inject'
  $exe8 = Install-BusinessCompanion -ManifestUrl "$baseUrl/manifest-inject.json" -InstallRoot $injectRoot -AllowInsecureUrl
  Assert-True ($exe8.StartsWith([System.IO.Path]::GetFullPath($injectRoot))) "install did not use the caller's InstallRoot: $exe8"
  Assert-True (-not (Test-Path -LiteralPath $Ctx.EvilRoot)) 'manifest injected an InstallRoot outside the caller-supplied root'
  $results.installRootNotInjectable = @{ ok = $true; exe = $exe8 }

  # === Case 9: deterministic entrypoint used; larger decoy exe NOT selected. ==
  Write-Host '== Case 9: deterministic entrypoint beats the larger decoy exe =='
  $decoyRoot = Join-Path $testRoot 'install-decoy'
  $exe9 = Install-BusinessCompanion -ManifestUrl "$baseUrl/manifest-decoy.json" -InstallRoot $decoyRoot -AllowInsecureUrl
  Assert-True ((Split-Path -Leaf $exe9) -eq $ep) "a non-entrypoint exe was selected: $exe9"
  $decoyExe = Join-Path $decoyRoot 'tools\updater-bigger.exe'
  Assert-True (Test-Path -LiteralPath $decoyExe -PathType Leaf) 'decoy exe was not extracted (archive should extract fully)'
  Assert-True ((Get-Item -LiteralPath $decoyExe).Length -gt (Get-Item -LiteralPath $exe9).Length) 'test invalid: decoy is not larger than the entrypoint'
  $results.deterministicEntrypoint = @{ ok = $true; exe = $exe9; largerDecoyIgnored = $decoyExe }

  return $results
}

function Publish-QaArtifact {
  # Optional QA-only artifact + evidence next to the binaries (never distributed).
  param([hashtable]$Ctx)
  $qaDir = Join-Path $Ctx.RepoRoot 'release\qa-thin-installer-DO-NOT-DISTRIBUTE'
  New-Item -ItemType Directory -Force -Path $qaDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $Ctx.ServerRoot 'companion.zip') -Destination (Join-Path $qaDir 'companion.zip') -Force
  $qaManifest = [ordered]@{
    version = $Ctx.BootstrapVersion
    url = '<REPLACE-WITH-PUBLISHED-HTTPS-URL>'
    sha256 = $Ctx.Sha256
    format = 'zip'
    entrypoint = $Ctx.Entrypoint
    note = 'QA-ONLY. Loopback-verified. url is a placeholder; no production URL is invented.'
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText((Join-Path $qaDir 'companion-release.json'), $qaManifest, [System.Text.UTF8Encoding]::new($false))
  Set-Content -LiteralPath (Join-Path $qaDir 'DO-NOT-DISTRIBUTE.txt') -Encoding ascii -Value @(
    'QA-ONLY THIN NETWORK INSTALLER ARTIFACT — DO NOT DISTRIBUTE',
    '===========================================================',
    '',
    'companion.zip is a portable-zip companion payload proven end-to-end by',
    'scripts/e2e-thin-network-installer.ps1 over a loopback HTTP server: it is',
    'downloaded, its exact SHA-256 is verified, and it is SAFE-extracted (per-entry',
    'validated, zip-slip refused) into an isolated install root via the manifest',
    'entrypoint, with fail-closed on hash mismatch / network failure.',
    '',
    'companion-release.json intentionally carries a PLACEHOLDER url and the real',
    'entrypoint. A truly distributable network installer requires the operator to',
    'publish this zip (or the NSIS companion) at a signed HTTPS endpoint and set',
    'that url + sha256. No production URL is invented here.'
  )
  return @{ dir = $qaDir; zip = 'companion.zip'; sha256 = $Ctx.Sha256; bytes = $Ctx.ZipBytes; entrypoint = $Ctx.Entrypoint }
}
