# Minimum capability baseline; newest stable SemVer release selection.
function Invoke-VersionGateTests {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'Version gate:'
  Test-Case 'new future versions pass without a Tachles update' {
    Assert-CompatibleVersion -Version ([version]'1.0.0') -Minimum ([version]'0.22.2')
    Assert-CompatibleVersion -Version ([version]'0.22.2') -Minimum ([version]'0.22.2')
    Assert-True (-not (Test-HermesVersionCompatible -Version ([version]'0.22.1') -Minimum ([version]'0.22.2'))) 'minimum was ignored'
  }
  Test-Case 'latest stable excludes CalVer, draft and prerelease identities' {
    $releases = @(
      [pscustomobject]@{ tag_name='v2026.10.18'; published_at='2026-10-18T00:00:00Z'; draft=$false; prerelease=$false },
      [pscustomobject]@{ tag_name='v1.0.0'; published_at='2026-10-17T00:00:00Z'; draft=$true; prerelease=$false },
      [pscustomobject]@{ tag_name='v0.24.0-rc.1'; published_at='2026-10-16T00:00:00Z'; draft=$false; prerelease=$true },
      [pscustomobject]@{ tag_name='v0.23.0'; name='Stable'; published_at='2026-10-15T00:00:00Z'; draft=$false; prerelease=$false },
      [pscustomobject]@{ tag_name='v0.22.2'; name='Previous'; published_at='2026-10-14T00:00:00Z'; draft=$false; prerelease=$false }
    )
    $selected = Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.22.2')
    Assert-True ($selected.version -eq '0.23.0') 'did not select latest official stable'
  }
  Test-Case 'never silently falls back to an older release' {
    $releases = @(
      [pscustomobject]@{ tag_name='v0.20.1'; name='Latest'; published_at='2026-10-15T00:00:00Z'; draft=$false; prerelease=$false },
      [pscustomobject]@{ tag_name='v0.22.2'; name='Older'; published_at='2026-10-14T00:00:00Z'; draft=$false; prerelease=$false }
    )
    $threw = $false
    try { Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.22.2') | Out-Null } catch { $threw = $true }
    Assert-True $threw 'selected an older release instead of failing'
  }
  # Opt-in GitHub Authorization. Resolve-LatestCompatibleRelease is a 1+N caller
  # (release list, then one source read per candidate tag), so the anonymous
  # 60/hr-per-IP budget is what flakes on a shared runner; a token buys 1000/hr.
  # Both halves of that bargain are pinned here: the token is used when present,
  # and an end user - who has none - keeps the exact headers we always sent.
  # Every case saves and restores BOTH variables so the suite leaks no state,
  # and no assertion message ever interpolates a token value.
  $restoreToken = {
    param([string]$Name, $Value)
    # SetEnvironmentVariable(...,'Process') is the $env: drive itself, and it
    # deletes on $null/empty - which Set-Item cannot express.
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  }

  Test-Case 'no token in the environment leaves the API headers unchanged' {
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' $null
      & $restoreToken 'GH_TOKEN' $null
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      Assert-True ($headers.Count -eq 2) "expected exactly the 2 original headers, got: $(($headers.Keys | Sort-Object) -join ', ')"
      Assert-True ($headers['User-Agent'] -eq 'gate-test') 'the User-Agent header changed for a tokenless caller'
      Assert-True ($headers['Accept'] -eq 'application/vnd.github+json') 'the Accept header changed for a tokenless caller'
      Assert-True (-not $headers.ContainsKey('Authorization')) 'an Authorization header was sent with no token present'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'GITHUB_TOKEN adds a Bearer Authorization header' {
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' 'primary-token'
      & $restoreToken 'GH_TOKEN' 'fallback-token'
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      # GITHUB_TOKEN wins: it is what Actions injects, so a developer machine
      # with a stale gh login cannot override what CI deliberately passed.
      Assert-True ($headers['Authorization'] -eq 'Bearer primary-token') 'GITHUB_TOKEN did not produce the expected Bearer header'
      Assert-True ($headers.Count -eq 3) 'the token path changed more than the Authorization header'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'GH_TOKEN is the fallback when GITHUB_TOKEN is absent' {
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' $null
      & $restoreToken 'GH_TOKEN' 'fallback-token'
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      Assert-True ($headers['Authorization'] -eq 'Bearer fallback-token') 'GH_TOKEN was not used as the fallback token source'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'a whitespace-only token counts as absent, never as `Bearer `' {
    # An empty `env:` entry in a workflow is the realistic source of this. Sending
    # a bare Bearer would turn a working anonymous request into a hard 401.
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' "  `t "
      & $restoreToken 'GH_TOKEN' '   '
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      Assert-True (-not $headers.ContainsKey('Authorization')) 'a whitespace-only token produced an Authorization header'
      Assert-True ($headers.Count -eq 2) 'a whitespace-only token changed the tokenless header set'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'no caller ever logs the API headers' {
    # The token only stays a secret while nothing prints the hashtable that holds
    # it. Assert that at the seam, not by eye: every module that receives
    # -Headers must keep it out of Write-Step/Write-Host/Write-Output.
    foreach ($module in @('ReleaseSelection.ps1', 'ReleaseAcquisition.ps1', 'VerifyMode.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1')) {
      $text = Get-Content -Raw -LiteralPath (Join-Path $Root "installer\lib\$module")
      Assert-True (-not ($text -match '(?i)Write-(Step|Host|Output|Warning)[^\r\n]*\$(Headers|headers|token|Token)\b')) `
        "a logging call in $module interpolates the request headers or a token"
    }
  }
}
