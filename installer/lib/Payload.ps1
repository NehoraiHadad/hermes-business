# Payload.ps1 — single source of truth for installing the business payload
# (plugin + first-run skill + WhatsApp reply-policy) as ONE transaction.
#
# Guarantees:
#   * Validate first: every source is checked before any target is touched, so
#     an incomplete payload aborts with the previous install fully intact.
#   * Stage: sources are copied to a staging area and re-hashed before commit.
#   * Commit: each target is backed up (if it existed) then atomically replaced.
#   * Activate: an optional step (e.g. `hermes plugins enable`) runs last.
#   * Rollback: if commit or activation fails, every backed-up file is restored
#     and every newly-created file is removed, then a rollback receipt is written.
#   * Receipt: on success a completion receipt records the installed hashes.
# Only the payload's own target paths are ever modified — unrelated user data is
# never touched.
#
# Depends on: Logging.ps1, Hashing.ps1 (Get-Sha256Hash), FileOps.ps1 (Copy-Atomic).

function Assert-PluginSdkContract {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$HermesHome)
  $sdkPath = Join-Path $HermesHome 'hermes-agent\apps\desktop\src\sdk\index.ts'
  if (-not (Test-Path -LiteralPath $sdkPath -PathType Leaf)) {
    throw "Hermes Desktop Plugin SDK source was not found at $sdkPath."
  }
  $sdk = Get-Content -Raw -LiteralPath $sdkPath
  $requiredSymbols = @(
    'Badge', 'Button', 'Input', 'Loader', 'PALETTE_AREA', 'ROUTES_AREA',
    'SIDEBAR_NAV_AREA', 'StatusDot', 'Textarea', 'evaluateRuntimeReadiness',
    'host', 'useValue'
  )
  $missing = @($requiredSymbols | Where-Object { $sdk -notmatch "(?m)\b$([regex]::Escape($_))\b" })
  if ($missing.Count -gt 0) {
    throw "Hermes Desktop Plugin SDK is incompatible; missing: $($missing -join ', ')."
  }
  Write-Step 'Hermes Desktop Plugin SDK contract check passed.'
}

