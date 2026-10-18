// Build the Desktop UI from the SAME reviewed source as the isolated test CLI.
// Reuse installed build dependencies; the compiled application stays in temp.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const file = '.artifacts/makom/pinned-runtime.json'
const metadata = JSON.parse(readFileSync(file, 'utf8'))
const root = realpathSync(metadata.root)
const temp = realpathSync(os.tmpdir())
assert.ok(root.startsWith(temp + path.sep) && path.basename(root).startsWith('tachles-makom-runtime-'))
assert.ok(realpathSync(metadata.engine).startsWith(root + path.sep), 'The engine must stay inside the isolated runtime')
const installed = path.join(process.env.LOCALAPPDATA, 'hermes/hermes-agent')
const dependencies = path.join(installed, 'node_modules')
assert.ok(existsSync(path.join(dependencies, 'vite/bin/vite.js')), 'Installed Hermes build dependencies are required')
const link = path.join(metadata.engine, 'node_modules')
if (!existsSync(link)) symlinkSync(dependencies, link, 'junction')
assert.equal(realpathSync(link), realpathSync(dependencies), 'Refuse an unexpected dependency link')
const desktop = path.join(metadata.engine, 'apps/desktop')
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: desktop, env: process.env, stdio: 'inherit', windowsHide: true })
  assert.equal(result.status, 0, 'Pinned Desktop build failed')
}
run([path.join(dependencies, 'vite/bin/vite.js'), 'build'])
run(['scripts/bundle-electron-main.mjs'])
run(['scripts/stage-native-deps.mjs'])
metadata.desktopApp = desktop
metadata.desktopExe = path.resolve('node_modules/electron/dist/electron.exe')
writeFileSync(file, JSON.stringify(metadata, null, 2))
console.log('Pinned Desktop and CLI now share source ' + metadata.sha)
