# business-install.tests.ps1 — the install door (Install-BusinessPayload) under
# the REAL host that ships it: scripts/test-bootstrap-lib.ps1 runs this suite in
# Windows PowerShell 5.1, whose bare Get-Content decodes BOM-less UTF-8 as ANSI.
# That host difference mojibake'd the installed Hebrew community skills (and
# pushed their routing descriptions past the 60-char budget, so they never
# routed) while every JS-side test stayed green — so this suite asserts on the
# INSTALLED BYTES, not on the sources. Dot-sourced by test-bootstrap-lib.ps1 and
# uses its shared Test-Case / Assert-True harness.
#
# NB: this .ps1 stays pure ASCII (PS 5.1 decodes BOM-less scripts as ANSI, which
# would mangle literals) — every Hebrew expectation is READ from the shipped
# templates with the explicit UTF-8 helper, never typed here.

function New-BusinessInstallFixture {
  # Stages a COMPLETE payload (plugin + three byte-copied skills + community
  # tooling incl. the bundled node deps, exactly like the shipping doors), a
  # fake no-op hermes.exe for the activate step, and an empty HERMES_HOME
  # seeded with a minimal owner config.yaml.
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Directory
  )
  $payloadRoot = Join-Path $Directory 'payload'
  $hermesHome = Join-Path $Directory 'home'
  New-Item -ItemType Directory -Force -Path $payloadRoot, $hermesHome | Out-Null

  Copy-Item -LiteralPath (Join-Path $Root 'hermes-plugin\business-shell\plugin.js') `
    -Destination (Join-Path $payloadRoot 'plugin.js')
  Copy-Item -LiteralPath (Join-Path $Root 'hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md') `
    -Destination (Join-Path $payloadRoot 'business-bootstrap.SKILL.md')
  Copy-Item -LiteralPath (Join-Path $Root 'hermes-plugin\business-shell\skills\tachles-welcome\SKILL.md') `
    -Destination (Join-Path $payloadRoot 'tachles-welcome.SKILL.md')
  Copy-Item -LiteralPath (Join-Path $Root 'hermes-plugin\business-partner\SKILL.md') `
    -Destination (Join-Path $payloadRoot 'business-partner.SKILL.md')

  $communityPayload = Join-Path $payloadRoot 'community'
  New-Item -ItemType Directory -Force -Path `
    (Join-Path $communityPayload 'scripts\lib'), `
    (Join-Path $communityPayload 'assets'), `
    (Join-Path $communityPayload 'hermes-plugin'), `
    (Join-Path $communityPayload 'node_modules') | Out-Null
  Copy-Item -LiteralPath (Join-Path $Root 'scripts\community-generate.mjs') `
    -Destination (Join-Path $communityPayload 'scripts\community-generate.mjs')
  Copy-Item -LiteralPath (Join-Path $Root 'scripts\community-provision.mjs') `
    -Destination (Join-Path $communityPayload 'scripts\community-provision.mjs')
  Copy-Item -LiteralPath (Join-Path $Root 'scripts\lib\community') `
    -Destination (Join-Path $communityPayload 'scripts\lib\community') -Recurse
  Copy-Item -LiteralPath (Join-Path $Root 'assets\community-skills') `
    -Destination (Join-Path $communityPayload 'assets\community-skills') -Recurse
  Copy-Item -LiteralPath (Join-Path $Root 'hermes-plugin\community-archive') `
    -Destination (Join-Path $communityPayload 'hermes-plugin\community-archive') -Recurse
  Copy-Item -LiteralPath (Join-Path $Root 'node_modules\js-yaml') `
    -Destination (Join-Path $communityPayload 'node_modules\js-yaml') -Recurse
  Copy-Item -LiteralPath (Join-Path $Root 'node_modules\argparse') `
    -Destination (Join-Path $communityPayload 'node_modules\argparse') -Recurse

  $fakeHermes = Join-Path $Directory 'hermes.cmd'
  Set-Content -LiteralPath $fakeHermes -Value "@echo off`r`nexit /b 0" -Encoding Ascii

  # Minimal pre-existing owner config: makes the home a real HERMES_HOME (the
  # generator refuses a non-empty directory without config.yaml) and doubles as
  # the additive-merge control.
  Set-Content -LiteralPath (Join-Path $hermesHome 'config.yaml') `
    -Value "model:`n  provider: anthropic`n  name: claude-opus-5" -Encoding Ascii

  return [pscustomobject]@{
    PayloadRoot = $payloadRoot
    HermesHome  = $hermesHome
    HermesExe   = $fakeHermes
  }
}

