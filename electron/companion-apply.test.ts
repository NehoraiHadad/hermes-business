import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import {
  INSTALLER_ARGS,
  applyCompanionUpdate,
  recoverIncompleteCompanionUpdate,
  wasRelaunchedByInstaller
} from './companion-apply.cjs'

// Fully injected DI harness (same style as hermes-update-flow.fixtures.ts): no
// real Electron, no real spawn, no real installer, no real filesystem. `calls`
// records the side-effect ORDER so the shutdown-before-spawn-before-quit
// sequence is asserted, not assumed.

const INSTALLER = path.join(os.tmpdir(), 'tachles', "תכל'ס Setup 0.4.0-alpha.8.exe")
const DIGEST = 'b'.repeat(64)
const CURRENT = '0.4.0-alpha.7'
const TARGET = '0.4.0-alpha.8'
const CMD = 'C:\\Users\\u\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe'

function record(overrides: Record<string, unknown> = {}) {
  return {
    journalVersion: 1,
    phase: 'ready',
    currentVersion: CURRENT,
    targetVersion: TARGET,
    installerPath: INSTALLER,
    installerSha256: DIGEST,
    ...overrides
  }
}

type ApplyOverrides = {
  journal?: unknown
  digest?: string
  digestThrows?: boolean
  exists?: boolean
  journalWriteThrows?: boolean
  journalReadsBackAs?: string
  spawnThrows?: boolean
  stopGatewayThrows?: boolean
  gatewayStateAfter?: string
  command?: string | null
}

function makeApplyDeps(overrides: ApplyOverrides = {}) {
  const calls: string[] = []
  let stored: unknown = 'journal' in overrides ? overrides.journal : record()
  const child = { unref: vi.fn(), on: vi.fn() }
  const spawn = vi.fn(() => {
    calls.push('spawn')
    if (overrides.spawnThrows) throw new Error('ENOENT spawn')
    return child
  })
  const deps = {
    readJournal: vi.fn(() => stored),
    updatePhase: vi.fn((phase: string, _patch: unknown, options: { durable?: boolean } = {}) => {
      calls.push(`journal:${phase}${options.durable ? ':durable' : ''}`)
      if (overrides.journalWriteThrows) throw new Error('EACCES: journal write failed')
      stored = { ...(stored as object), phase: overrides.journalReadsBackAs ?? phase }
      return stored
    }),
    recordFailure: vi.fn((error: Error) => calls.push(`fail:${String(error.message).slice(0, 28)}`)),
    exists: vi.fn(() => overrides.exists !== false),
    digestFile: vi.fn(async () => {
      calls.push('digest')
      if (overrides.digestThrows) throw new Error('EIO read failed')
      return overrides.digest ?? DIGEST
    }),
    spawn,
    resolveCommand: () => (overrides.command === undefined ? CMD : overrides.command),
    stopGateway: vi.fn(async () => {
      calls.push('stopGateway')
      if (overrides.stopGatewayThrows) throw new Error('gateway stop failed')
    }),
    gatewayState: vi.fn(() => {
      calls.push('gatewayState')
      return { state: overrides.gatewayStateAfter ?? 'stopped' }
    }),
    stopForeground: vi.fn(async () => {
      calls.push('stopForeground')
    }),
    app: { quit: vi.fn(() => calls.push('quit')), getVersion: () => CURRENT },
    log: (m: string) => calls.push(`log:${String(m).slice(0, 30)}`)
  }
  return { deps, calls, child, spawn }
}

