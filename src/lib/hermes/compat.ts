// Reusable Hermes runtime compatibility contract for the desktop shell.
// The companion (plugin + REST/RPC surface) is validated against Hermes
// v0.19.x and v0.20.x, so startup and self-update refuse anything outside
// [0.19.0, 0.21.0). Keep this range in lockstep with
// scripts/plugin-sdk-contract.mjs (HERMES_COMPAT_RANGE) — the canonical source
// used at build time; compat.test.ts asserts they never drift apart.

export const HERMES_MIN_VERSION = '0.19.0'
export const HERMES_MAX_VERSION_EXCLUSIVE = '0.21.0'
export const HERMES_COMPAT_RANGE = `>=${HERMES_MIN_VERSION} <${HERMES_MAX_VERSION_EXCLUSIVE}`

export type Semver = { major: number; minor: number; patch: number }

// Pull the first dotted version out of any `hermes --version` style string,
// e.g. "Hermes Agent v0.19.1 (2026.6.19)" -> {0,19,1}.
export function parseVersion(text: string | null | undefined): Semver | null {
  const match = String(text ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: match[3] ? Number(match[3]) : 0 }
}

function compare(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

export function isVersionSupported(text: string | null | undefined): boolean {
  const version = parseVersion(text)
  if (!version) return false
  const min = parseVersion(HERMES_MIN_VERSION)!
  const maxExclusive = parseVersion(HERMES_MAX_VERSION_EXCLUSIVE)!
  return compare(version, min) >= 0 && compare(version, maxExclusive) < 0
}

// Hebrew, truthful copy for an unsupported runtime — no claim of an action we
// will not take.
export function describeUnsupported(text: string | null | undefined): string {
  const version = parseVersion(text)
  const shown = version ? `${version.major}.${version.minor}.${version.patch}` : 'לא ידועה'
  return `גרסת Hermes (${shown}) אינה נתמכת. נדרשת גרסה בטווח ${HERMES_COMPAT_RANGE}. לא בוצע עדכון אוטומטי.`
}
