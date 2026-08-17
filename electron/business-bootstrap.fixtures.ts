import fs from 'node:fs'
import path from 'node:path'
import { COMMUNITY_REQUIRED_FILES } from './plugin-install.cjs'
import { DESKTOP_BACKEND_FILES, WHATSAPP_POLICY_PLUGIN_FILES } from './paths.cjs'

// The complete set of files stageBusinessBootstrap({ isPackaged: true }) demands
// under <resources>/business-bootstrap. Both install-path suites write their
// fixture through here so the packaged payload shape is described once.

export const PACKAGED_BOOTSTRAP_ROOT_FILES = [
  'bootstrap.ps1',
  'bootstrap-companion.ps1',
  'plugin.js',
  'business-bootstrap.SKILL.md',
  'tachles-welcome.SKILL.md',
  'business-partner.SKILL.md'
]

export const PACKAGED_BOOTSTRAP_LIBRARY_FILES = ['Logging.ps1', 'BusinessInstall.ps1', 'enable_plugin.py']

export function writePackagedBootstrapPayload(resourcesPath: string) {
  const payload = path.join(resourcesPath, 'business-bootstrap')
  const write = (relative: string) => {
    const target = path.join(payload, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, relative)
  }
  for (const name of PACKAGED_BOOTSTRAP_ROOT_FILES) write(name)
  for (const name of PACKAGED_BOOTSTRAP_LIBRARY_FILES) write(path.join('lib', name))
  for (const name of DESKTOP_BACKEND_FILES) write(path.join('dashboard', name))
  for (const name of WHATSAPP_POLICY_PLUGIN_FILES) write(path.join('whatsapp-policy', name))
  for (const name of COMMUNITY_REQUIRED_FILES) write(path.join('community', name))
  return payload
}
