import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(
  fileURLToPath(new URL('../installer/lib/BusinessInstall.ps1', import.meta.url)),
  'utf8'
)
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

function filterIncludes(filters: string[], relativePath: string) {
  return filters.some(filter =>
    filter === relativePath ||
    (filter.endsWith('/**/*') && relativePath.startsWith(filter.slice(0, -4)))
  )
}

function stageResource(resource: { from: string; to: string; filter: string[] }, payloadRoot: string) {
  const sourceRoot = join(repoRoot, resource.from)
  const targetRoot = join(payloadRoot, resource.to)
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(source)
        continue
      }
      const rel = relative(sourceRoot, source).replaceAll('\\', '/')
      if (!filterIncludes(resource.filter, rel)) continue
      const target = join(targetRoot, rel)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
    }
  }
  visit(sourceRoot)
}

describe('community installer single-home contract', () => {
  it('renders the community skills against the ONE real HERMES_HOME (no second root)', () => {
    // 2026-08-16 decision: community is a capability of the single Hermes.
    expect(installer).not.toContain('TachlesCommunity')
    expect(installer).toContain(".Replace('{{HOME_DIR}}', $HermesHome)")
    expect(installer).toContain("$communityContract = Join-Path $HermesHome 'tachles\\community.yaml'")
    expect(installer).toContain("$communityEngineDir = Join-Path $HermesHome 'hermes-agent'")
    expect(installer).toContain(".Replace('{{INSTALL_ROOT}}', $communityEngineDir)")
  })

  it('imports ESM js-yaml and argparse from an electron-builder-shaped payload without manifest drift', async () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    const resources = pkg.build.extraResources as Array<{ from: string; filter?: string[] }>
    const yamlResource = resources.find(item => item.from === 'node_modules/js-yaml')!
    const argparseResource = resources.find(item => item.from === 'node_modules/argparse')!
    const yamlManifest = JSON.parse(readFileSync(join(repoRoot, 'node_modules/js-yaml/package.json'), 'utf8'))
    const argparseManifest = JSON.parse(readFileSync(join(repoRoot, 'node_modules/argparse/package.json'), 'utf8'))

    expect(filterIncludes(yamlResource.filter!, yamlManifest.exports['.'].require.replace(/^\.\//, ''))).toBe(true)
    expect(filterIncludes(yamlResource.filter!, yamlManifest.module.replace(/^\.\//, ''))).toBe(true)
    expect(filterIncludes(argparseResource.filter!, argparseManifest.main)).toBe(true)
    expect(argparseResource.filter).not.toContain('index.js')

    const payloadRoot = mkdtempSync(join(tmpdir(), 'tachles-community-payload-'))
    try {
      stageResource(yamlResource, payloadRoot)
      stageResource(argparseResource, payloadRoot)
      const yamlRoot = join(payloadRoot, yamlResource.to)
      const yamlEsm = await import(`${pathToFileURL(join(yamlRoot, yamlManifest.module)).href}?smoke=${Date.now()}`)
      const argparse = require(join(payloadRoot, argparseResource.to))
      expect(yamlEsm.load('mode: community')).toEqual({ mode: 'community' })
      expect(typeof argparse.ArgumentParser).toBe('function')
    } finally {
      rmSync(payloadRoot, { recursive: true, force: true })
    }
  })
})