describe('applyCompanionUpdate — installer handoff', () => {
  it('emits the EXACT argv: /S --updated --force-run /currentuser', async () => {
    const { deps, spawn } = makeApplyDeps()
    const result = await applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)
    expect(result).toMatchObject({ ok: true, launched: true, targetVersion: TARGET })
    const [exe, args] = spawn.mock.calls[0]
    expect(exe).toBe(INSTALLER)
    // All four flags present (order-independent) — each is load-bearing:
    // /S silent, --updated (grace sleep + shortcut preservation + data keep),
    // --force-run (the ONLY relaunch path for an assisted installer),
    // /currentuser SLASH form (no mid-silent-update UAC prompt).
    for (const flag of ['/S', '--updated', '--force-run', '/currentuser']) {
      expect(args).toContain(flag)
    }
    expect(args).toHaveLength(4)
    expect(args).toEqual([...INSTALLER_ARGS])
    expect(result.args).toEqual([...INSTALLER_ARGS])
  })

  it('spawns DETACHED with stdio ignored and unrefs (the installer kills this process)', async () => {
    const { deps, spawn, child } = makeApplyDeps()
    await applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)
    expect(spawn.mock.calls[0][2]).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true })
    expect(child.unref).toHaveBeenCalledTimes(1)
    // An unhandled 'error' event on a detached child would crash us on the way out.
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('orders: digest → durable journal → gateway stop → foreground stop → spawn → quit', async () => {
    const { deps, calls } = makeApplyDeps()
    await applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)
    expect(calls.filter(c => !c.startsWith('log:'))).toEqual([
      'digest',
      'journal:applying:durable',
      'stopGateway',
      'gatewayState',
      'stopForeground',
      'spawn',
      'quit'
    ])
  })

  it('never awaits the installer and never reads an exit code', async () => {
    const { deps, child } = makeApplyDeps()
    await applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)
    // The fake child exposes no exit/stdout surface at all — if the implementation
    // touched one, this test would have thrown rather than resolved.
    expect(Object.keys(child)).toEqual(['unref', 'on'])
  })

  it('TOCTOU: a digest that changed on disk aborts WITHOUT spawning', async () => {
    const { deps, calls, spawn } = makeApplyDeps({ digest: 'c'.repeat(64) })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /השתנה מאז האימות/
    )
    expect(spawn).not.toHaveBeenCalled()
    expect(calls).not.toContain('stopGateway')
    expect(deps.recordFailure).toHaveBeenCalled()
  })

  it('aborts without spawning when the installer vanished between verify and apply', async () => {
    const { deps, spawn } = makeApplyDeps({ exists: false })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /נמחק/
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('aborts without spawning when the installer cannot be read', async () => {
    const { deps, spawn } = makeApplyDeps({ digestThrows: true })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /לא ניתן לקרוא/
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('a failed journal write aborts WITHOUT spawning or stopping anything (unjournalled = unrecoverable)', async () => {
    const { deps, calls, spawn } = makeApplyDeps({ journalWriteThrows: true })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /לא ניתן לשמור את רישום העדכון/
    )
    expect(spawn).not.toHaveBeenCalled()
    expect(calls).not.toContain('stopGateway')
    expect(calls).not.toContain('stopForeground')
  })

  it('a journal that does not READ BACK as applying is treated as a failed write', async () => {
    // safeWrite succeeded but the record is not durably observable — same abort.
    const { deps, spawn } = makeApplyDeps({ journalReadsBackAs: 'ready' })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /לא ניתן לשמור את רישום העדכון/
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses to launch when there is no journal at all', async () => {
    const { deps, spawn } = makeApplyDeps({ journal: null })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /לא נמצא רישום עדכון פעיל/
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses to launch on a journal that fails the trust gate (relative installerPath)', async () => {
    const { deps, spawn } = makeApplyDeps({ journal: record({ installerPath: 'setup.exe' }) })
    await expect(applyCompanionUpdate({ installerPath: 'setup.exe', targetVersion: TARGET }, deps)).rejects.toThrow(
      /רישום העדכון פגום \(installer-path-not-absolute\)/
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses when the requested path or version disagrees with the verified record', async () => {
    const a = makeApplyDeps()
    await expect(
      applyCompanionUpdate({ installerPath: path.join(os.tmpdir(), 'other.exe'), targetVersion: TARGET }, a.deps)
    ).rejects.toThrow(/אינו הקובץ שאומת/)
    expect(a.spawn).not.toHaveBeenCalled()

    const b = makeApplyDeps()
    await expect(
      applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: '9.9.9' }, b.deps)
    ).rejects.toThrow(/אינה הגרסה שאומתה/)
    expect(b.spawn).not.toHaveBeenCalled()
  })

  it('matches the verified path case-insensitively on Windows-shaped input', async () => {
    const { deps, spawn } = makeApplyDeps()
    const shouted = process.platform === 'win32' ? INSTALLER.toUpperCase() : INSTALLER
    await applyCompanionUpdate({ installerPath: shouted, targetVersion: TARGET }, deps)
    // The path actually LAUNCHED is always the journal's, never the caller's.
    expect(spawn.mock.calls[0][0]).toBe(INSTALLER)
  })

  it('still applies when the gateway refuses to stop (already journalled; not a precondition)', async () => {
    const { deps, calls, spawn } = makeApplyDeps({ stopGatewayThrows: true, gatewayStateAfter: 'running' })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).resolves.toMatchObject(
      { ok: true }
    )
    expect(spawn).toHaveBeenCalled()
    expect(calls.some(c => c.startsWith('log:Gateway'))).toBe(true)
  })

  it('skips the gateway stop (and says so) when Hermes is not installed', async () => {
    const { deps, calls, spawn } = makeApplyDeps({ command: null })
    await applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)
    expect(calls).not.toContain('stopGateway')
    expect(spawn).toHaveBeenCalled()
  })

  it('surfaces a spawn failure honestly (journal already applying → next launch reconciles)', async () => {
    const { deps } = makeApplyDeps({ spawnThrows: true })
    await expect(applyCompanionUpdate({ installerPath: INSTALLER, targetVersion: TARGET }, deps)).rejects.toThrow(
      /הפעלת קובץ ההתקנה נכשלה/
    )
    expect(deps.recordFailure).toHaveBeenCalled()
    expect(deps.app.quit).not.toHaveBeenCalled()
  })
})

