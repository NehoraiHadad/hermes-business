import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  EVIDENCE_SUBJECTS,
  PACKAGED_INPUTS,
  SUBJECT_SCHEME,
  THIN_INSTALLER_INPUTS
} from './subject-registry.mjs'
import { MissingSubjectError, hashSubjects, resolveSelector } from './subject-hash.mjs'
import { repoRoot } from './source-fingerprint.mjs'
import { cleanupRegistryRoots, fakeRegistryRoot, put } from './subject-registry-fixtures.mjs'

afterEach(cleanupRegistryRoots)

const fp = (root, set) => hashSubjects(root, set, { scheme: SUBJECT_SCHEME }).fingerprint
const THIN = EVIDENCE_SUBJECTS['thin-installer']

// A single perturbation must move exactly the fingerprints that own that input.
// `changes` are sets the edit MUST invalidate; `stable` are sets it must NOT.
const CASES = [
  { rel: 'installer/business-bootstrap.nsi', body: 'OutFile y\n', changes: [THIN], stable: [PACKAGED_INPUTS] },
  { rel: 'installer/lib/Logging.ps1', body: 'function Write-Log { 2 }\n', changes: [THIN], stable: [PACKAGED_INPUTS] },
  { rel: 'scripts/build-bootstrap.ps1', body: 'param($x)\n', changes: [THIN], stable: [PACKAGED_INPUTS] },
  { rel: 'hermes-compat.json', body: '{"range":">=0.20.0 <0.21.0"}\n', changes: [THIN], stable: [PACKAGED_INPUTS] },
  { rel: 'scripts/after-pack.cjs', body: 'exports.default=async()=>2\n', changes: [PACKAGED_INPUTS], stable: [THIN] },
  { rel: 'scripts/build-plugin.mjs', body: 'export const v=2\n', changes: [PACKAGED_INPUTS], stable: [THIN] },
  { rel: 'electron/main.cjs', body: 'run2\n', changes: [PACKAGED_INPUTS], stable: [THIN] },
  // HIGH 4 — the transitive release-security pipeline is attested: a containment /
  // signing / verdict change invalidates a prepared artifact but leaves THIN alone.
  { rel: 'scripts/lib/release/preflight.mjs', body: 'export const v=2\n', changes: [PACKAGED_INPUTS], stable: [THIN] },
  { rel: 'scripts/finalize-release.mjs', body: 'export const v=2\n', changes: [PACKAGED_INPUTS], stable: [THIN] },
  // The community runtime payload ships through BOTH shippers (extraResources
  // into the app and the NSIS `community\` payload), so it legitimately moves
  // both fingerprints — no `stable` set exists for it.
  { rel: 'scripts/community-generate.mjs', body: 'export const v=2\n', changes: [PACKAGED_INPUTS, THIN], stable: [] },
  { rel: 'scripts/lib/community/generate.mjs', body: 'export const gen=2\n', changes: [PACKAGED_INPUTS, THIN], stable: [] },
  { rel: 'assets/community-skills/community-bootstrap/SKILL.md', body: '# bootstrap v2\n', changes: [PACKAGED_INPUTS, THIN], stable: [] }
]

describe('purpose-split fingerprints — an edit moves only the sets that own it', () => {
  for (const { rel, body, changes, stable } of CASES) {
    it(`editing ${rel} invalidates the right fingerprints only`, () => {
      const root = fakeRegistryRoot()
      const before = new Map([...changes, ...stable].map(s => [s, fp(root, s)]))
      put(root, rel, body)
      for (const s of changes) expect(fp(root, s), `${rel} must invalidate`).not.toBe(before.get(s))
      for (const s of stable) expect(fp(root, s), `${rel} must NOT invalidate`).toBe(before.get(s))
    })
  }
})

describe('non-shipped / evidence / cache drift never invalidates', () => {
  const noise = {
    'docs/evidence/thin-installer.json': '{"status":"passed"}\n',
    'hermes-plugin/business-whatsapp-policy/tests/test_x.py': 'assert True\n',
    'hermes-plugin/business-shell/__pycache__/x.pyc': 'bytecode',
    'scripts/lib/e2e-thin-installer-lib.test.mjs': 'test only\n',
    // neither ships: the extraResources/NSIS filters drop community tests, and
    // only `**/SKILL.md` bodies leave assets/community-skills.
    'scripts/lib/community/generate.test.mjs': 'test only\n',
    'assets/community-skills/community-bootstrap/NOTES.md': 'not shipped\n',
    'dist/assets/index-abc.js': 'generated\n'
  }
  for (const [name, set] of [['packaged', PACKAGED_INPUTS], ['thin-installer', THIN]]) {
    it(`${name} is stable across tests, caches, evidence, dist and *.test.mjs noise`, () => {
      const root = fakeRegistryRoot()
      const before = fp(root, set)
      for (const [rel, b] of Object.entries(noise)) put(root, rel, b)
      expect(fp(root, set)).toBe(before)
    })
  }
})

describe('directory selectors fail closed when empty', () => {
  it('every dir selector throws MissingSubjectError on an empty tree', () => {
    const root = fakeRegistryRoot()
    for (const sel of THIN_INSTALLER_INPUTS.filter(s => s.dir)) {
      // resolve the real tree first (proves it is currently non-empty)…
      expect(resolveSelector(repoRoot(), sel).length).toBeGreaterThan(0)
      // …then a root missing that whole dir must fail closed, never silently pass.
      expect(() => resolveSelector(root, { ...sel, dir: `${sel.dir}-absent` })).toThrow(MissingSubjectError)
    }
  })
})

describe('release package.json prunes verification-only files from the artifact', () => {
  const files = JSON.parse(readFileSync(path.join(repoRoot(), 'package.json'), 'utf8')).build.files
  it('keeps the runtime includes', () => {
    for (const inc of ['electron/**/*', 'hermes-plugin/**/*', 'dist/**/*', 'package.json']) {
      expect(files).toContain(inc)
    }
  })
  it('explicitly excludes tests, python + vite caches and compiled bytecode', () => {
    for (const ex of [
      '!hermes-plugin/**/tests/**',
      '!hermes-plugin/**/test_*.py',
      '!**/__pycache__/**',
      '!**/*.pyc',
      '!**/.pytest_cache/**'
    ]) {
      expect(files).toContain(ex)
    }
    // a nested Vite/vitest cache exclusion is present (any form)
    expect(files.some(f => /^!.*\.vite(st)?\//.test(f))).toBe(true)
  })
})
