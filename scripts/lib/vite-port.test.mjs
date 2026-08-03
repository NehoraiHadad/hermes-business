import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isThisProjectsVite,
  readViteConfigPort,
  resolveVitePort,
  viteUrl,
  waitForThisProjectsVite
} from './vite-port.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const configPath = path.join(repoRoot, 'vite.config.ts')

describe('vite port is read from the single declaration', () => {
  it('finds the real port in this repo’s vite.config.ts', () => {
    const port = readViteConfigPort(readFileSync(configPath, 'utf8'))
    expect(port).toBeGreaterThan(0)
    expect(resolveVitePort({ env: {}, configPath })).toBe(port)
  })

  it('parses a server block regardless of key order and spacing', () => {
    expect(readViteConfigPort('server: { host: "127.0.0.1", port: 5173 }')).toBe(5173)
    expect(readViteConfigPort('server:{\n  port : 4321,\n  host: "x"\n}')).toBe(4321)
  })

  it('returns null when there is no server.port to read', () => {
    expect(readViteConfigPort('export default { build: { outDir: "dist" } }')).toBeNull()
    expect(() => resolveVitePort({ env: {}, configPath: path.join(repoRoot, 'package.json') })).toThrow(
      /Could not read server.port/
    )
  })

  it('lets VITE_PORT win, but only when it is an integer', () => {
    expect(resolveVitePort({ env: { VITE_PORT: '4000' }, configPath })).toBe(4000)
    expect(() => resolveVitePort({ env: { VITE_PORT: 'nope' }, configPath })).toThrow(/must be an integer/)
  })

  it('builds a loopback url', () => {
    expect(viteUrl(5173)).toBe('http://127.0.0.1:5173')
  })
})

describe('the responder on the port is identified before it is used', () => {
  const indexHtml = readFileSync(path.join(repoRoot, 'index.html'), 'utf8')

  it('accepts this project’s index.html', () => {
    expect(isThisProjectsVite(indexHtml)).toBe(true)
  })

  it('rejects an unrelated server on the same port', () => {
    expect(isThisProjectsVite('<html><body>Grafana</body></html>')).toBe(false)
  })

  it('waitForThisProjectsVite resolves once the marker appears', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return { ok: true, text: async () => (calls > 1 ? indexHtml : '<html>booting</html>') }
    }
    await expect(
      waitForThisProjectsVite('http://127.0.0.1:5173', { fetchImpl, intervalMs: 1, timeoutMs: 2000 })
    ).resolves.toEqual({ url: 'http://127.0.0.1:5173', identified: true })
  })

  it('reports a FOREIGN responder distinctly from a dead port', async () => {
    const foreign = async () => ({ ok: true, text: async () => '<html>some other app</html>' })
    await expect(
      waitForThisProjectsVite('http://127.0.0.1:5173', { fetchImpl: foreign, intervalMs: 1, timeoutMs: 30 })
    ).rejects.toThrow(/not this project's Vite dev server/)

    const dead = async () => { throw new Error('ECONNREFUSED') }
    await expect(
      waitForThisProjectsVite('http://127.0.0.1:5173', { fetchImpl: dead, intervalMs: 1, timeoutMs: 30 })
    ).rejects.toThrow(/did not become ready/)
  })
})
