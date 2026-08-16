const fs = require('node:fs')
const path = require('node:path')

const COMMUNITY_DIR_NAME = 'TachlesCommunity'
const COMMUNITY_ACTIVATION_FILE = '.tachles-community.json'
const COMMUNITY_PREFERRED_PORT = 9121
const COMMUNITY_PORT_RANGE = 20

function communityLayout(env = process.env) {
  const localAppData = String(env.LOCALAPPDATA || '').trim()
  if (!localAppData) return null
  const root = path.join(localAppData, COMMUNITY_DIR_NAME)
  const engine = path.join(root, 'engine')
  return {
    root,
    home: path.join(root, 'home'),
    activation: path.join(root, 'home', COMMUNITY_ACTIVATION_FILE),
    contract: path.join(root, 'community.yaml'),
    engine,
    python: path.join(engine, '.venv', 'Scripts', 'python.exe')
  }
}

function parseCommunityActivation(text) {
  let marker
  try {
    marker = JSON.parse(text)
  } catch {
    return { active: false, reason: 'The community activation marker is not valid JSON' }
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return { active: false, reason: 'The community activation marker must be an object' }
  }
  if (marker.schema !== 1 || marker.mode !== 'community' || typeof marker.active !== 'boolean') {
    return { active: false, reason: 'The community activation marker has an unsupported schema or mode' }
  }
  return marker.active
    ? { active: true, reason: null }
    : { active: false, reason: 'Community mode is explicitly inactive' }
}

function inspectCommunityInstall({ env = process.env, exists = fs.existsSync, readFile = fs.readFileSync } = {}) {
  const layout = communityLayout(env)
  if (!layout) {
    return { provisioned: false, active: false, target: 'business', layout: null, reason: 'LOCALAPPDATA is unavailable' }
  }
  const required = [layout.contract, layout.python, path.join(layout.home, 'config.yaml')]
  const missing = required.filter(file => !exists(file))
  if (missing.length > 0) {
    return {
      provisioned: false,
      active: false,
      target: 'business',
      layout,
      reason: 'The community runtime is not provisioned yet'
    }
  }
  if (!exists(layout.activation)) {
    return {
      provisioned: true,
      active: false,
      target: 'business',
      layout,
      reason: 'Community runtime files exist, but no activation marker is present'
    }
  }
  let activation
  try {
    activation = parseCommunityActivation(String(readFile(layout.activation, 'utf8')))
  } catch {
    activation = { active: false, reason: 'The community activation marker cannot be read' }
  }
  return {
    provisioned: true,
    active: activation.active,
    target: activation.active ? 'community' : 'business',
    layout,
    reason: activation.reason
  }
}

const COMMUNITY_API_PATTERNS = Object.freeze([
  /^\/api\/messaging\/whatsapp\/onboarding\/start$/,
  /^\/api\/messaging\/whatsapp\/onboarding\/[A-Za-z0-9_-]+(?:\/apply)?$/,
  /^\/api\/providers\/oauth\?profile=default$/,
  /^\/api\/providers\/oauth\/[A-Za-z0-9._~%-]+\/start\?profile=default$/,
  /^\/api\/providers\/oauth\/[A-Za-z0-9._~%-]+\/poll\/[A-Za-z0-9._~%-]+\?profile=default$/,
  /^\/api\/providers\/oauth\/sessions\/[A-Za-z0-9._~%-]+\?profile=default$/,
  /^\/api\/model\/recommended-default\?provider=[A-Za-z0-9._~%-]+$/,
  /^\/api\/model\/set$/
])

function assertAllowedCommunityApiEndpoint(endpoint) {
  if (
    typeof endpoint !== 'string' ||
    endpoint.length > 512 ||
    /[\s\\#]|%2e|%2f|%5c/i.test(endpoint) ||
    !COMMUNITY_API_PATTERNS.some(pattern => pattern.test(endpoint))
  ) {
    throw new Error('Community API endpoint is not allowed')
  }
  return endpoint
}

module.exports = {
  COMMUNITY_DIR_NAME,
  COMMUNITY_ACTIVATION_FILE,
  COMMUNITY_PREFERRED_PORT,
  COMMUNITY_PORT_RANGE,
  communityLayout,
  parseCommunityActivation,
  inspectCommunityInstall,
  assertAllowedCommunityApiEndpoint
}
