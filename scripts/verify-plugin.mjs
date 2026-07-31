import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HERMES_COMPAT_RANGE, SDK_SYMBOLS } from './plugin-sdk-contract.mjs'

const path = resolve('hermes-plugin/business-shell/plugin.js')
const bootstrapSkillPath = resolve('hermes-plugin/business-shell/skills/business-bootstrap/SKILL.md')
const source = await readFile(path, 'utf8')
const bootstrapSkill = await readFile(bootstrapSkillPath, 'utf8')
const failures = []
const importBlock = source.match(/import\s*\{([\s\S]*?)\}\s*from '@hermes\/plugin-sdk'/)?.[1] || ''
const importedSymbols = importBlock.split(',').map(value => value.trim()).filter(Boolean)

if (!source.includes("from '@hermes/plugin-sdk'")) failures.push('missing official @hermes/plugin-sdk import')
if (!source.includes("id: 'business-shell'")) failures.push('plugin id is missing')
if (!source.includes('ROUTES_AREA')) failures.push('route contribution is missing')
if (!source.includes('SIDEBAR_NAV_AREA')) failures.push('sidebar contribution is missing')
if (!source.includes('business-bootstrap')) failures.push('guided first-run Skill is not referenced')
if (source.match(/from ['"](@\/|electron|fs|node:)/)) failures.push('plugin imports a forbidden module')
if (/<[A-Z][A-Za-z]*[ >]/.test(source)) failures.push('disk plugin contains JSX, which Hermes does not compile')
if (!bootstrapSkill.includes('name: business-bootstrap')) failures.push('business-bootstrap Skill metadata is missing')
if (!bootstrapSkill.includes('Ask one question at a time')) failures.push('business-bootstrap lacks progressive questions')
if (!bootstrapSkill.includes('Never request API keys')) failures.push('business-bootstrap lacks secret-handling rules')
if (!bootstrapSkill.includes('Recommend one connection')) failures.push('business-bootstrap lacks connection guidance')
for (const symbol of importedSymbols) {
  if (!SDK_SYMBOLS.includes(symbol)) {
    failures.push(`plugin imports ${symbol}, which is absent from the pinned ${HERMES_COMPAT_RANGE} SDK contract`)
  }
}

const sdkPath = join(
  process.env.LOCALAPPDATA || '',
  'hermes',
  'hermes-agent',
  'apps',
  'desktop',
  'src',
  'sdk',
  'index.ts'
)
try {
  await access(sdkPath)
  const sdk = await readFile(sdkPath, 'utf8')
  for (const symbol of importedSymbols) {
    if (!new RegExp(`\\b${symbol}\\b`).test(sdk)) {
      failures.push(`installed Hermes Plugin SDK is missing ${symbol}`)
    }
  }
} catch {
  console.log(`Hermes SDK source absent; validated imports against pinned contract ${HERMES_COMPAT_RANGE}.`)
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('Desktop plugin contract checks passed.')
