// Child-environment sanitization (ALLOWLIST) + launch config for the real-loader E2E.
//
// The installed Hermes Desktop main process COPIES its own environment onto the
// Python backend it spawns, so ANY stray var — a *_BASE_URL, an HTTP(S)_PROXY, an
// SSH_AUTH_SOCK, a GH_CONFIG_DIR, a PYTHONPATH, a BROWSER_CDP_URL — can silently
// re-point that backend at a real account, config dir or debugger. A denylist can
// never enumerate every such var, so we INVERT it: keep only a small allowlist of
// system vars Electron/Chromium genuinely need to boot, RE-HOME every home/cache/
// config var into the sandbox, and DROP everything else. The app-facing HERMES_*
// vars are re-set deterministically afterwards.
//
// Verified main-process reads (installed apps/desktop/electron/main.ts):
//   HERMES_HOME (535), HERMES_DESKTOP_USER_DATA_DIR (246), HERMES_DESKTOP_HERMES
//   (3871), HERMES_DESKTOP_CWD (3676). HERMES_DESKTOP_HERMES_ROOT is a STICKY dev
//   override re-pointing the backend AND git self-updater — it must NEVER be set.

import path from 'node:path'

// Case-insensitive allowlist of vars that pass through UNCHANGED — the minimum
// for Windows process + Electron/Chromium startup. Anything not here (and not
// re-homed or owned below) is dropped, so an unknown var can never leak.
const ALLOWED_PASSTHROUGH = new Set([
  'path', 'pathext', 'systemroot', 'systemdrive', 'windir', 'comspec', 'os',
  'number_of_processors', 'processor_architecture', 'processor_architew6432',
  'processor_identifier', 'processor_level', 'processor_revision',
  'programdata', 'programfiles', 'programfiles(x86)', 'programw6432',
  'commonprogramfiles', 'commonprogramfiles(x86)', 'commonprogramw6432',
  'allusersprofile', 'public', 'computername', 'username', 'userdomain',
  'userdomain_roamingprofile', 'logonserver', 'sessionname', 'driverdata'
])

// Home/cache/config vars re-pointed INTO the sandbox (never the live value). Any
// inbound copy is dropped by the allowlist first, then set explicitly.
export const REHOMED_VARS = Object.freeze([
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'
])

export const HERMES_LAUNCH_VARS = Object.freeze([
  'HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_HERMES', 'HERMES_DESKTOP_CWD'
])

export const OWNED_LAUNCH_VARS = Object.freeze([...HERMES_LAUNCH_VARS, ...REHOMED_VARS])
export const FORBIDDEN_LAUNCH_VARS = Object.freeze(['HERMES_DESKTOP_HERMES_ROOT'])

const OWNED_LOWER = new Set(OWNED_LAUNCH_VARS.map(n => n.toLowerCase()))

// Defense-in-depth classifier: even a var mistakenly added to the allowlist is
// caught if its NAME is secret/provider/channel/URL/proxy-shaped. Broadened to
// the review's negative set (JWT, PROXY, *_BASE_URL, CDP, PYTHONPATH, SSH_AUTH…).
const SENSITIVE_NAME_RE =
  /(API|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|KEY|APIKEY|OAUTH|BEARER|SESSION_?TOKEN|COOKIE|WEBHOOK|PRIVATE|SIGNING|SALT|NONCE|JWT|PROXY|_URL$|_BASE_URL|CDP|PYTHONPATH|SSH_AUTH|GH_CONFIG|XDG_(?!CONFIG_HOME$|CACHE_HOME$|DATA_HOME$)|_HOST$|_ENDPOINT$)/i
const PROVIDER_NAME_RE =
  /(OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE|VERTEX|AZURE|AWS|COHERE|MISTRAL|GROQ|OLLAMA|TELEGRAM|WHATSAPP|TWILIO|SLACK|DISCORD|MESSENGER|META_|SIGNAL|SMTP|IMAP|SENDGRID|MAILGUN|STRIPE|GITHUB|NPM_TOKEN|HF_|HUGGING|CHANNEL|PROVIDER)/i