function Get-ReceiptDirectory {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$HermesHome)
  $dir = Join-Path $HermesHome '.business-bootstrap-receipts'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Invoke-PayloadTransaction {
  # Files: array of hashtables @{ Source = <path>; Target = <path> }.
  # Activate: optional scriptblock run after commit; throwing triggers rollback.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][object[]]$Files,
    [Parameter(Mandatory)][string]$BootstrapVersion,
    [Parameter(Mandatory)][string]$ReceiptTarget,
    [scriptblock]$Activate,
    [hashtable]$ReceiptExtra
  )

  # --- 1. Validate every source up front (fail closed, touch nothing). -------
  foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath $file.Source -PathType Leaf)) {
      throw "The '$Label' payload is incomplete; missing source: $($file.Source). No changes were made."
    }
  }

  $txnRoot = Join-Path $HermesHome ".business-bootstrap-txn\$Label-$([guid]::NewGuid().ToString('N').Substring(0,12))"
  $stageDir = Join-Path $txnRoot 'stage'
  $backupDir = Join-Path $txnRoot 'backup'
  New-Item -ItemType Directory -Force -Path $stageDir, $backupDir | Out-Null

  # --- 2. Stage: copy sources aside and re-hash to catch a bad staging copy. --
  $index = 0
  $plan = @()
  foreach ($file in $Files) {
    $sourceHash = Get-Sha256Hash -Path $file.Source
    $staged = Join-Path $stageDir ("{0:d3}-{1}" -f $index, (Split-Path -Leaf $file.Target))
    Copy-Atomic -Source $file.Source -Target $staged
    if ((Get-Sha256Hash -Path $staged) -ne $sourceHash) {
      Remove-Item -LiteralPath $txnRoot -Recurse -Force -ErrorAction SilentlyContinue
      throw "Staging integrity check failed for $($file.Source). Aborted before touching the install."
    }
    $plan += [pscustomobject]@{
      Staged     = $staged
      Target     = $file.Target
      Sha256     = $sourceHash
      Backup     = $null
      CreatedNew = $false
      Committed  = $false
    }
    $index++
  }

  Write-Step "Committing the '$Label' payload transaction ($($plan.Count) file(s))."
  try {
    # --- 3. Commit: back up existing targets, then replace atomically. -------
    $backupIndex = 0
    foreach ($item in $plan) {
      if (Test-Path -LiteralPath $item.Target -PathType Leaf) {
        $backupPath = Join-Path $backupDir ("{0:d3}-{1}" -f $backupIndex, (Split-Path -Leaf $item.Target))
        Copy-Atomic -Source $item.Target -Target $backupPath
        $item.Backup = $backupPath
      }
      else {
        $item.CreatedNew = $true
      }
      Copy-Atomic -Source $item.Staged -Target $item.Target
      $item.Committed = $true
      $backupIndex++
    }

    # --- 4. Activate (e.g. enable the policy plugin). ------------------------
    if ($Activate) {
      & $Activate
    }
  }
  catch {
    # --- 5. Rollback: restore backups, remove created files, keep receipt. ---
    Write-Step "The '$Label' transaction failed: $($_.Exception.Message). Rolling back to the previous install."
    foreach ($item in $plan) {
      if (-not $item.Committed) { continue }
      try {
        if ($item.Backup) {
          Copy-Atomic -Source $item.Backup -Target $item.Target
        }
        elseif ($item.CreatedNew -and (Test-Path -LiteralPath $item.Target -PathType Leaf)) {
          Remove-Item -LiteralPath $item.Target -Force
        }
      }
      catch {
        Write-Step "Rollback warning for $($item.Target): $($_.Exception.Message)"
      }
    }
    $rollbackReceipt = [ordered]@{
      id                = $Label
      bootstrapVersion  = $BootstrapVersion
      status            = 'rolled-back'
      failedAt          = (Get-Date).ToUniversalTime().ToString('o')
      reason            = [string]$_.Exception.Message
      restoredExisting  = @($plan | Where-Object { $_.Backup } | ForEach-Object { $_.Target })
      removedNew        = @($plan | Where-Object { $_.CreatedNew } | ForEach-Object { $_.Target })
      preservesExistingHermesState = $true
    }
    $rollbackPath = Join-Path (Get-ReceiptDirectory -HermesHome $HermesHome) "$Label-rollback.json"
    $rollbackReceipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $rollbackPath -Encoding UTF8
    Write-Step "Rollback complete. Receipt: $rollbackPath"
    Remove-Item -LiteralPath $txnRoot -Recurse -Force -ErrorAction SilentlyContinue
    throw "The '$Label' payload could not be installed and was rolled back. Your previous install is intact. Cause: $($_.Exception.Message)"
  }

  # --- 6. Completion receipt + cleanup. -------------------------------------
  # NB: a distinct name (not $files) — the [object[]]$Files parameter carries a
  # type-converter attribute that would coerce a reassigned $files back into an
  # array, breaking the string-keyed lookups below.
  $installedFiles = [ordered]@{}
  foreach ($item in $plan) {
    $installedFiles[$item.Target] = (Get-Sha256Hash -Path $item.Target)
  }
  $receipt = [ordered]@{
    id               = $Label
    bootstrapVersion = $BootstrapVersion
    status           = 'installed'
    installedAt      = (Get-Date).ToUniversalTime().ToString('o')
    files            = $installedFiles
    preservesExistingHermesState = $true
  }
  if ($ReceiptExtra) {
    foreach ($key in $ReceiptExtra.Keys) { $receipt[$key] = $ReceiptExtra[$key] }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReceiptTarget) | Out-Null
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReceiptTarget -Encoding UTF8
  Remove-Item -LiteralPath $txnRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-Step "The '$Label' payload was installed. Receipt: $ReceiptTarget"
  return $ReceiptTarget
}
