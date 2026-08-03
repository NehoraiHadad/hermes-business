import path from 'node:path'

const E2E_SEGMENT = /(?:hermes-business-e2e|hermes-qa-home|hermes-e2e-home)/i

export function splitPath(value = '') {
  return String(value).split(path.delimiter).map(item => item.trim()).filter(Boolean)
}

export function isHermesTestPathEntry(entry) {
  return E2E_SEGMENT.test(String(entry))
}

export function cleanHermesTestPath(value = '') {
  const entries = splitPath(value)
  const removed = entries.filter(isHermesTestPathEntry)
  const kept = entries.filter(entry => !isHermesTestPathEntry(entry))
  return { original: String(value), cleaned: kept.join(path.delimiter), removed, kept }
}

export function cleanProcessEnv(source = process.env) {
  const env = { ...source }
  delete env.HERMES_HOME
  for (const key of Object.keys(env)) {
    if (/^HERMES_BUSINESS_QA_/.test(key)) delete env[key]
  }
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
  env[pathKey] = cleanHermesTestPath(env[pathKey]).cleaned
  return env
}
