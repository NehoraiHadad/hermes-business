// Test-only fixture setup. The target connection itself uses real native IPC.
import { rollup } from 'rollup'
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EMPTY_ONBOARDING } from '../../shared/onboarding-contract.js'
import { seedMakomTestAuth } from './probes/hermes/makom-test-auth.mjs'

export async function seedCompanionContext(root, sandbox) {
  seedMakomTestAuth(sandbox.hermesHome)
  const bundle = await rollup({ input: path.join(root, 'src/lib/business-context/skill.ts'), plugins: [{
    name: 'pure-context-fixture',
    resolveId(id, importer) {
      if (!id.startsWith('.')) return null
      const base = path.resolve(path.dirname(importer), id)
      return [base, base + '.ts', base + '.js'].find(candidate => existsSync(candidate)) || null
    },
    load(id) {
      if (id.endsWith('.ts')) return ts.transpileModule(readFileSync(id, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
      return null
    }
  }] })
  const file = path.join(sandbox.root, 'context-fixture.mjs')
  try { await bundle.write({ file, format: 'es' }) } finally { await bundle.close() }
  const { buildBusinessContext, businessContextSkillName, renderBusinessContextSkill } = await import(pathToFileURL(file).href)
  const context = buildBusinessContext({ data: EMPTY_ONBOARDING, snapshot: { provider_ready: false, provider_state: 'unconfigured', connections: [] }, completedAt: new Date().toISOString() })
  const name = await businessContextSkillName(context)
  const directory = path.join(sandbox.hermesHome, 'skills/business', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'SKILL.md'), await renderBusinessContextSkill(context))
}

export async function serveCompanionBuild(root) {
  const assets = path.join(root, 'dist')
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1:5173').pathname
    const file = path.resolve(assets, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)))
    if (!file.startsWith(assets + path.sep) || !existsSync(file)) { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
    createReadStream(file).pipe(response)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5173, '127.0.0.1', resolve) })
  return server
}

// A development Electron window can expose its debugger before its first
// navigation commits. Open the same trusted app URL before attaching Playwright;
// this seeds no application state and keeps the real preload/IPC transport.
export async function openCompanionDocument(origin) {
  let target
  for (let i = 0; i < 180; i++) {
    const targets = await (await fetch(origin + '/json/list', { signal: AbortSignal.timeout(1000) })).json()
    target = targets.find(row => row.type === 'page')
    if (target?.attached) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!target) throw Error('Companion did not create a window')
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    const timer = setTimeout(() => { socket.close(); reject(Error('Companion navigation timed out')) }, 15000)
    socket.onopen = () => socket.send(JSON.stringify({ id: 0, method: 'Runtime.runIfWaitingForDebugger' }))
    socket.onerror = () => { clearTimeout(timer); reject(Error('Companion debugger disconnected')) }
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id === 0) {
        if (!target.url || target.url === 'about:blank') {
          socket.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'http://127.0.0.1:5173/' } }))
          return
        }
        clearTimeout(timer); socket.close(); resolve(); return
      }
      if (message.id !== 1) return
      clearTimeout(timer); socket.close()
      if (message.error || message.result?.errorText) reject(Error('Companion navigation failed'))
      else resolve()
    }
  })
}
