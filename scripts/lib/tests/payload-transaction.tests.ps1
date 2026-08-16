# payload-transaction.tests.ps1 — transactional payload commit / rollback /
# pre-commit-validation cases. Dot-sourced by scripts/test-bootstrap-lib.ps1 and
# uses its shared Test-Case / Assert-True harness.

function New-FakePayload {
  param([string]$Directory)
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $plugin = Join-Path $Directory 'plugin.js'
  $skill = Join-Path $Directory 'business-bootstrap.SKILL.md'
  Set-Content -LiteralPath $plugin -Value "// business shell plugin $([guid]::NewGuid())" -Encoding UTF8
  Set-Content -LiteralPath $skill -Value "# Business bootstrap skill $([guid]::NewGuid())" -Encoding UTF8
  return [pscustomobject]@{ Plugin = $plugin; Skill = $skill }
}

function Invoke-PayloadTransactionTests {
  param([Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'Payload transaction:'

  # --- Hebrew + spaces HERMES_HOME commit. -----------------------------------
  Test-Case 'commits payload into a Hebrew + spaces HERMES_HOME' {
    # Build the Hebrew "בדיקת הרמס 123" from code points so this .ps1 stays ASCII
    # (Windows PowerShell 5.1 decodes BOM-less scripts as ANSI, mangling literals).
    $hebrewName = -join ([int[]](0x05D1, 0x05D3, 0x05D9, 0x05E7, 0x05EA, 0x20, 0x05D4, 0x05E8, 0x05DE, 0x05E1, 0x20, 0x31, 0x32, 0x33) | ForEach-Object { [char]$_ })
    $hermesHome = Join-Path $WorkRoot $hebrewName
    New-Item -ItemType Directory -Force -Path $hermesHome | Out-Null
    $payload = New-FakePayload -Directory (Join-Path $WorkRoot 'payload-he')
    $pluginTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
    $skillTarget = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
    $receiptTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
    $files = @(
      @{ Source = $payload.Plugin; Target = $pluginTarget },
      @{ Source = $payload.Skill;  Target = $skillTarget }
    )
    Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files `
      -BootstrapVersion '0.3.3' -ReceiptTarget $receiptTarget | Out-Null
    Assert-True (Test-Path -LiteralPath $pluginTarget -PathType Leaf) 'plugin not committed into unicode home'
    Assert-True (Test-Path -LiteralPath $skillTarget -PathType Leaf) 'skill not committed into unicode home'
    Assert-True (Test-Path -LiteralPath $receiptTarget -PathType Leaf) 'completion receipt missing'
    $receipt = Get-Content -Raw -LiteralPath $receiptTarget | ConvertFrom-Json
    Assert-True ($receipt.status -eq 'installed') 'receipt status not installed'
    $installedHash = Get-Sha256Hash -Path $pluginTarget
    $sourceHash = Get-Sha256Hash -Path $payload.Plugin
    Assert-True ($installedHash -eq $sourceHash) 'installed plugin hash differs from source'
  }

  # --- Interrupted stage / activation failure preserves previous install. ----
  Test-Case 'activation failure rolls back and preserves the previous install' {
    $hermesHome = Join-Path $WorkRoot 'rollback home'
    $pluginTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
    $skillTarget = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
    $receiptTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
    # Seed a PREVIOUS install of the plugin only.
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginTarget) | Out-Null
    Set-Content -LiteralPath $pluginTarget -Value 'PREVIOUS-INSTALL' -Encoding UTF8
    $payload = New-FakePayload -Directory (Join-Path $WorkRoot 'payload-rb')
    $files = @(
      @{ Source = $payload.Plugin; Target = $pluginTarget },
      @{ Source = $payload.Skill;  Target = $skillTarget }
    )
    $threw = $false
    try {
      Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files `
        -BootstrapVersion '0.3.3' -ReceiptTarget $receiptTarget `
        -Activate { throw 'simulated hermes plugins enable failure' } | Out-Null
    }
    catch {
      $threw = $true
      Assert-True ($_.Exception.Message -match 'rolled back|rollback') "unexpected rollback error: $($_.Exception.Message)"
    }
    Assert-True $threw 'activation failure did not raise'
    $restored = Get-Content -Raw -LiteralPath $pluginTarget
    Assert-True ($restored.Trim() -eq 'PREVIOUS-INSTALL') 'previous plugin was not restored on rollback'
    Assert-True (-not (Test-Path -LiteralPath $skillTarget)) 'newly-created skill was not removed on rollback'
    Assert-True (-not (Test-Path -LiteralPath $receiptTarget)) 'a completion receipt was written despite rollback'
    $rollbackReceipt = Join-Path $hermesHome '.business-bootstrap-receipts\business-shell-rollback.json'
    Assert-True (Test-Path -LiteralPath $rollbackReceipt) 'rollback receipt missing'
  }

  # --- Pre-commit validation failure (interrupted stage) touches nothing. ----
  Test-Case 'missing-source validation fails before touching the previous install' {
    $hermesHome = Join-Path $WorkRoot 'validate home'
    $pluginTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
    $skillTarget = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
    $receiptTarget = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginTarget) | Out-Null
    Set-Content -LiteralPath $pluginTarget -Value 'PREVIOUS-INSTALL' -Encoding UTF8
    $payload = New-FakePayload -Directory (Join-Path $WorkRoot 'payload-validate')
    $files = @(
      @{ Source = $payload.Plugin; Target = $pluginTarget },
      @{ Source = (Join-Path $WorkRoot 'does-not-exist.md'); Target = $skillTarget }
    )
    $threw = $false
    try {
      Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files `
        -BootstrapVersion '0.3.3' -ReceiptTarget $receiptTarget | Out-Null
    }
    catch { $threw = $true }
    Assert-True $threw 'a missing source did not fail closed'
    Assert-True ((Get-Content -Raw -LiteralPath $pluginTarget).Trim() -eq 'PREVIOUS-INSTALL') 'previous install was modified before validation passed'
    Assert-True (-not (Test-Path -LiteralPath $receiptTarget)) 'a receipt was written despite validation failure'
  }
}
