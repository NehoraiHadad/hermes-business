// Minimal fake-repo fixtures for subject-registry.test.mjs: exactly one
// representative file per declared subject selector, so every purpose-split set
// resolves non-empty and can be perturbed independently. Kept out of the test
// file itself to honour the module size budget.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const roots = []

/** One representative subject per selector across every set. */
export const FILES = {
  // APP_RUNTIME_INPUTS
  'electron/main.cjs': 'run\n',
  'src/main.tsx': 'export const x=1\n',
  'index.html': '<!doctype html>\n',
  'vite.config.ts': 'export default {}\n',
  'tsconfig.json': '{}\n',
  'tsconfig.app.json': '{}\n',
  'tsconfig.node.json': '{}\n',
  'hermes-plugin/business-shell/plugin.js': 'module.exports={}\n',
  'installer/bootstrap.ps1': 'Write-Host hi\n',
  'installer/bootstrap-companion.ps1': 'Write-Host hi\n',
  'build/icon.png': 'PNG\n',
  'build/icon.ico': 'ICO\n',
  'package.json': '{"name":"x"}\n',
  // BUILD_PIPELINE_INPUTS
  'scripts/after-pack.cjs': 'exports.default=()=>{}\n',
  'scripts/build-plugin.mjs': 'export {}\n',
  'scripts/gen-build-attestation.mjs': 'export {}\n',
  'scripts/lib/build-attestation.mjs': 'export {}\n',
  // BUILD_PIPELINE_INPUTS — transitive release-security pipeline (HIGH 4)
  'scripts/lib/release/preflight.mjs': 'export {}\n',
  'scripts/gen-release-manifest.mjs': 'export {}\n',
  'scripts/gen-release-report.mjs': 'export {}\n',
  'scripts/finalize-release.mjs': 'export {}\n',
  'scripts/sign-release.mjs': 'export {}\n',
  'scripts/gen-installer-checksums.mjs': 'export {}\n',
  'scripts/verify-no-update-metadata.mjs': 'export {}\n',
  'scripts/verify-release-contract.mjs': 'export {}\n',
  // THIN_INSTALLER_INPUTS (beyond the shipped bootstrap scripts above)
  'installer/business-bootstrap.nsi': 'OutFile x\n',
  'installer/lib/Logging.ps1': 'function Write-Log {}\n',
  'scripts/build-bootstrap.ps1': 'param()\n',
  'scripts/verify-bootstrap.ps1': 'param()\n',
  'scripts/test-bootstrap-lib.ps1': 'param()\n',
  'scripts/mock-http-server.ps1': 'param()\n',
  'scripts/e2e-thin-network-installer.ps1': 'param()\n',
  'scripts/e2e-companion-nsis-contract.ps1': 'param()\n',
  'scripts/lib/e2e-thin-installer-lib.ps1': 'function New-Fixture {}\n',
  'scripts/lib/tests/http-integrity.tests.ps1': 'function Invoke-Http {}\n',
  'hermes-compat.json': '{"range":">=0.19.0 <0.20.0"}\n',
  // PLUGIN_CONTRACT (approval / shared-state)
  'scripts/verify-plugin.mjs': 'export {}\n',
  'scripts/plugin-sdk-contract.mjs': 'export {}\n',
  'scripts/gen-hermes-contract.mjs': 'export {}\n',
  'scripts/lib/hermes-desktop-contract.mjs': 'export {}\n',
  'scripts/hermes-desktop-contract.json': '{}\n'
}

export function put(root, rel, body) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

/** A throwaway root pre-populated so every declared selector resolves. */
export function fakeRegistryRoot(extra = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'subj-reg-'))
  roots.push(root)
  for (const [rel, body] of Object.entries({ ...FILES, ...extra })) put(root, rel, body)
  return root
}

export function cleanupRegistryRoots() {
  while (roots.length) {
    try {
      rmSync(roots.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}
