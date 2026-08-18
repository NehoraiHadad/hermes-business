import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { classifyProvenance, memoizeProvenance, EVIDENCE_ARTIFACT_RE, RELEASE_METADATA_PATHS, isDurableReleaseArtifact } from './git-provenance.mjs'
import { checkCorrespondence } from './evidence-gates.mjs'

// A deterministic fake git: ancestry + changed paths come from fixture maps, so
// classifyProvenance is exercised with zero dependence on a real repository.
function fakeGit({ ancestors = {}, diffs = {} } = {}) {
  return (args) => {
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (!ancestors[`${args[2]}->${args[3]}`]) throw new Error('not an ancestor')
      return ''
    }
    if (args[0] === 'diff' && args[1] === '--name-only') {
      return (diffs[`${args[2]}->${args[3]}`] || []).join('\n')
    }
    throw new Error('unexpected git ' + args.join(' '))
  }
}
const HEAD = 'HEAD1'

describe('classifyProvenance', () => {
  it('equal when git_head is the current HEAD', () => {
    expect(classifyProvenance(HEAD, HEAD, { git: fakeGit() }).relation).toBe('equal')
  })
  it('unknown when git_head is missing or literally "unknown"', () => {
    expect(classifyProvenance('', HEAD, { git: fakeGit() }).relation).toBe('unknown')
    expect(classifyProvenance('unknown', HEAD, { git: fakeGit() }).relation).toBe('unknown')
  })
  it('divergent when git_head is bogus or a non-ancestor', () => {
    expect(classifyProvenance('BOGUS', HEAD, { git: fakeGit({ ancestors: {} }) }).relation).toBe('divergent')
  })
  it('evidence-descendant when only docs/evidence/*.json changed since', () => {
    const git = fakeGit({
      ancestors: { 'BASE->HEAD1': true },
      diffs: { 'BASE->HEAD1': ['docs/evidence/approval.json', 'docs/evidence/packaged-e2e.json'] }
    })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('evidence-descendant')
  })
  it('code-descendant when any attested subject or docs/evidence non-envelope path changed', () => {
    for (const changed of [['src/main.ts'], ['docs/evidence/forensics/raw.txt'], ['docs/evidence/README.md']]) {
      const git = fakeGit({ ancestors: { 'BASE->HEAD1': true }, diffs: { 'BASE->HEAD1': changed } })
      expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('code-descendant')
    }
  })
  it('evidence-descendant for a step-9 release-metadata commit (ledger + trust roots only)', () => {
    const git = fakeGit({
      ancestors: { 'BASE->HEAD1': true },
      diffs: { 'BASE->HEAD1': ['release-ledger.json', 'build/trust-roots.json'] }
    })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('evidence-descendant')
  })
  it('code-descendant when release metadata is committed ALONGSIDE a release script', () => {
    const git = fakeGit({
      ancestors: { 'BASE->HEAD1': true },
      diffs: { 'BASE->HEAD1': ['release-ledger.json', 'build/trust-roots.json', 'scripts/lib/release/gather.mjs'] }
    })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('code-descendant')
  })
  it('evidence-descendant for a mixed evidence + metadata + docs-prose refresh', () => {
    const git = fakeGit({
      ancestors: { 'BASE->HEAD1': true },
      diffs: { 'BASE->HEAD1': ['docs/evidence/packaged-e2e.json', 'release-ledger.json', 'build/trust-roots.json', 'docs/RELEASING.md'] }
    })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('evidence-descendant')
  })
  it('code-descendant (fail closed) when the ancestor diff is empty', () => {
    const git = fakeGit({ ancestors: { 'BASE->HEAD1': true }, diffs: { 'BASE->HEAD1': [] } })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('code-descendant')
  })
  it('divergent (fail closed) when ancestry succeeds but the diff throws', () => {
    // The merge-base ancestry check passes, yet `git diff` fails (corrupt object,
    // git error). The change set is indeterminate, so classifyProvenance must
    // return a fail-closed relation rather than let the throw crash the verifier.
    const git = (args) => {
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return ''
      if (args[0] === 'diff' && args[1] === '--name-only') throw new Error('diff exploded')
      throw new Error('unexpected git ' + args.join(' '))
    }
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('divergent')
  })
})