function Get-SkillDescription {
  # Extracts the frontmatter `description:` value (quotes stripped) from a
  # SKILL.md text.
  param([Parameter(Mandatory)][string]$Text)
  $match = [regex]::Match($Text, '(?m)^description:\s*(.+?)\s*$')
  if (-not $match.Success) { throw 'SKILL.md has no frontmatter description line' }
  return $match.Groups[1].Value.Trim('"', "'")
}

function Invoke-BusinessInstallTests {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$WorkRoot
  )
  Write-Host 'Business install door (real PS host, installed bytes):'

  $fixtureRoot = Join-Path $WorkRoot 'business-install'
  $fixture = New-BusinessInstallFixture -Root $Root -Directory $fixtureRoot
  $installHome = $fixture.HermesHome

  # Legacy-path seed: an earlier installer left copies under skills\community\,
  # plus one unrelated file that must survive the prune.
  foreach ($legacy in @('community-bootstrap', 'community-admin')) {
    $legacyDir = Join-Path $installHome "skills\community\$legacy"
    New-Item -ItemType Directory -Force -Path $legacyDir | Out-Null
    Set-Content -LiteralPath (Join-Path $legacyDir 'SKILL.md') -Value 'stale legacy copy' -Encoding Ascii
  }
  Set-Content -LiteralPath (Join-Path $installHome 'skills\community\unrelated.txt') -Value 'keep me' -Encoding Ascii

  Test-Case 'install door commits the complete payload with a no-op activate' {
    Install-BusinessPayload -HermesExe $fixture.HermesExe -PayloadRoot $fixture.PayloadRoot `
      -HermesHome $installHome -BootstrapVersion '0.0.0-test' | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $installHome 'desktop-plugins\business-shell\plugin.js') -PathType Leaf) 'plugin.js not installed'
    Assert-True (Test-Path -LiteralPath (Join-Path $installHome 'desktop-plugins\business-shell\install-receipt.json') -PathType Leaf) 'install receipt missing'
  }

  Test-Case 'byte-copied skills install byte-identical to their sources' {
    $pairs = @(
      @{ Source = 'hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md'; Target = 'skills\productivity\business-bootstrap\SKILL.md' },
      @{ Source = 'hermes-plugin\business-shell\skills\tachles-welcome\SKILL.md';    Target = 'skills\productivity\tachles-welcome\SKILL.md' },
      @{ Source = 'hermes-plugin\business-partner\SKILL.md';                          Target = 'skills\business\business-partner\SKILL.md' }
    )
    foreach ($pair in $pairs) {
      $sourceHash = Get-Sha256Hash -Path (Join-Path $Root $pair.Source)
      $installedHash = Get-Sha256Hash -Path (Join-Path $installHome $pair.Target)
      Assert-True ($sourceHash -eq $installedHash) "installed bytes differ from source for $($pair.Target)"
    }
  }

  Test-Case 'rendered community skills land at the canonical generator path only' {
    foreach ($name in @('community-bootstrap', 'community-admin')) {
      Assert-True (Test-Path -LiteralPath (Join-Path $installHome "skills\$name\SKILL.md") -PathType Leaf) "skills\$name\SKILL.md missing"
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $installHome "skills\community\$name\SKILL.md"))) "legacy skills\community\$name copy present"
    }
  }

  Test-Case 'legacy skills\community copies are pruned; unrelated content survives' {
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installHome 'skills\community\community-bootstrap'))) 'legacy community-bootstrap dir not pruned'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installHome 'skills\community\community-admin'))) 'legacy community-admin dir not pruned'
    Assert-True (Test-Path -LiteralPath (Join-Path $installHome 'skills\community\unrelated.txt') -PathType Leaf) 'unrelated file was deleted by the prune'
  }

  Test-Case 'installed Hebrew is intact under PS 5.1 (description matches the template exactly)' {
    foreach ($name in @('community-bootstrap', 'community-admin')) {
      $template = Read-Utf8File -Path (Join-Path $Root "assets\community-skills\$name\SKILL.md")
      $installed = Read-Utf8File -Path (Join-Path $installHome "skills\$name\SKILL.md")
      $expected = Get-SkillDescription -Text $template
      $actual = Get-SkillDescription -Text $installed
      Assert-True ($expected -eq $actual) "$name description bytes changed in install (mojibake?): '$actual'"
      # 0x00D7 is the ANSI-mojibake lead byte artifact and never legitimate text here.
      Assert-True (-not $installed.Contains([string][char]0x00D7)) "$name contains the mojibake marker U+00D7"
      Assert-True (-not ($installed -match '\{\{[A-Z_]+\}\}')) "$name still contains an unresolved placeholder"
      Assert-True ($installed.Contains($installHome)) "$name does not reference the deployment home"
    }
  }

  Test-Case 'installed routing descriptions stay within the 60-char budget' {
    foreach ($name in @('community-bootstrap', 'community-admin')) {
      $description = Get-SkillDescription -Text (Read-Utf8File -Path (Join-Path $installHome "skills\$name\SKILL.md"))
      Assert-True ($description.Length -le 60) "$name installed description is $($description.Length) chars (over the routing budget)"
    }
  }

  Test-Case 'generator parity: contract apply leaves the installed skills byte-identical' {
    $node = Get-Command node -ErrorAction SilentlyContinue
    Assert-True ($null -ne $node) 'node is required for the generator-parity check'
    # ASCII-only contract so this file needs no non-ASCII literals.
    $contractPath = Join-Path $installHome 'tachles\community.yaml'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $contractPath) | Out-Null
    $contract = @(
      'community:',
      '  name: "Test Community"',
      '  wake_word: "hermes"',
      '  dms: admins',
      'admins:',
      '  - "972500000001"',
      'groups:',
      '  - slug: trial',
      '    jid: "120363000000000001@g.us"',
      '    name: "Trial"',
      '    purpose: "test group"'
    ) -join "`n"
    Set-Content -LiteralPath $contractPath -Value $contract -Encoding Ascii

    $before = @{}
    foreach ($name in @('community-bootstrap', 'community-admin')) {
      $before[$name] = Get-Sha256Hash -Path (Join-Path $installHome "skills\$name\SKILL.md")
    }
    # Run the INSTALLED generate CLI (the exact deployment flow the admin skill
    # instructs) — its deployPaths must resolve to the same values the door
    # baked in, or these hashes move.
    $generateCli = Join-Path $installHome 'tachles\community\scripts\community-generate.mjs'
    $output = & $node.Source $generateCli generate --contract $contractPath --home $installHome 2>&1 | Out-String
    Assert-True ($LASTEXITCODE -eq 0) "installed generate CLI failed:`n$output"
    foreach ($name in @('community-bootstrap', 'community-admin')) {
      $after = Get-Sha256Hash -Path (Join-Path $installHome "skills\$name\SKILL.md")
      Assert-True ($before[$name] -eq $after) "$name was rewritten by the generator (installer render is not byte-identical)"
    }
    $output = & $node.Source $generateCli verify --contract $contractPath --home $installHome 2>&1 | Out-String
    Assert-True ($LASTEXITCODE -eq 0) "generator verify reports drift after install+apply:`n$output"
  }
}
