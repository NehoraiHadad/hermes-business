// Shared fixture for the build-attestation / source-fingerprint suites: a
// self-consistent fake repo root carrying the COMPLETE packaged-source input set
// the fingerprint spans (renderer sources + electron runtime + hermes-plugin +
// installer scripts + assets + package.json + the build-pipeline transforms),
// plus release/win-unpacked. Not a *.test file, so vitest never runs it alone.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const created = []

export function put(root, rel, body) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

export function fakeRoot({ version = '9.9.9', productName = 'Widget', electron = { 'a.cjs': 'module.exports=1\n' } } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-root-'))
  created.push(root)
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version, main: 'electron/main.cjs', build: { productName } }, null, 2)
  )
  for (const [name, body] of Object.entries(electron)) put(root, path.join('electron', name), body)
  // Every other declared packaged-source subject, so the full-set fingerprint
  // resolves without a MissingSubjectError.
  put(root, 'src/main.tsx', 'export const x = 1\n')
  put(root, 'index.html', '<!doctype html>\n')
  put(root, 'vite.config.ts', 'export default {}\n')
  put(root, 'tsconfig.json', '{}\n')
  put(root, 'tsconfig.app.json', '{}\n')
  put(root, 'tsconfig.node.json', '{}\n')
  put(root, 'hermes-plugin/business-shell/plugin.js', 'module.exports={}\n')
  put(root, 'installer/bootstrap.ps1', 'Write-Host hi\n')
  put(root, 'installer/bootstrap-companion.ps1', 'Write-Host hi\n')
  // Community runtime payload (extraResources + the NSIS community\ payload).
  put(root, 'scripts/community-generate.mjs', 'export {}\n')
  put(root, 'scripts/community-provision.mjs', 'export {}\n')
  put(root, 'scripts/lib/community/generate.mjs', 'export const gen=1\n')
  put(root, 'assets/community-skills/community-bootstrap/SKILL.md', '# bootstrap\n')
  put(root, 'build/icon.png', 'PNG-fake')
  put(root, 'build/icon.ico', 'ICO-fake')
  // Build-pipeline transforms that deterministically shape/sign/attest the bytes
  // are part of the packaged input set, so the fixture must carry them too.
  put(root, 'scripts/after-pack.cjs', 'exports.default=()=>{}\n')
  put(root, 'scripts/build-plugin.mjs', 'export {}\n')
  put(root, 'scripts/gen-build-attestation.mjs', 'export {}\n')
  put(root, 'scripts/lib/build-attestation.mjs', 'export {}\n')
  // Transitive release-security pipeline (HIGH 4) is part of the attested input set.
  put(root, 'scripts/lib/release/preflight.mjs', 'export {}\n')
  put(root, 'scripts/gen-release-manifest.mjs', 'export {}\n')
  put(root, 'scripts/gen-release-report.mjs', 'export {}\n')
  put(root, 'scripts/finalize-release.mjs', 'export {}\n')
  put(root, 'scripts/sign-release.mjs', 'export {}\n')
  put(root, 'scripts/gen-installer-checksums.mjs', 'export {}\n')
  put(root, 'scripts/verify-no-update-metadata.mjs', 'export {}\n')
  put(root, 'scripts/verify-release-contract.mjs', 'export {}\n')
  const unpacked = path.join(root, 'release', 'win-unpacked')
  mkdirSync(path.join(unpacked, 'resources'), { recursive: true })
  writeFileSync(path.join(unpacked, `${productName}.exe`), 'MZ-fake')
  return { root, unpacked, put: (rel, body) => put(root, rel, body) }
}

/** Remove every fake root created so far; call from afterEach. */
export function cleanupRoots() {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}
