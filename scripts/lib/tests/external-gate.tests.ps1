# external-gate.tests.ps1 — proves verify-bootstrap.ps1's EXTERNAL-vs-OUR-BUG
# boundary actually works. It exists because that boundary was load-bearing but
# NON-FUNCTIONAL in CI run 32149075429: the probe ran the child as
# `& $pwsh ... 2>&1` under $ErrorActionPreference = 'Stop', so the first stderr
# line became a terminating NativeCommandError, the exit-code check on the next
# line never ran, and the catch classified ONE console-wrapped fragment
# ("...Failed to complete the GitHub release list after 1 ") that no longer
# contained the "403" the gate looks for. A plain upstream rate limit therefore
# reddened CI as though our selection logic were broken.
#
# Dot-sourced by scripts/test-bootstrap-lib.ps1; uses its shared harness
# (Test-Case / Assert-True / Start-MockServer) and the real mock HTTP server.

function Invoke-ExternalGateTests {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'External gate (verify-bootstrap live probe):'

  $gateRoot = Join-Path $WorkRoot 'external-gate'
  New-Item -ItemType Directory -Force -Path $gateRoot | Out-Null
  $libDir = Join-Path $Root 'installer\lib'
  $powershellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

  # Writes a child script that loads the REAL installer library and then does
  # whatever $BodyLines say - so every live case below runs through a genuine
  # child process, its real exit code and its real console-formatted stderr.
  function New-ProbeChild {
    param([string]$Name, [string[]]$BodyLines)
    $path = Join-Path $gateRoot $Name
    $lines = @(
      '$ErrorActionPreference = ''Stop''',
      ('$libDir = ''' + $libDir + ''''),
      'foreach ($m in @(''Logging.ps1'', ''Hashing.ps1'', ''HttpRetry.ps1'', ''HttpDownload.ps1'', ''FileOps.ps1'', ''ZipPolicy.ps1'', ''SafeZip.ps1'', ''HermesEnv.ps1'', ''Release.ps1'')) { . (Join-Path $libDir $m) }'
    ) + $BodyLines
    Set-Content -LiteralPath $path -Value $lines -Encoding ascii
    return $path
  }

  function Invoke-ProbeChild {
    param([string]$Path)
    return Invoke-ProbeProcess -FilePath $powershellExe -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $Path)
    )
  }

  # --- The truncation class itself, reproduced deterministically. ------------
  Test-Case 'the single wrapped fragment CI saw is correctly NOT classifiable' {
    # Verbatim from run 32149075429: this is all the old catch ever received.
    $fragment = 'D:\a\hermes-business-poc\installer\bootstrap.ps1 : Failed to complete the GitHub release list after 1 '
    Assert-True (-not (Test-ExternalGate -Message $fragment)) 'the truncated fragment was classified external - this test no longer reproduces the bug'
  }

  Test-Case 'the COMPLETE wrapped output is classified external (the fix)' {
    $wrapped = @(
      'D:\a\hermes-business-poc\installer\bootstrap.ps1 : Failed to complete the GitHub release list after 1 ',
      'attempt(s): The remote server returned an error: (403) Forbidden.',
      'At D:\a\hermes-business-poc\scripts\verify-bootstrap.ps1:79 char:20'
    )
    $text = ConvertTo-SingleLineText -Lines $wrapped
    Assert-True ($text -match '403') "joining lost the status code: $text"
    Assert-True (Test-ExternalGate -Message $text) "the complete output was not classified external: $text"
  }

  Test-Case 'a wrap that splits the keyword itself still classifies (normalised, not luck)' {
    # A wrap column is NOT a contract, so the classifier must survive one landing
    # in the middle of "rate limit" - which the improved 403 copy makes likely.
    $split = @(
      'bootstrap.ps1 : Failed to complete the GitHub release list after 1 attempt(s): The download server API rate',
      '    limit for this network has been used up, so it refused the request (HTTP 403).'
    )
    $text = ConvertTo-SingleLineText -Lines $split
    Assert-True ($text -match 'rate limit') "whitespace normalisation did not rejoin the split keyword: $text"
    Assert-True (Test-ExternalGate -Message $text) 'a keyword split across a wrap was not classified external'
  }

  Test-Case 'an empty or silent failure fails CLOSED (never swallowed)' {
    Assert-True (-not (Test-ExternalGate -Message '')) 'empty output was classified external'
    Assert-True (-not (Test-ExternalGate -Message '   ')) 'whitespace-only output was classified external'
    Assert-True (-not (Test-ExternalGate -Message $null)) 'null output was classified external'
    Assert-True ((ConvertTo-SingleLineText -Lines $null) -eq '') 'null lines did not flatten to an empty string'
  }

  # --- The boundary: our own defects must NEVER be classified external. ------
  Test-Case 'genuine selection-logic failures are never classified external' {
    foreach ($ourBug in @(
        'Bootstrap selected incompatible Hermes 9.9.9 (supported >=0.17.0 <0.21.0).',
        'Bootstrap selected a release without an immutable tag.',
        'Bootstrap did not return verified Git blob and SHA256 metadata.',
        'Verified official installer was unexpectedly small.')) {
      Assert-True (-not (Test-ExternalGate -Message $ourBug)) "our own defect was classified external: $ourBug"
    }
  }

  # --- Live: a real 403 rate limit through a real child process. -------------
  Test-Case 'a live 403 rate limit exits non-zero and IS classified external' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $gateRoot "stop-gate-ratelimit-$port"
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'ratelimit' -BodyPath ''
    try {
      $child = New-ProbeChild -Name 'probe-ratelimit.ps1' -BodyLines @(
        ('Resolve-LatestCompatibleRelease -Repository ''NousResearch/hermes-agent'' -Minimum ([version]''0.17.0'') -Maximum ([version]''0.21.0'') -Headers @{ ''User-Agent'' = ''gate-test'' } -ApiBase ''http://127.0.0.1:' + $port + '''')
      )
      $probe = Invoke-ProbeChild -Path $child
      # The exit code is now actually CONSULTED - the old pattern threw before it.
      Assert-True ($probe.ExitCode -ne 0) 'the rate-limited child reported success'
      Assert-True ($probe.Error.Count -ge 1) 'no stderr was captured from the failing child'
      Assert-True ($probe.Text -match '403') "the complete output lost the status code: $($probe.Text)"
      Assert-True ($probe.Text -match '(?i)rate limit') "the complete output lost the rate-limit wording: $($probe.Text)"
      Assert-True (Test-ExternalGate -Message $probe.Text) "a live 403 rate limit was not classified external: $($probe.Text)"
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  Test-Case 'a live child that fails for OUR reason exits non-zero and is NOT swallowed' {
    $child = New-ProbeChild -Name 'probe-ourbug.ps1' -BodyLines @(
      'throw ''Bootstrap selected incompatible Hermes 9.9.9 (supported >=0.17.0 <0.21.0).'''
    )
    $probe = Invoke-ProbeChild -Path $child
    Assert-True ($probe.ExitCode -ne 0) 'a throwing child reported success'
    Assert-True ($probe.Text -match 'incompatible Hermes') "the child's own message was lost: $($probe.Text)"
    Assert-True (-not (Test-ExternalGate -Message $probe.Text)) "a selection-logic defect would have been swallowed: $($probe.Text)"
  }

  Test-Case 'a successful child returns exit 0 with stdout kept separate from stderr' {
    $child = New-ProbeChild -Name 'probe-ok.ps1' -BodyLines @(
      '[Console]::Error.WriteLine(''noise on stderr'')',
      'Write-Output ''{"tag":"v2026.7.30","version":"0.19.1"}'''
    )
    $probe = Invoke-ProbeChild -Path $child
    Assert-True ($probe.ExitCode -eq 0) "a healthy child did not exit 0 (exit $($probe.ExitCode))"
    $jsonLine = @($probe.Output | ForEach-Object { [string]$_ } | Where-Object { $_.Trim().StartsWith('{') }) |
      Select-Object -Last 1
    Assert-True ($null -ne $jsonLine) "the JSON line was not recoverable from stdout: $($probe.Output -join '|')"
    Assert-True ((($jsonLine | ConvertFrom-Json).version) -eq '0.19.1') 'the recovered JSON line did not parse'
    Assert-True (-not (@($probe.Output) -match 'noise on stderr')) 'stderr leaked into the stdout the caller parses'
    Assert-True ($probe.Text -match 'noise on stderr') 'stderr was dropped from the classification text'
  }

  # --- Drift guard: the verifier must keep using this seam. ------------------
  Test-Case 'verify-bootstrap.ps1 uses the seam and never merges native stderr again' {
    $text = Get-Content -Raw -LiteralPath (Join-Path $Root 'scripts\verify-bootstrap.ps1')
    Assert-True ($text -match [regex]::Escape('lib\external-gate.ps1')) 'the verifier no longer loads the external-gate module'
    Assert-True ($text -match 'Invoke-ReleaseProbe') 'the verifier no longer routes its probes through the seam'
    # Scoped to an actual INVOCATION line, not the prose that explains the bug:
    # any `$pwsh ... 2>&1` is the exact pattern that truncated the failure.
    Assert-True (-not ($text -match '(?m)^[^#\r\n]*\$pwsh[^\r\n]*2>&1')) 'the verifier reintroduced 2>&1 on a native command (the CI truncation bug)'
    Assert-True (-not ($text -match 'LASTEXITCODE[^\r\n]*\r?\n?[^\r\n]*bootstrap')) 'the verifier went back to reading $LASTEXITCODE after a redirect'
    Assert-True ($text -match 'EXTERNAL-GATE-CONDITION') 'the verifier lost the explicit external-condition marker'
    Assert-True ($text -match 'ExitCode') 'the verifier no longer consults the child exit code'
    # The compat manifest stays single-sourced (the JS drift test guards it too).
    Assert-True ($text -match 'hermes-compat\.json') 'the verifier stopped deriving its range from the manifest'
  }
}
