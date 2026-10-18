# Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords.
# A warning must not abort installation under ErrorActionPreference=Stop.
# Keep streams separate and let each caller interpret the actual exit code.
function Invoke-NativeCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @()
  )
  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "Native command is missing: $FilePath"
  }
  $stderrPath = [System.IO.Path]::GetTempFileName()
  try {
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $global:LASTEXITCODE = $null
    $stdout = (& $FilePath @Arguments 2> $stderrPath | Out-String).Trim()
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { throw "Native command did not return an exit code: $FilePath" }
    return [pscustomobject]@{
      ExitCode = $exitCode
      Stdout = $stdout
      Stderr = (Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue)
    }
  }
  finally {
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  }
}