export function isSensitiveName(name) {
  return SENSITIVE_NAME_RE.test(name) || PROVIDER_NAME_RE.test(name)
}

export function isAllowedPassthrough(name) {
  return ALLOWED_PASSTHROUGH.has(String(name).toLowerCase())
}

export function isOwnedVar(name) {
  return OWNED_LOWER.has(String(name).toLowerCase())
}

/**
 * Keys in the FINAL env that are neither owned nor allow-listed (leaked through),
 * plus any forbidden or sensitive-shaped name (an allowlist mistake). Used both to
 * assert the launch env and as the post-condition guard.
 */
export function findLeakKeys(env) {
  return Object.keys(env).filter(name => {
    if (FORBIDDEN_LAUNCH_VARS.includes(name)) return true
    if (isSensitiveName(name)) return true
    return !isOwnedVar(name) && !isAllowedPassthrough(name)
  })
}

/** Keep ONLY allow-listed passthrough vars. Everything else (secrets, providers,
 *  HERMES_*, home/cache/config, unknown vars) is dropped; owned + re-homed vars
 *  are re-set deterministically in buildChildEnv. */
export function sanitizeChildEnv(sourceEnv) {
  const clean = {}
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (value == null) continue
    if (isAllowedPassthrough(name)) clean[name] = value
  }
  return clean
}

/**
 * Build the fully-sanitized, fully-isolated child env. Re-homes HOME/USERPROFILE/
 * HOMEDRIVE/HOMEPATH/APPDATA/LOCALAPPDATA/TEMP/TMP + the XDG cache/config dirs into
 * the sandbox so no on-disk state escapes it. Throws (fail closed) if a forbidden
 * or non-allowlisted var survives or an owned var is missing.
 */
export function buildChildEnv({ base, sandbox, cliBin }) {
  if (!cliBin) throw new Error('buildChildEnv: cliBin (HERMES_DESKTOP_HERMES) is required')
  const env = sanitizeChildEnv(base)
  env.HERMES_HOME = sandbox.hermesHome
  env.HERMES_DESKTOP_USER_DATA_DIR = sandbox.userData
  env.HERMES_DESKTOP_HERMES = cliBin
  env.HERMES_DESKTOP_CWD = sandbox.cwd
  env.HOME = sandbox.userProfile
  env.USERPROFILE = sandbox.userProfile
  const parsed = path.parse(sandbox.userProfile)
  env.HOMEDRIVE = parsed.root.replace(/[\\/]+$/, '') || parsed.root
  env.HOMEPATH = sandbox.userProfile.slice(env.HOMEDRIVE.length) || '\\'
  env.APPDATA = sandbox.appData
  env.LOCALAPPDATA = sandbox.localAppData
  env.TEMP = sandbox.tmp
  env.TMP = sandbox.tmp
  env.XDG_CONFIG_HOME = sandbox.xdgConfig
  env.XDG_CACHE_HOME = sandbox.xdgCache
  env.XDG_DATA_HOME = sandbox.xdgData
  assertChildEnv(env)
  return env
}

/** Post-condition guard: no forbidden var, no leaked/sensitive var, owned set. */
export function assertChildEnv(env) {
  for (const forbidden of FORBIDDEN_LAUNCH_VARS) {
    if (forbidden in env) throw new Error(`launch env still contains forbidden var ${forbidden}`)
  }
  const leaks = findLeakKeys(env)
  if (leaks.length) throw new Error(`launch env contains non-allowlisted/sensitive vars: ${leaks.join(', ')}`)
  for (const owned of OWNED_LAUNCH_VARS) {
    if (!env[owned]) throw new Error(`launch env missing owned var ${owned}`)
  }
  return true
}
