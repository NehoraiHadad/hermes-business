import { readFileSync } from 'node:fs'
const policy = JSON.parse(readFileSync(new URL('../hermes-compat.json', import.meta.url), 'utf8'))
export const HERMES_COMPAT_RANGE = policy.range

// Reviewed against Hermes Desktop SDK v0.22.2. Build-time validation uses this
// snapshot when Hermes is not installed; bootstrap separately checks the real
// SDK before installing the plugin.
export const SDK_SYMBOLS = Object.freeze([
  'Badge',
  'Button',
  'Input',
  'Loader',
  'PALETTE_AREA',
  'ROUTES_AREA',
  'SIDEBAR_NAV_AREA',
  'StatusDot',
  'Textarea',
  'evaluateRuntimeReadiness',
  'host',
  'useValue'
])
