import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const path = resolve('hermes-plugin/business-shell/plugin.js')
const bootstrapSkillPath = resolve('hermes-plugin/business-shell/skills/business-bootstrap/SKILL.md')
const source = await readFile(path, 'utf8')
const bootstrapSkill = await readFile(bootstrapSkillPath, 'utf8')
const failures = []

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
  const importBlock = source.match(/import\s*\{([\s\S]*?)\}\s*from '@hermes\/plugin-sdk'/)?.[1] || ''
  for (const symbol of importBlock.split(',').map(value => value.trim()).filter(Boolean)) {
    if (!new RegExp(`\\b${symbol}\\b`).test(sdk)) {
      failures.push(`installed Hermes Plugin SDK is missing ${symbol}`)
    }
  }
} catch {
  console.warn('Hermes Plugin SDK source is not installed; installer-time contract check will enforce compatibility.')
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('Desktop plugin contract checks passed.')
