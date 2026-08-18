import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_RUNTIME_INPUTS,
  BUILD_PIPELINE_INPUTS,
  CATEGORIES,
  EVIDENCE_SUBJECTS,
  PACKAGED_INPUTS,
  RECAPTURE,
  SUBJECT_SCHEME,
  THIN_INSTALLER_INPUTS
} from './subject-registry.mjs'
import { CATEGORIES as GATE_CATEGORIES } from './evidence-gates.mjs'
import { resolveSubjects } from './subject-hash.mjs'
import { repoRoot } from './source-fingerprint.mjs'
import { packagingStages } from '../package-win.mjs'

// The registry is the single declarative source of truth; these guard its shape
// so a category can never be attested by one gate and ignored by another.

describe('subject registry integrity', () => {
  it('every gate-known category has subjects and a recapture hint', () => {
    for (const c of GATE_CATEGORIES) {
      expect(EVIDENCE_SUBJECTS[c], `subjects for ${c}`).toBeTruthy()
      expect(typeof RECAPTURE[c], `recapture hint for ${c}`).toBe('string')
    }
    expect([...CATEGORIES].sort()).toEqual([...GATE_CATEGORIES].sort())
  })

  it('packaged-e2e attests the full packaged input set', () => {
    expect(EVIDENCE_SUBJECTS['packaged-e2e']).toBe(PACKAGED_INPUTS)
  })

  it('PACKAGED_INPUTS = app runtime + build pipeline (transforms count too)', () => {
    expect(PACKAGED_INPUTS).toEqual([...APP_RUNTIME_INPUTS, ...BUILD_PIPELINE_INPUTS])
    expect(BUILD_PIPELINE_INPUTS.length).toBeGreaterThan(0)
    expect(THIN_INSTALLER_INPUTS.length).toBeGreaterThan(0)
  })

  it('SUBJECT_SCHEME is a positive integer, bumped past the narrow-set scheme', () => {
    expect(Number.isInteger(SUBJECT_SCHEME)).toBe(true)
    expect(SUBJECT_SCHEME).toBeGreaterThanOrEqual(2)
  })
})

describe('packaged input set — resolved over the real repo', () => {
  const files = resolveSubjects(repoRoot(), PACKAGED_INPUTS)

  it('spans renderer sources, electron runtime, hermes-plugin and installer', () => {
    const hasPrefix = p => files.some(f => f.startsWith(p))
    expect(hasPrefix('src/')).toBe(true)
    expect(hasPrefix('electron/')).toBe(true)
    expect(hasPrefix('hermes-plugin/')).toBe(true)
    expect(files).toContain('installer/bootstrap.ps1')
    expect(files).toContain('package.json')
    expect(files).toContain('index.html')
  })

  it('includes the build-pipeline transforms that produce the shipped bytes', () => {
    expect(files).toContain('scripts/after-pack.cjs')
    expect(files).toContain('scripts/build-plugin.mjs')
    expect(files).toContain('scripts/gen-build-attestation.mjs')
    expect(files).toContain('scripts/lib/build-attestation.mjs')
  })

  it('thin-installer subjects span the whole installer + harness contract', () => {
    const t = resolveSubjects(repoRoot(), EVIDENCE_SUBJECTS['thin-installer'])
    for (const f of [
      'installer/business-bootstrap.nsi',
      'scripts/build-bootstrap.ps1',
      'scripts/verify-bootstrap.ps1',
      'scripts/e2e-thin-network-installer.ps1',
      'scripts/e2e-companion-nsis-contract.ps1',
      'hermes-compat.json'
    ]) {
      expect(t, f).toContain(f)
    }
    // whole installer library + PowerShell harness helpers, via dir selectors
    expect(t.some(f => f.startsWith('installer/lib/'))).toBe(true)
    expect(t.some(f => f.startsWith('scripts/lib/') && f.endsWith('.ps1'))).toBe(true)
    expect(t.some(f => f.startsWith('scripts/lib/tests/'))).toBe(true)
  })

  it('never hashes generated outputs, node_modules, tests or evidence envelopes', () => {
    for (const f of files) {
      expect(f.startsWith('dist/'), f).toBe(false)
      expect(f.startsWith('release/'), f).toBe(false)
      expect(f.includes('node_modules/'), f).toBe(false)
      expect(f.startsWith('docs/evidence/'), f).toBe(false)
      expect(/\.test\.(cjs|mjs|js|jsx|ts|tsx|py)$/.test(f), f).toBe(false)
      expect(f.includes('__pycache__'), f).toBe(false)
    }
  })
})

