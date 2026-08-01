import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  verifyGuardHeartbeat,
  getWhatsappGuardStatus,
  heartbeatPath
} from './whatsapp-guard.cjs'

const NOW = Date.parse('2026-08-01T12:00:00.000Z')

// A heartbeat that SHOULD verify as live gateway enforcement.
function liveHeartbeat(over: Record<string, unknown> = {}) {
  return {
    plugin_loaded: true,
    enforcing: true,
    hooks: ['pre_gateway_dispatch', 'pre_tool_call'],
    mode: 'read_only',
    reply_chats: 0,
    schema: 1,
    pid: 4242,
    nonce: 'abc123',
    process_role: 'gateway',
    plugin_version: '0.2.0',
    transport_bound: true,
    guard_families: ['whatsapp', 'whatsapp_cloud', 'telegram'],
    updated_at: new Date(NOW - 5_000).toISOString(),
    ttl_seconds: 90,
    ...over
  }
}

const aliveDeps = { now: NOW, isPidAlive: () => true, installedVersion: '0.2.0' }

describe('verifyGuardHeartbeat — only positively-proven live gateway enforcement passes', () => {
  it('accepts a fresh, live, current, gateway-role, enforcing heartbeat', () => {
    const res = verifyGuardHeartbeat(liveHeartbeat(), aliveDeps)
    expect(res).toMatchObject({ plugin_loaded: true, enforcing: true, process_role: 'gateway', mode: 'read_only' })
    expect(res?.hooks).toContain('pre_gateway_dispatch')
  })

  it('BLOCKS a serve-process heartbeat — it cannot prove gateway enforcement', () => {
    expect(verifyGuardHeartbeat(liveHeartbeat({ process_role: 'serve' }), aliveDeps)).toBeNull()
  })

  it('BLOCKS when not enforcing or transport not bound', () => {
    expect(verifyGuardHeartbeat(liveHeartbeat({ enforcing: false }), aliveDeps)).toBeNull()
    expect(verifyGuardHeartbeat(liveHeartbeat({ transport_bound: false }), aliveDeps)).toBeNull()
  })

  it('BLOCKS when the required dispatch hook is absent', () => {
    expect(verifyGuardHeartbeat(liveHeartbeat({ hooks: ['pre_tool_call'] }), aliveDeps)).toBeNull()
  })

  it('BLOCKS a STALE plugin version (gateway running an older build that has not reloaded)', () => {
    expect(verifyGuardHeartbeat(liveHeartbeat({ plugin_version: '0.1.0' }), aliveDeps)).toBeNull()
  })

  it('BLOCKS when the producing gateway pid is dead (restart drops the guard)', () => {
    expect(verifyGuardHeartbeat(liveHeartbeat(), { ...aliveDeps, isPidAlive: () => false })).toBeNull()
  })

  it('BLOCKS a stale heartbeat (refresh stopped → dead process, also defends pid reuse)', () => {
    const stale = liveHeartbeat({ updated_at: new Date(NOW - 120_000).toISOString() })
    expect(verifyGuardHeartbeat(stale, aliveDeps)).toBeNull()
  })

  it('BLOCKS an implausible future timestamp', () => {
    const future = liveHeartbeat({ updated_at: new Date(NOW + 5 * 60_000).toISOString() })
    expect(verifyGuardHeartbeat(future, aliveDeps)).toBeNull()
  })

  it('BLOCKS a null/garbage heartbeat', () => {
    expect(verifyGuardHeartbeat(null, aliveDeps)).toBeNull()
    expect(verifyGuardHeartbeat({}, aliveDeps)).toBeNull()
  })
})

describe('getWhatsappGuardStatus — reads + liveness-verifies the gateway heartbeat file', () => {
  let tmp: string
  let prevHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-guard-'))
    prevHome = process.env.HERMES_HOME
    process.env.HERMES_HOME = tmp
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = prevHome
    fs.rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function installVersion(version: string) {
    const dir = path.join(tmp, 'plugins', 'business-whatsapp-policy')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugin.yaml'), `name: business-whatsapp-policy\nversion: ${version}\n`)
  }
  function writeHeartbeat(body: Record<string, unknown>) {
    const p = heartbeatPath('gateway')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(body))
  }

  it('returns null when no heartbeat exists (BLOCKED)', () => {
    expect(getWhatsappGuardStatus()).toBeNull()
  })

  it('verifies a live heartbeat whose version matches the INSTALLED plugin and a live pid', () => {
    installVersion('0.2.0')
    writeHeartbeat(liveHeartbeat({ pid: process.pid, updated_at: new Date().toISOString(), plugin_version: '0.2.0' }))
    const res = getWhatsappGuardStatus()
    expect(res).toMatchObject({ plugin_loaded: true, enforcing: true, process_role: 'gateway' })
  })

  it('BLOCKS when the heartbeat version does not match the installed plugin version', () => {
    installVersion('0.3.0')
    writeHeartbeat(liveHeartbeat({ pid: process.pid, updated_at: new Date().toISOString(), plugin_version: '0.2.0' }))
    expect(getWhatsappGuardStatus()).toBeNull()
  })
})
