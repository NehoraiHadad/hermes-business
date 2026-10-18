import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import policy from '../../hermes-compat.json'
import { HERMES_COMPAT_RANGE, HERMES_MIN_VERSION, isVersionSupported } from './hermes/compat'

const read = (file: string) => readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
describe('official stable Hermes policy', () => {
  it('has a minimum without an upper ceiling or a custom engine pin', () => {
    expect(HERMES_MIN_VERSION).toBe(policy.minVersion)
    expect(HERMES_COMPAT_RANGE).toBe(`>=${policy.minVersion}`)
    expect(policy).not.toHaveProperty('maxVersionExclusive')
    expect(policy).not.toHaveProperty('communityEngine')
    expect(policy.releaseChannel.repository).toBe('NousResearch/hermes-agent')
    expect(policy.releaseChannel.channel).toBe('stable')
    expect(isVersionSupported(policy.verifiedInstalledVersion)).toBe(true)
    expect(isVersionSupported('1.0.0')).toBe(true)
  })
  it('keeps standalone installer and Python capability baseline aligned', () => {
    expect(read('installer/bootstrap.ps1')).toContain(`[version]'${policy.minVersion}'`)
    const python = read('hermes-plugin/business-whatsapp-policy/contract.py')
    expect(python).toContain(`MINIMUM_HERMES_VERSION = (${policy.minVersion.split('.').map(Number).join(', ')})`)
    expect(python).toContain(`frozenset({"${policy.verifiedInstalledVersion}"})`)
  })
  it('ships the canonical policy with the Electron application', () => {
    expect(JSON.parse(read('package.json')).build.files).toContain('hermes-compat.json')
  })
})
