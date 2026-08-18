# external-gate.ps1 — the EXTERNAL-vs-OUR-BUG boundary for verify-bootstrap.ps1's
# live release probe, plus the child-process runner that boundary depends on.
# Extracted from verify-bootstrap.ps1 so the classification is unit-testable
# offline (scripts/lib/tests/external-gate.tests.ps1) instead of only observable
# on a bad network day.
#
# WHY this exists as its own file (CI run 32149075429):
#   The probe used to run the child as `& $pwsh ... 2>&1`. In Windows PowerShell
#   5.1, `2>&1` on a NATIVE command wraps every stderr LINE in its own
#   NativeCommandError record; under $ErrorActionPreference = 'Stop' the FIRST
#   such record terminates the pipeline immediately. So the assignment threw, the
#   following `if ($LASTEXITCODE -ne 0) { throw (... -join ...) }` never ran, and
#   the catch saw only ONE console-wrapped fragment:
#       "...bootstrap.ps1 : Failed to complete the GitHub release list after 1 "
#   The distinguishing keyword ("403", "rate limit") sat in the NEXT fragment, so
#   a plain upstream rate limit reddened CI as if our selection logic were broken.
#
# The fix has three parts, all here:
#   1. Invoke-ProbeProcess drives System.Diagnostics.Process directly, so no
#      NativeCommandError is ever synthesised and the real exit code is read.
#   2. ConvertTo-SingleLineText joins EVERY captured line and collapses runs of
#      whitespace, so a console wrap - even one that splits "rate limit" across
#      two lines - cannot hide the keyword. A wrap column is not a contract, so
#      the classifier must never depend on where it falls.
#   3. Test-ExternalGate classifies that COMPLETE text, and is applied ONLY to a
#      failing CHILD PROCESS. The verifier's own assertions (wrong version, no
#      tag, bad hash, undersized blob) are thrown by verify-bootstrap itself and
#      deliberately bypass this function, so a real defect can never be swallowed
#      no matter what the child happened to print.
#
# Depends on: nothing (deliberately standalone so the test suite can load it
# without the installer library).

function ConvertTo-SingleLineText {
  # Flattens captured process output into one whitespace-normalised line. The
  # normalisation is the point: PowerShell's error formatter wraps at word
  # boundaries with continuation indentation, so "...rate\n    limit..." must
  # still read as "rate limit" to the classifier.
  [CmdletBinding()]
  param([AllowNull()][string[]]$Lines)
  if (-not $Lines) { return '' }
  return ((($Lines -join ' ') -replace '\s+', ' ').Trim())
}

function Invoke-ProbeProcess {
  # Runs a child process and returns its REAL exit code plus its complete output,
  # with stdout kept separate (callers parse a JSON line out of it).
  #
  # Uses System.Diagnostics.Process directly rather than `& native ... 2>&1`,
  # for two reasons that both bit us:
  #   * `2>&1` on a NATIVE command makes Windows PowerShell 5.1 wrap each stderr
  #     line in a NativeCommandError; under ErrorActionPreference = 'Stop' the
  #     first one terminates the pipeline BEFORE the exit code is ever read.
  #   * `Start-Process -PassThru` (even followed by WaitForExit) hands back a
  #     Process whose ExitCode can be $null, which would silently turn "exit 0"
  #     into "not zero" and fail every healthy run.
  # Both streams are drained ASYNCHRONOUSLY before WaitForExit, so a child that
  # fills one pipe buffer cannot deadlock the verifier.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$ArgumentList
  )
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = ($ArgumentList -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    $process.Start() | Out-Null
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = [string]$stdoutTask.Result
    $stderr = [string]$stderrTask.Result
    $exitCode = $process.ExitCode
  }
  finally {
    $process.Dispose()
  }

  $splitter = [string[]]@("`r`n", "`n")
  $outLines = @($stdout.Split($splitter, [System.StringSplitOptions]::RemoveEmptyEntries))
  $errLines = @($stderr.Split($splitter, [System.StringSplitOptions]::RemoveEmptyEntries))

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output   = $outLines
    Error    = $errLines
    # BOTH streams: a failing child may explain itself on either one, and the
    # classifier must never see only a fragment of the story.
    Text     = ConvertTo-SingleLineText -Lines @($outLines + $errLines)
  }
}

function Test-ExternalGate {
  # Reachability / rate-limit / upstream-range drift are EXTERNAL conditions, not
  # defects in our selection logic (which the offline deterministic gate proved).
  #
  # MUST be fed the COMPLETE, whitespace-normalised child output
  # (Invoke-ProbeProcess .Text). Feeding it one wrapped fragment is precisely the
  # bug this module was written to kill.
  #
  # Fails CLOSED: empty/whitespace input is NOT an external condition, so a child
  # that dies silently still reddens the build instead of being waved through.
  [CmdletBinding()]
  param([AllowNull()][string]$Message)
  if ([string]::IsNullOrWhiteSpace($Message)) { return $false }
  return ($Message -match '(?i)unable to connect|could not|connection|timed out|timeout|network|resolve host|host name|SSL|TLS|403|429|rate limit|No compatible official Hermes release')
}
