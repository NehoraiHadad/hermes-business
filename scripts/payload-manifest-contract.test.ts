import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOORS, PAYLOAD_SECTIONS, ROOT_PAYLOAD_ITEMS } from './payload-manifest.mjs'

// Drift test for the four independent install-payload staging surfaces. This
// exists because they have drifted silently before: scripts/e2e-bootstrap-clean.ps1
// staged plugin.js + business-bootstrap.SKILL.md only, while the real install
// doors (NSIS, Electron, installer/lib/BusinessInstall.ps1) also shipped
// tachles-welcome.SKILL.md and business-partner.SKILL.md — the E2E hard-threw
// "Cannot hash a file that does not exist" the moment BusinessInstall.ps1 ran
// against the incomplete staged payload. Adding a payload item to one door and
// forgetting another must break this test.

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

// installer/lib/*.ps1 is one dot-sourced library — BusinessInstall.ps1 requires
// the payload, but some of what it requires (e.g. the dashboard section) is
// implemented in a sibling module (BackendEnable.ps1). Concatenating every
// lib file matches the door as it actually behaves at runtime.
const businessInstallDoor = ['BusinessInstall.ps1', 'BackendEnable.ps1']
  .map(name => read(`installer/lib/${name}`))
  .join('\n')

// electron/plugin-install.cjs is the entry point, but the dashboard section is
// staged by the sibling module it calls into (backend-install.cjs).
const electronDoor = [read('electron/plugin-install.cjs'), read('electron/backend-install.cjs')].join('\n')

const nsisDoor = read('installer/business-bootstrap.nsi')
const e2eDoor = read('scripts/e2e-bootstrap-clean.ps1')

const doorText: Record<(typeof DOORS)[number], string> = {
  nsis: nsisDoor,
  electron: electronDoor,
  businessInstall: businessInstallDoor,
  e2e: e2eDoor
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Per-door syntax used to reference a ROOT payload item by its staged filename.
function rootItemPresent(door: (typeof DOORS)[number], text: string, name: string): boolean {
  const escaped = escapeRegExp(name)
  switch (door) {
    case 'nsis':
      // e.g. File /oname=tachles-welcome.SKILL.md "..\hermes-plugin\..."
      return new RegExp(`File\\s+/oname=${escaped}\\b`).test(text)
    case 'electron':
      // e.g. path.join(stagingRoot, 'tachles-welcome.SKILL.md')
      return new RegExp(`path\\.join\\(stagingRoot,\\s*'${escaped}'\\)`).test(text)
    case 'businessInstall':
      // e.g. $welcomeSkillSource = Join-Path $PayloadRoot 'tachles-welcome.SKILL.md'
      return new RegExp(`Join-Path\\s+\\$PayloadRoot\\s+'${escaped}'`).test(text)
    case 'e2e':
      // e.g. Copy-Item ... -Destination (Join-Path $payloadRoot 'tachles-welcome.SKILL.md')
      return new RegExp(`Join-Path\\s+\\$payloadRoot\\s+'${escaped}'`).test(text)
    default:
      return false
  }
}

// Per-door syntax used to reference a payload SECTION directory by name.
function sectionPresent(door: (typeof DOORS)[number], text: string, name: string): boolean {
  switch (door) {
    case 'nsis':
      return text.includes(`$INSTDIR\\${name}`)
    case 'electron':
      return text.includes(`'${name}'`)
    case 'businessInstall':
      return text.includes(`'${name}'`)
    case 'e2e':
      return text.includes(`'${name}'`)
    default:
      return false
  }
}

describe('install payload manifest sync (nsis / electron / businessInstall / e2e)', () => {
  for (const item of ROOT_PAYLOAD_ITEMS) {
    for (const door of item.doors) {
      it(`${door} stages root payload item "${item.name}"`, () => {
        expect(rootItemPresent(door, doorText[door], item.name)).toBe(true)
      })
    }
  }

  for (const section of PAYLOAD_SECTIONS) {
    for (const door of section.doors) {
      it(`${door} references payload section "${section.name}/"`, () => {
        expect(sectionPresent(door, doorText[door], section.name)).toBe(true)
      })
    }
  }

  it('every ROOT_PAYLOAD_ITEMS repoSource exists in the repository', () => {
    for (const item of ROOT_PAYLOAD_ITEMS) {
      expect(() => read(item.repoSource), item.repoSource).not.toThrow()
    }
  })

  it('DOORS matches the doors referenced across the manifest', () => {
    const referenced = new Set<string>()
    for (const item of ROOT_PAYLOAD_ITEMS) for (const door of item.doors) referenced.add(door)
    for (const section of PAYLOAD_SECTIONS) for (const door of section.doors) referenced.add(door)
    for (const door of referenced) expect(DOORS).toContain(door)
  })
})
