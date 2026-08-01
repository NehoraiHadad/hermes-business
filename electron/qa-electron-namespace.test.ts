import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { qaElectronNamespace } from './qa-electron-namespace.cjs'

// Regression coverage for the incident root cause: an Electron single-instance /
// userData collision that forwarded a QA packaged launch to the already-running
// LIVE companion (which holds the default-userData single-instance lock), so the
// QA approval run reached the live gateway on the default port.
//
// Electron keys its single-instance lock on the userData directory. The fix is
// to give a QA launch its OWN userData — under the throwaway HERMES_HOME — set
// BEFORE requestSingleInstanceLock(). These tests pin that the QA namespace is
// disjoint from the live/default one (so no collision is possible) and that
// production is untouched.

const tempHome = path.join(os.tmpdir(), 'hermes-qa-home-collision-fixture')
const liveDefaultUserData = path.join(
  process.env.APPDATA || 'C:\\Users\\x\\AppData\\Roaming',
  'העוזר לעסק'
)
const liveHermesHome = path.join(
  process.env.LOCALAPPDATA || 'C:\\Users\\x\\AppData\\Local',
  'hermes'
)

function norm(p: string) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
}
function isUnder(child: string, parent: string) {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + path.sep.toLowerCase())
}

describe('qaElectronNamespace — production path', () => {
  it('returns the default namespace (null userData) when the override is disabled', () => {
    expect(qaElectronNamespace({ enabled: false })).toEqual({ isolated: false, userData: null })
    expect(qaElectronNamespace(undefined as never)).toEqual({ isolated: false, userData: null })
    // Enabled but without a home is treated as not isolated (fail-safe).
    expect(qaElectronNamespace({ enabled: true } as never)).toEqual({ isolated: false, userData: null })
  })
})

describe('qaElectronNamespace — QA isolation defeats the single-instance collision', () => {
  const ns = qaElectronNamespace({ enabled: true, hermesHome: tempHome })

  it('roots the QA userData under the throwaway temp HERMES_HOME', () => {
    expect(ns.isolated).toBe(true)
    expect(isUnder(ns.userData as string, tempHome)).toBe(true)
  })

  it('is DISJOINT from the live/default userData that the running companion locks on', () => {
    // The core guarantee: different userData → different single-instance lock key
    // → the live instance can never intercept/forward the QA launch.
    expect(norm(ns.userData as string)).not.toBe(norm(liveDefaultUserData))
    expect(isUnder(ns.userData as string, liveDefaultUserData)).toBe(false)
  })

  it('never resolves into the live HERMES_HOME profile', () => {
    expect(isUnder(ns.userData as string, liveHermesHome)).toBe(false)
  })

  it('is stable for the same temp home (a relaunch reuses the same private namespace)', () => {
    const again = qaElectronNamespace({ enabled: true, hermesHome: tempHome })
    expect(norm(again.userData as string)).toBe(norm(ns.userData as string))
  })

  it('differs per temp home (two isolated runs never share a lock namespace)', () => {
    const other = qaElectronNamespace({ enabled: true, hermesHome: tempHome + '-2' })
    expect(norm(other.userData as string)).not.toBe(norm(ns.userData as string))
  })
})
