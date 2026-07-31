import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = join(root, 'hermes-plugin', 'business-shell', 'plugin.js')
const bootstrapSkillSource = join(
  root,
  'hermes-plugin',
  'business-shell',
  'skills',
  'business-bootstrap',
  'SKILL.md'
)
const profile = process.env.HERMES_PROFILE?.trim()
const baseHome =
  process.env.HERMES_HOME?.trim() ||
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'hermes')
    : join(process.env.HOME || '', '.hermes'))
const hermesHome = profile ? join(baseHome, 'profiles', profile) : baseHome
const targetDir = join(hermesHome, 'desktop-plugins', 'business-shell')
const target = join(targetDir, 'plugin.js')
const bootstrapSkillDir = join(hermesHome, 'skills', 'productivity', 'business-bootstrap')
const bootstrapSkillTarget = join(bootstrapSkillDir, 'SKILL.md')

await mkdir(targetDir, { recursive: true })
await cp(source, target)
await mkdir(bootstrapSkillDir, { recursive: true })
await cp(bootstrapSkillSource, bootstrapSkillTarget)

const bytes = await readFile(target)
const digest = createHash('sha256').update(bytes).digest('base64')
const receipt = {
  id: 'business-shell',
  installedAt: new Date().toISOString(),
  source,
  target,
  bootstrapSkill: bootstrapSkillTarget,
  integrity: `sha256-${digest}`
}
await writeFile(join(targetDir, 'install-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

console.log(`Installed Hermes Business Shell:\n${target}`)
console.log(`Installed first-run Skill:\n${bootstrapSkillTarget}`)
console.log('Open Hermes Desktop and choose “לעסק” in the sidebar. Changes hot-reload automatically.')
