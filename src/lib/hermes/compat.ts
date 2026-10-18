import policy from '../../../hermes-compat.json'

// A minimum baseline, with no ceiling on future official Hermes releases.
export const HERMES_MIN_VERSION = policy.minVersion
export const HERMES_COMPAT_RANGE = policy.range

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
  return compare(version, min) >= 0
}

// Hebrew, truthful copy for an unsupported runtime — no claim of an action we
// will not take.
export function describeUnsupported(text: string | null | undefined): string {
  const version = parseVersion(text)
  const shown = version ? `${version.major}.${version.minor}.${version.patch}` : 'לא ידועה'
  return `גרסת Hermes (${shown}) אינה נתמכת. נדרשת גרסה בטווח ${HERMES_COMPAT_RANGE}. לא בוצע עדכון אוטומטי.`
}