// Minimal electron-builder `filter` matcher: `*` inside a segment, `**` at any
// depth, leading `!` negates. Enough for the community extraResources filters and
// deliberately derived from package.json rather than restated here.
const globRe = g =>
  new RegExp(
    `^${g
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')}$`
  )

/** Does electron-builder ship `rel` (relative to the entry's `from`)? */
const shipsUnderFilter = (rel, filters = []) => {
  let ok = !filters.some(f => !f.startsWith('!'))
  for (const f of filters) {
    const negated = f.startsWith('!')
    if (globRe(negated ? f.slice(1) : f).test(rel)) ok = !negated
  }
  return ok
}

const filesUnder = abs =>
  readdirSync(abs, { recursive: true })
    .map(p => String(p).split(path.sep).join('/'))
    .filter(rel => statSync(path.join(abs, rel)).isFile())

// The community runtime (generator/provisioner CLIs, the pure community library,
// the product skill bodies) is shipped by package.json `build.extraResources` and
// by the NSIS `community\` payload. If it were not fingerprinted, a change to the
// generator would leave a prepared artifact "valid" — dishonest coverage. This
// suite anchors the registry on the SHIPPER (package.json), never on a restated list.
describe('community runtime payload is fingerprinted', () => {
  const root = repoRoot()
  const packaged = resolveSubjects(root, PACKAGED_INPUTS)
  const extraResources = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).build
    .extraResources
  // Every non-vendored source shipped under business-bootstrap/community/. The
  // vendored js-yaml/argparse bytes are excluded on purpose: node_modules is out
  // of every set, covered instead by package-lock.json + the npm ci lock-attest.
  const community = extraResources.filter(
    e => e.to.startsWith('business-bootstrap/community/') && !e.from.startsWith('node_modules/')
  )

  it('the shipper really declares a community payload (anchor is live)', () => {
    expect(community.length).toBeGreaterThan(0)
    const from = community.map(e => e.from)
    expect(from).toContain('scripts/community-generate.mjs')
    expect(from).toContain('scripts/community-provision.mjs')
    expect(from).toContain('scripts/lib/community')
    expect(from).toContain('assets/community-skills')
  })

  it('every community source the artifact ships is inside the packaged fingerprint set', () => {
    for (const entry of community) {
      const abs = path.join(root, entry.from)
      if (statSync(abs).isFile()) {
        expect(packaged, entry.from).toContain(entry.from)
        continue
      }
      const shipped = filesUnder(abs).filter(rel => shipsUnderFilter(rel, entry.filter))
      expect(shipped.length, `${entry.from} ships nothing`).toBeGreaterThan(0)
      for (const rel of shipped) expect(packaged, `${entry.from}/${rel}`).toContain(`${entry.from}/${rel}`)
    }
  })

  it('excludes what never ships: community tests and non-SKILL markdown', () => {
    const lib = packaged.filter(f => f.startsWith('scripts/lib/community/'))
    expect(lib.length).toBeGreaterThan(0)
    for (const f of lib) expect(f.endsWith('.test.mjs'), f).toBe(false)
    const skills = packaged.filter(f => f.startsWith('assets/community-skills/'))
    expect(skills.length).toBeGreaterThan(0)
    for (const f of skills) expect(f.endsWith('/SKILL.md'), f).toBe(true)
  })

  it('the thin-installer subject carries it too — the NSIS script writes that payload', () => {
    const t = resolveSubjects(root, THIN_INSTALLER_INPUTS)
    expect(t).toContain('scripts/community-generate.mjs')
    expect(t).toContain('scripts/community-provision.mjs')
    expect(t.some(f => f.startsWith('scripts/lib/community/'))).toBe(true)
    expect(t.some(f => f.startsWith('assets/community-skills/'))).toBe(true)
  })
})