describe('memoizeProvenance', () => {
  it('classifies each distinct (head, current) pair exactly once', () => {
    const calls = []
    const counting = (head, current) => { calls.push([head, current]); return { relation: 'equal', changed: [] } }
    const classify = memoizeProvenance(counting)
    // Same pair five times → underlying classifier invoked once.
    for (let i = 0; i < 5; i++) classify('BASE', 'HEAD1', { cwd: '.' })
    expect(calls).toEqual([['BASE', 'HEAD1']])
  })
  it('does not collapse distinct pairs, and returns the cached result verbatim', () => {
    let n = 0
    const counting = (head) => ({ relation: 'equal', changed: [], serial: n++, head })
    const classify = memoizeProvenance(counting)
    const a1 = classify('A', 'HEAD1')
    const b = classify('B', 'HEAD1')
    const a2 = classify('A', 'HEAD1') // cached — no new call
    expect(n).toBe(2) // only A and B were computed
    expect(a1).toBe(a2) // same cached object reference
    expect(b.head).toBe('B')
  })
  it('caches fail-closed relations too — a divergent verdict is not recomputed', () => {
    let calls = 0
    const counting = () => { calls++; return { relation: 'divergent', changed: [] } }
    const classify = memoizeProvenance(counting)
    expect(classify('BOGUS', 'HEAD1').relation).toBe('divergent')
    expect(classify('BOGUS', 'HEAD1').relation).toBe('divergent')
    expect(calls).toBe(1)
  })
  it('defaults to the real classifier when none is injected', () => {
    // No fake: distinct-but-equal heads short-circuit before any git call.
    expect(memoizeProvenance()('HEAD1', 'HEAD1').relation).toBe('equal')
  })
})

describe('EVIDENCE_ARTIFACT_RE', () => {
  it('matches only top-level docs/evidence JSON envelopes', () => {
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/shared-state.json')).toBe(true)
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/schema.json')).toBe(true)
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/README.md')).toBe(false)
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/forensics/x.json')).toBe(false)
    expect(EVIDENCE_ARTIFACT_RE.test('src/evidence.json')).toBe(false)
  })
})

describe('isDurableReleaseArtifact — path classification contract', () => {
  it('accepts evidence envelopes and the two release-metadata records (exact root paths only)', () => {
    expect(RELEASE_METADATA_PATHS).toEqual(['release-ledger.json', 'build/trust-roots.json'])
    for (const p of ['docs/evidence/approval.json', 'release-ledger.json', 'build/trust-roots.json']) {
      expect(isDurableReleaseArtifact(p), p).toBe(true)
    }
    // Same-named files elsewhere are not METADATA — they are tolerated only via
    // the registry-complement fallback (harmless non-subject paths), so the
    // metadata list stays exact-path.
    expect(RELEASE_METADATA_PATHS.includes('sub/release-ledger.json')).toBe(false)
    expect(isDurableReleaseArtifact('sub/release-ledger.json')).toBe(true)
  })
  it('fails closed on everything under docs/evidence that is not a top-level envelope', () => {
    for (const p of ['docs/evidence/forensics/raw.txt', 'docs/evidence/forensics/x.json', 'docs/evidence/README.md']) {
      expect(isDurableReleaseArtifact(p), p).toBe(false)
    }
  })
  it('rejects every registry-attested subject class', () => {
    for (const p of [
      'electron/quickstart.cjs', // main-process runtime
      'src/App.tsx', // renderer source
      'index.html', 'vite.config.ts', // renderer build inputs
      'hermes-plugin/business-shell/plugin.js', // plugin tree (all 5 categories)
      'installer/bootstrap.ps1', 'installer/business-bootstrap.nsi', 'installer/lib/common.ps1', // thin installer
      'package.json', 'package-lock.json', 'electron-builder.yml', // packaging + build config
      'build/icon.ico', // packaged asset
      'scripts/after-pack.cjs', 'scripts/lib/release/preflight.mjs', 'scripts/verify-release-contract.mjs', // build/release pipeline
      'scripts/plugin-sdk-contract.mjs', 'scripts/hermes-desktop-contract.json', // plugin contract (approval/shared-state subjects)
      'hermes-compat.json'
    ]) expect(isDurableReleaseArtifact(p), p).toBe(false)
  })
  it('tolerates docs prose, tests and non-subject tooling (claims are about registry subjects)', () => {
    for (const p of [
      'docs/RELEASING.md', 'docs/specs/versioning.md', 'README.md',
      'scripts/lib/release/preflight.test.mjs', 'electron/main.test.cjs', // tests never ship
      'scripts/lib/git-provenance.mjs' // verifier tooling runs as the HEAD version regardless
    ]) expect(isDurableReleaseArtifact(p), p).toBe(true)
  })
})

