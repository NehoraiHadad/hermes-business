function ConvertTo-BusinessSemVer {
  param([Parameter(Mandatory)][string]$Value)
  $pattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
  if ($Value -notmatch $pattern) { throw "Invalid companion semantic version '$Value'." }
  $major, $minor, $patch, $preText = [int]$Matches[1], [int]$Matches[2], [int]$Matches[3], $Matches[4]
  $pre = if ($preText) { @($preText -split '\.') } else { @() }
  foreach ($part in $pre) {
    if ($part -match '^\d+$' -and $part.Length -gt 1 -and $part.StartsWith('0')) {
      throw "Invalid numeric prerelease identifier in '$Value'."
    }
  }
  [pscustomobject]@{
    raw = $Value
    core = [version]::new($major, $minor, $patch)
    prerelease = $pre
  }
}

function Compare-BusinessSemVer {
  param([Parameter(Mandatory)]$Left, [Parameter(Mandatory)]$Right)
  $core = $Left.core.CompareTo($Right.core)
  if ($core -ne 0) { return $core }
  $leftPre = @($Left.prerelease)
  $rightPre = @($Right.prerelease)
  if ($leftPre.Count -eq 0 -and $rightPre.Count -eq 0) { return 0 }
  if ($leftPre.Count -eq 0) { return 1 }
  if ($rightPre.Count -eq 0) { return -1 }
  for ($index = 0; $index -lt [Math]::Max($leftPre.Count, $rightPre.Count); $index++) {
    if ($index -ge $leftPre.Count) { return -1 }
    if ($index -ge $rightPre.Count) { return 1 }
    $leftPart, $rightPart = $leftPre[$index], $rightPre[$index]
    # Assigned on SEPARATE lines on purpose. The one-line multiple-assignment form
    # (`$a, $b = $x -match '...', $y -match '...'`) LOOKS equivalent but is not:
    # PowerShell binds the comma tighter than `-match`, so the right-hand side
    # parses as `$x -match @('...', $y) -match '...'` and yielded $leftNumeric=$false
    # with $rightNumeric unset. Both identifiers were therefore never seen as
    # numeric, the BigInteger branch below was dead code, and comparison silently
    # fell through to CompareOrdinal — making '10' sort BELOW '9'. That is invisible
    # while every prerelease is single-digit and becomes a release-blocking bug the
    # moment one is not (alpha.10 read as older than alpha.9, so the installer
    # rejected it as "outside the tested range").
    $leftNumeric = $leftPart -match '^\d+$'
    $rightNumeric = $rightPart -match '^\d+$'
    if ($leftNumeric -and $rightNumeric) {
      $order = [System.Numerics.BigInteger]::Parse($leftPart).CompareTo([System.Numerics.BigInteger]::Parse($rightPart))
    } elseif ($leftNumeric) { $order = -1
    } elseif ($rightNumeric) { $order = 1
    } else { $order = [string]::CompareOrdinal($leftPart, $rightPart) }
    if ($order -ne 0) { return $order }
  }
  return 0
}

function Get-CompanionVersionRange {
  param([Parameter(Mandatory)][string]$BootstrapVersion)
  $minimum = ConvertTo-BusinessSemVer $BootstrapVersion
  $maximum = ConvertTo-BusinessSemVer ("{0}.{1}.0" -f $minimum.core.Major, ($minimum.core.Minor + 1))
  [pscustomobject]@{ minimum = $minimum; maximumExclusive = $maximum }
}