// ── Recovery ────────────────────────────────────────────────────────────────

function makeRecoverDeps(rec: unknown, overrides: Record<string, unknown> = {}) {
  return {
    detect: vi.fn(() => rec),
    clear: vi.fn(),
    recordFailure: vi.fn(),
    removeFile: vi.fn(),
    resolveCommand: vi.fn(() => CMD),
    fullHealth: vi.fn(async () => ({ health: { ok: true } })),
    app: { getVersion: () => CURRENT },
    argv: ['electron.exe', '.'],
    log: vi.fn(),
    ...overrides
  }
}

describe('recoverIncompleteCompanionUpdate — out-of-band outcome at the next launch', () => {
  it('is a no-op when there is no journal', async () => {
    const deps = makeRecoverDeps(null)
    await expect(recoverIncompleteCompanionUpdate(deps)).resolves.toEqual({ outcome: 'none' })
    expect(deps.clear).not.toHaveBeenCalled()
    expect(deps.removeFile).not.toHaveBeenCalled()
  })

  for (const phase of ['downloading', 'verifying']) {
    it(`silently discards a partial download in phase "${phase}" (no mutation ever happened)`, async () => {
      const deps = makeRecoverDeps(record({ phase }))
      const result = await recoverIncompleteCompanionUpdate(deps)
      expect(result).toMatchObject({ outcome: 'discarded-partial', resumable: false })
      expect(result.detail).toBeUndefined()
      expect(deps.removeFile).toHaveBeenCalledWith(INSTALLER)
      expect(deps.clear).toHaveBeenCalledWith({ outcome: 'discarded-partial' })
      expect(deps.fullHealth).not.toHaveBeenCalled()
    })
  }

  it('reports a "ready" installer as resumable and NEVER auto-applies it (no consent)', async () => {
    const deps = makeRecoverDeps(record({ phase: 'ready' }))
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'resumable', resumable: true, installerPath: INSTALLER, targetVersion: TARGET })
    expect(deps.removeFile).not.toHaveBeenCalled()
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'ready-not-applied' })
  })

  it('applying + running IS the target + both healths pass ⇒ applied, journal cleared, installer deleted', async () => {
    const deps = makeRecoverDeps(record({ phase: 'applying' }), { app: { getVersion: () => TARGET } })
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'applied', targetVersion: TARGET })
    expect(deps.fullHealth).toHaveBeenCalledWith(CMD)
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'applied' })
    expect(deps.removeFile).toHaveBeenCalledWith(INSTALLER)
  })

  it('applying + right version but the DUAL HEALTH GATE fails ⇒ never "updated successfully"', async () => {
    const deps = makeRecoverDeps(record({ phase: 'applying' }), {
      app: { getVersion: () => TARGET },
      fullHealth: vi.fn(async () => {
        throw new Error('gateway deep probe failed')
      })
    })
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'applied-unhealthy', resumable: false })
    expect(result.detail).toContain('gateway deep probe failed')
    // Journal PRESERVED (unresolved state) and the installer is not deleted.
    expect(deps.clear).not.toHaveBeenCalled()
    expect(deps.removeFile).not.toHaveBeenCalled()
    expect(deps.recordFailure).toHaveBeenCalled()
  })

  it('applying + right version but Hermes missing ⇒ cannot prove health, so not a success', async () => {
    const deps = makeRecoverDeps(record({ phase: 'applying' }), {
      app: { getVersion: () => TARGET },
      resolveCommand: vi.fn(() => null)
    })
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'applied-unhealthy' })
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('applying + STILL the old version ⇒ honest failure naming target + installer, file KEPT', async () => {
    const deps = makeRecoverDeps(record({ phase: 'applying' }))
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'apply-failed', resumable: true, installerPath: INSTALLER })
    // The error string is suitable for patchRuntimeState({ error }).
    expect(result.detail).toContain(TARGET)
    expect(result.detail).toContain(INSTALLER)
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'apply-failed' })
    expect(deps.removeFile).not.toHaveBeenCalled()
    expect(deps.fullHealth).not.toHaveBeenCalled()
  })

  it('applying + a THIRD version ⇒ fail closed, guess nothing, mutate nothing (not even the journal)', async () => {
    const deps = makeRecoverDeps(record({ phase: 'applying' }), { app: { getVersion: () => '0.9.9' } })
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'unexpected-version', resumable: false })
    expect(result.detail).toContain('0.9.9')
    expect(deps.clear).not.toHaveBeenCalled()
    expect(deps.removeFile).not.toHaveBeenCalled()
    expect(deps.recordFailure).toHaveBeenCalled()
  })

  it('an unparseable running version is also unexpected — never guessed into success', async () => {
    const deps = makeRecoverDeps(record({ phase: 'applying' }), { app: { getVersion: () => 'dev' } })
    await expect(recoverIncompleteCompanionUpdate(deps)).resolves.toMatchObject({ outcome: 'unexpected-version' })
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('a MALFORMED record (path already stripped) deletes nothing and clears the useless journal', async () => {
    const deps = makeRecoverDeps({
      ...record({ phase: 'applying' }),
      installerPath: null,
      malformed: true,
      invalidCode: 'unknown-journal-version'
    })
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'malformed', resumable: false })
    expect(deps.removeFile).not.toHaveBeenCalled()
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'malformed' })
  })

  it('a failed delete of the partial download never blocks the clear', async () => {
    const deps = makeRecoverDeps(record({ phase: 'downloading' }), {
      removeFile: vi.fn(() => {
        throw new Error('EBUSY')
      })
    })
    await expect(recoverIncompleteCompanionUpdate(deps)).resolves.toMatchObject({ outcome: 'discarded-partial' })
    expect(deps.clear).toHaveBeenCalled()
  })

  it('NEVER throws into the launch path — an unverifiable clear becomes a structured result', async () => {
    const deps = makeRecoverDeps(record({ phase: 'ready' }), {
      clear: vi.fn(() => {
        throw new Error('Active companion update journal still present after clear')
      })
    })
    const result = await recoverIncompleteCompanionUpdate(deps)
    expect(result).toMatchObject({ outcome: 'recovery-failed' })
    expect(result.detail).toContain('still present after clear')
  })

  it('tolerates the installer-relaunch marker without depending on it', async () => {
    const relaunched = makeRecoverDeps(record({ phase: 'applying' }), {
      app: { getVersion: () => TARGET },
      argv: ['C:\\...\\hermes-business.exe', '--updated']
    })
    await expect(recoverIncompleteCompanionUpdate(relaunched)).resolves.toMatchObject({ outcome: 'applied' })
    // ...and the SAME verdict without it (hand-started app, or a reboot).
    const byHand = makeRecoverDeps(record({ phase: 'applying' }), { app: { getVersion: () => TARGET } })
    await expect(recoverIncompleteCompanionUpdate(byHand)).resolves.toMatchObject({ outcome: 'applied' })
  })
})

describe('wasRelaunchedByInstaller', () => {
  it('detects the --updated argv the installer forwards, and nothing else', () => {
    expect(wasRelaunchedByInstaller(['app.exe', '--updated'])).toBe(true)
    expect(wasRelaunchedByInstaller(['app.exe'])).toBe(false)
    expect(wasRelaunchedByInstaller([])).toBe(false)
    expect(wasRelaunchedByInstaller(null as unknown as string[])).toBe(false)
  })
})
