# Release.ps1 — stable public FACADE for choosing and fetching the official,
# tagged Hermes release. This bootstrap NEVER bundles Hermes: it either detects
# an existing compatible install or downloads the newest official tagged release
# inside the tested version range and runs the official installer verbatim.
#
# The implementation is split into cohesive modules so no single file grows
# without bound: ReleaseSelection.ps1 (which release to install) and
# ReleaseAcquisition.ps1 (fetch/verify the immutable installer blob and run it).
# Every existing loader (bootstrap.ps1, the unit-test runner, e2e fixtures) keeps
# dot-sourcing THIS one stable name; the facade transitively loads the parts.
#
# Splitting must NOT let a packaged install silently omit a part: this loader
# FAILS CLOSED when a part is missing, and the packaging drift test
# (release-packaging.tests.ps1) proves every name in Get-ReleaseModuleParts is
# File-bundled in business-bootstrap.nsi and parse-gated by the test runner, in
# this load order.
#
# Depends on: Logging.ps1, HttpRetry.ps1, HttpDownload.ps1, Hashing.ps1,
# HermesEnv.ps1 (consumed by the parts below).

function Get-ReleaseModuleParts {
  # The ordered split-implementation modules this facade dot-sources. Exposed as a
  # function so the packaging drift test asserts each is bundled + parse-gated,
  # closing the "packaged install omits a split dependency" gap. Order matters for
  # readability (selection before acquisition); both only define functions.
  return @('ReleaseSelection.ps1', 'ReleaseAcquisition.ps1')
}

foreach ($releasePart in (Get-ReleaseModuleParts)) {
  $releasePartPath = Join-Path $PSScriptRoot $releasePart
  if (-not (Test-Path -LiteralPath $releasePartPath -PathType Leaf)) {
    throw "Required Release module part is missing: $releasePartPath"
  }
  . $releasePartPath
}