// The user-facing contract, proven against REAL git: a synthetic step-9 commit
// touching ONLY release-ledger.json + build/trust-roots.json classifies
// evidence-descendant; the same metadata plus a release script classifies
// code-descendant. Uses a throwaway repo — never this project's history.
describe('classifyProvenance against a real git repository', () => {
  let repo
  const g = (...args) => execFileSync(
    'git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }
  ).toString().trim()
  const put = (rel, content) => {
    const abs = path.join(repo, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'git-provenance-contract-'))
    g('init', '-q')
    put('base.txt', 'base\n')
    g('add', '-A'); g('commit', '-q', '-m', 'base')
  })
  afterAll(() => { try { rmSync(repo, { recursive: true, force: true }) } catch { /* best effort */ } })

  it('metadata-only commit → evidence-descendant; metadata+script commit → code-descendant', () => {
    const base = g('rev-parse', 'HEAD')
    put('release-ledger.json', '{"v":1}\n')
    put('build/trust-roots.json', '{"keys":{}}\n')
    g('add', '-A'); g('commit', '-q', '-m', 'chore(release): record published asset')
    const metadataHead = g('rev-parse', 'HEAD')
    const meta = classifyProvenance(base, metadataHead, { cwd: repo })
    expect(meta.relation).toBe('evidence-descendant')
    expect(meta.changed.sort()).toEqual(['build/trust-roots.json', 'release-ledger.json'])

    put('scripts/lib/release/gather.mjs', '// changed\n')
    g('add', '-A'); g('commit', '-q', '-m', 'fix: touch a release script')
    const codeHead = g('rev-parse', 'HEAD')
    expect(classifyProvenance(base, codeHead, { cwd: repo }).relation).toBe('code-descendant')
    // From the metadata commit forward the script is the ONLY change — still code.
    expect(classifyProvenance(metadataHead, codeHead, { cwd: repo }).relation).toBe('code-descendant')
  })
})

describe('checkCorrespondence relation gate (injected classifier)', () => {
  const current = { app: 'a', range: 'r', git_head: 'HEAD1', cwd: '.' }
  const base = { app_version: 'a', hermes_range: 'r', git_head: 'X' }
  const errs = (git_state, relation) => {
    const out = []
    checkCorrespondence({ ...base, git_state }, current, m => out.push(m), () => ({ relation }))
    return out
  }
  it('committed passes on equal or evidence-descendant, fails otherwise', () => {
    expect(errs('committed', 'equal')).toEqual([])
    expect(errs('committed', 'evidence-descendant')).toEqual([])
    expect(errs('committed', 'code-descendant').join()).toMatch(/not valid for a committed/)
    expect(errs('committed', 'divergent').join()).toMatch(/not valid for a committed/)
  })
  it('working-tree tolerates code-descendant but still rejects bogus/stale heads', () => {
    expect(errs('working-tree', 'code-descendant')).toEqual([])
    expect(errs('working-tree', 'divergent').join()).toMatch(/not valid for a working-tree/)
    expect(errs('working-tree', 'unknown').join()).toMatch(/not valid for a working-tree/)
  })
})
