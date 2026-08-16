export const HERMES_COMPAT_RANGE = '>=0.19.0 <0.21.0'

// Reviewed against Hermes Desktop SDK v0.20.1. Build-time validation uses this
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
