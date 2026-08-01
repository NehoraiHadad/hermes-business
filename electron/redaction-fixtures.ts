// Shared, obviously-fake fixtures for the redactor unit tests and the
// diagnostics end-to-end payload test. Every secret value is deliberately
// prefixed with FAKE/000 padding so it can never be mistaken for — or resemble —
// a real user credential, while still matching the production key shapes.

/** Synthetic secrets, one per shape the diagnostics redactor must strip. */
export const FAKE_SECRETS = {
  bearer: 'Bearer FAKEfake000NOTaRealToken000pad',
  openai: 'sk-FAKEfake000example000key',
  google: 'AIzaFAKEfake000example000example0',
  telegram: '1234567:FAKEfake000example000bottoken',
  refreshQuery: 'refresh_token=FAKEfake000refresh000value',
  accessJson: '"access_token":"FAKEfake000access000value"'
}

/** Every raw secret value (without its field wrapper) that must not survive. */
export const FAKE_SECRET_VALUES = [
  'FAKEfake000NOTaRealToken000pad',
  'sk-FAKEfake000example000key',
  'AIzaFAKEfake000example000example0',
  '1234567:FAKEfake000example000bottoken',
  'FAKEfake000refresh000value',
  'FAKEfake000access000value'
]

/** A synthetic personal email — local part must be stripped, domain kept. */
export const FAKE_EMAIL = 'owner.person@shop.example'

/** Absolute home paths whose account/login segment (`testuser`) must vanish. */
export const PERSONAL_PATHS = {
  windows: 'C:\\Users\\testuser\\AppData\\Roaming\\Hermes\\config.json',
  windowsFwd: 'C:/Users/testuser/AppData/Roaming',
  posixHome: '/home/testuser/.hermes/config.json',
  macUsers: '/Users/testuser/Library/Application Support/Hermes'
}

/** The account/login name that must never appear in redacted output. */
export const PERSONAL_USERNAME = 'testuser'

/** A unique marker standing in for chat/message/business content. */
export const BUSINESS_MARKER = '__BIZ_CONTENT_9f3a2c__'
