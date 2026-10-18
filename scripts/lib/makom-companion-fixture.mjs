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
