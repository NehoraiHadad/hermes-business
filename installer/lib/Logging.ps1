# Logging.ps1 — single source of truth for bootstrap progress logging.
#
# Every module and the top-level bootstrap emit progress through Write-Step so
# that the on-disk install log and the console stay identical. The log path is
# initialised once via Initialize-BootstrapLog; Write-Step degrades gracefully
# to console-only output when logging has not been initialised yet (which keeps
# the helpers unit-testable in isolation).

$script:BootstrapLogPath = $null

function Initialize-BootstrapLog {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string]$Directory
  )
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $script:BootstrapLogPath = Join-Path $Directory 'install.log'
  return $script:BootstrapLogPath
}

function Get-BootstrapLogPath {
  return $script:BootstrapLogPath
}

function Write-Step {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string]$Message
  )
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  if ($script:BootstrapLogPath) {
    # Never let a locked/unavailable log file abort the install itself.
    try {
      Add-Content -LiteralPath $script:BootstrapLogPath -Value $line -Encoding UTF8 -ErrorAction Stop
    }
    catch {
      Write-Host "[warn] Unable to append to install log: $($_.Exception.Message)"
    }
  }
}
