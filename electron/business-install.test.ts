import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { performInstall } from './business-install.cjs'
import { stageBusinessBootstrap } from './plugin-install.cjs'
import { writePackagedBootstrapPayload } from './business-bootstrap.fixtures'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-install-door-'))
  roots.push(root)
  return root
}

function relativeFiles(root: string) {
  const found: string[] = []
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(full)
      else found.push(path.relative(root, full).replaceAll('\\', '/'))
    }
  }
  visit(root)
  return found.sort()
}

const HOME = path.join('C:', 'qa', 'hermes-home')

type Call = { command: string; args: string[]; payloadRoot: string; payload: string[] }

// Drives ONE install door: `hermesPresent` is what findHermes() reports on this
// machine. The injected run captures the argument vector AND a snapshot of the
// staged payload before performInstall deletes it.
async function openDoor(
  hermesPresent: string | null,
  resourcesPath: string,
  tempPath: string,
  run?: (call: Call) => void
) {
  const calls: Call[] = []
  const result = await performInstall({
    bootstrapVersion: '9.9.9-door',
    home: HOME,
    stage: () => stageBusinessBootstrap({ isPackaged: true, resourcesPath, tempPath }),
    run: async (command: string, args: string[]) => {
      const payloadRoot = args[args.indexOf('-PayloadRoot') + 1]
      const call = { command, args, payloadRoot, payload: relativeFiles(payloadRoot) }
      calls.push(call)
      run?.(call)
      return { stdout: '', stderr: '' }
    },
    locate: () => hermesPresent
  })
  return { result, calls }
}

// The staging root is a fresh mkdtemp per run, so the only legitimate difference
// between two doors' argument vectors is that path.
function normalizeArgs(call: Call) {
  return call.args.map(argument => argument.split(call.payloadRoot).join('<payload>'))
}

describe('the install door is the same door on every machine', () => {
  it('runs the identical bootstrap transaction whether or not Hermes is already installed', async () => {
    const resourcesPath = tempRoot()
    const tempPath = tempRoot()
    writePackagedBootstrapPayload(resourcesPath)

    const fresh = await openDoor(null, resourcesPath, tempPath)
    const existing = await openDoor(path.join(HOME, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'), resourcesPath, tempPath)

    // Before this contract existed, an already-installed Hermes took a JS-only
    // shortcut and never ran the bootstrap at all: zero calls here.
    expect(existing.calls).toHaveLength(1)
    expect(existing.calls[0].command).toBe(fresh.calls[0].command)
    expect(normalizeArgs(existing.calls[0])).toEqual(normalizeArgs(fresh.calls[0]))

    // The payload set is derived from the staging source of truth, never restated.
    const expected = (() => {
      const staged = stageBusinessBootstrap({ isPackaged: true, resourcesPath, tempPath })
      roots.push(staged)
      return relativeFiles(staged)
    })()
    expect(expected.length).toBeGreaterThan(0)
    expect(fresh.calls[0].payload).toEqual(expected)
    expect(existing.calls[0].payload).toEqual(expected)
  })

  it('hands the bootstrap everything it needs and lets it own engine + gateway detection', async () => {
    const resourcesPath = tempRoot()
    const tempPath = tempRoot()
    writePackagedBootstrapPayload(resourcesPath)

    const { calls } = await openDoor('C:\\hermes\\hermes.exe', resourcesPath, tempPath)
    const { args, payloadRoot } = calls[0]

    expect(calls[0].command).toBe('powershell.exe')
    expect(args).toContain('-NoProfile')
    expect(args[args.indexOf('-File') + 1]).toBe(path.join(payloadRoot, 'bootstrap.ps1'))
    expect(args[args.indexOf('-BootstrapVersion') + 1]).toBe('9.9.9-door')
    expect(args[args.indexOf('-HermesHome') + 1]).toBe(HOME)
    // The companion IS the running app, and the caller decides when a window appears.
    expect(args).toContain('-SkipCompanionInstall')
    expect(args).toContain('-NoLaunch')
    // bootstrap.ps1's own Find-Hermes decides whether an engine install is needed,
    // and Ensure-Gateway owns the gateway on BOTH doors — suppressing either here
    // is what made the two doors produce different machines.
    expect(args).not.toContain('-SkipHermesInstall')
    expect(args).not.toContain('-SkipGatewaySetup')
  })

  it('reports the post-transaction truth and clears the staged payload', async () => {
    const resourcesPath = tempRoot()
    const tempPath = tempRoot()
    writePackagedBootstrapPayload(resourcesPath)

    const installed = await openDoor('C:\\hermes\\hermes.exe', resourcesPath, tempPath)
    expect(installed.result).toEqual({ ok: true, installed: true, code: 0 })
    expect(fs.existsSync(installed.calls[0].payloadRoot)).toBe(false)

    // A bootstrap that "succeeds" without leaving a runnable Hermes is a failure.
    const missing = await openDoor(null, resourcesPath, tempPath)
    expect(missing.result).toEqual({ ok: false, installed: false, code: 1 })
  })

  it('propagates a failing transaction and still removes the staged payload', async () => {
    const resourcesPath = tempRoot()
    const tempPath = tempRoot()
    writePackagedBootstrapPayload(resourcesPath)
    let payloadRoot = ''

    await expect(
      performInstall({
        bootstrapVersion: '9.9.9-door',
        home: HOME,
        stage: () => stageBusinessBootstrap({ isPackaged: true, resourcesPath, tempPath }),
        run: async (_command: string, args: string[]) => {
          payloadRoot = args[args.indexOf('-PayloadRoot') + 1]
          throw new Error('bootstrap exited with code 1')
        },
        locate: () => 'C:\\hermes\\hermes.exe'
      })
    ).rejects.toThrow('bootstrap exited with code 1')

    expect(payloadRoot).not.toBe('')
    expect(fs.existsSync(payloadRoot)).toBe(false)
  })

  it('refuses to run without the companion version the receipt is stamped with', async () => {
    let staged = false
    await expect(
      performInstall({
        bootstrapVersion: '',
        home: HOME,
        stage: () => {
          staged = true
          return tempRoot()
        },
        run: async () => ({ stdout: '', stderr: '' }),
        locate: () => null
      })
    ).rejects.toThrow(/גרסה/)
    expect(staged).toBe(false)
  })
})
