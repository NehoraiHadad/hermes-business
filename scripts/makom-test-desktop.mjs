// Build the Desktop UI from the SAME official release source as the isolated test CLI.
// Use the official release lockfile in the isolated test runtime.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const file = '.artifacts/makom/runtime.json'
const metadata = JSON.parse(readFileSync(file, 'utf8'))
const root = realpathSync(metadata.root)
const temp = realpathSync(os.tmpdir())
assert.ok(root.startsWith(temp + path.sep) && path.basename(root).startsWith('tachles-makom-runtime-'))
assert.ok(realpathSync(metadata.engine).startsWith(root + path.sep), 'The engine must stay inside the isolated runtime')
const dependencies = path.join(metadata.engine, 'node_modules')
assert.ok(existsSync(path.join(dependencies, 'vite/bin/vite.js')), 'Run npm ci --workspace apps/desktop --include-workspace-root in the isolated engine first')
assert.ok(realpathSync(dependencies).startsWith(root + path.sep), 'Dependencies must belong to the isolated runtime')
const desktop = path.join(metadata.engine, 'apps/desktop')
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: desktop, env: process.env, stdio: 'inherit', windowsHide: true })
  assert.equal(result.status, 0, 'Official Desktop build failed')
}
run([path.join(dependencies, 'vite/bin/vite.js'), 'build'])
run(['scripts/bundle-electron-main.mjs', '--dev'])
run(['scripts/stage-native-deps.mjs'])
metadata.desktopApp = desktop
metadata.desktopExe = path.resolve('node_modules/electron/dist/electron.exe')
writeFileSync(file, JSON.stringify(metadata, null, 2))
console.log('Official Desktop and CLI now share source ' + metadata.sha)