describe('recapture hints match the real capture contract', () => {
  // requirePassProof (evidence-gates.mjs) rejects a passed packaged-e2e envelope
  // unless summary carries build_nonce + release_binding_digest + installer_sha256.
  // The ONLY path that machine-writes those is scripts/e2e-exact-artifact.mjs, a
  // stage of the package pipeline. A plain
  //   e2e-installed-isolated.mjs | capture-evidence.mjs packaged-e2e -
  // pipe mints an UNBOUND passed envelope the verifier then rejects, so the hint
  // must never send an operator down that path (verified live 2026-08-03).
  it('packaged-e2e points at the exact-artifact package stage, never the unbound plain pipe', () => {
    const hint = RECAPTURE['packaged-e2e']
    expect(hint).toMatch(/package:win:qa/)
    expect(hint).toMatch(/exact-artifact/)
    expect(hint).toMatch(/HERMES_BUSINESS_E2E_APPROVAL=1/)
    expect(hint).not.toMatch(/build:test-packaged/)
    expect(hint).not.toMatch(/capture-evidence\.mjs packaged-e2e/)
  })

  it('approval is captured by the same exact-artifact run, not a standalone pipe', () => {
    expect(RECAPTURE.approval).toMatch(/package:win:qa/)
    expect(RECAPTURE.approval).toMatch(/exact-artifact/)
    expect(RECAPTURE.approval).not.toMatch(/capture-evidence\.mjs approval/)
  })

  // `npm run package:thin-installer:qa > <raw>` shares stdout with npm's banner,
  // build:plugin and the harness's own progress lines, so the redirect writes a
  // mixed log rather than JSON. (`-Command` entry used to die inside the
  // extraction closure too; that is fixed, so -File is now merely what the npm
  // script uses.) docs/evidence/README.md "Regenerate" carries the whole command;
  // the hint must steer there instead of at the redirect.
  it('thin-installer names the -File + report-tail constraint and points at the documented command', () => {
    const hint = RECAPTURE['thin-installer']
    expect(hint).toMatch(/docs\/evidence\/README\.md/)
    expect(hint).toMatch(/-File/)
    expect(hint).not.toMatch(/^npm run package:thin-installer:qa then/)

    const readme = readFileSync(path.join(repoRoot(), 'docs', 'evidence', 'README.md'), 'utf8')
    expect(readme).toMatch(/^## Regenerate$/m)
    expect(readme).toMatch(/-File scripts\/e2e-thin-network-installer\.ps1 -EmitQaArtifact/)
  })

  it('the referenced pipeline script and stage actually exist and are wired', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot(), 'package.json'), 'utf8'))
    expect(pkg.scripts['package:win:qa']).toContain('package-win.mjs')
    expect(existsSync(path.join(repoRoot(), 'scripts', 'e2e-exact-artifact.mjs'))).toBe(true)
    for (const channel of ['public', 'qa']) {
      const scripts = packagingStages(channel).map(s => s.script)
      expect(scripts, channel).toContain('scripts/e2e-exact-artifact.mjs')
    }
  })
})

describe('evidence subjects never include the evidence envelopes themselves', () => {
  it('so an evidence-only edit can never self-invalidate a passed envelope', () => {
    for (const c of CATEGORIES) {
      const files = resolveSubjects(repoRoot(), EVIDENCE_SUBJECTS[c])
      expect(files.some(f => f.startsWith('docs/evidence/')), c).toBe(false)
    }
  })
})
