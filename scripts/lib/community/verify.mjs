// Community-mode drift verification. PURE — reads arrive via callbacks.
//
// The engine REWRITES config.yaml (comments stripped, keys reordered — observed
// live 2026-08-14, spec §3.2), so config files are never compared as text.
// Instead both sides are parsed and only the generator-OWNED keys are compared
// as VALUES:
//   * the ROOT config.yaml compares the full owned-gate view (routes, global
//     acceptance gates, admin DM allowlist, admin toolset, write approvals);
//   * each profiles/<space>/config.yaml compares the PROFILE owned view for
//     THAT space (§2.1: the shared `village` space's toolset includes
//     session_search, isolated spaces stay on the fenced set without it) —
//     spec §6.1: an absent/drifted profile config silently reopens the FULL
//     default whatsapp toolset for that space;
//   * `.env` compares the owned KEYS only (the engine appends its own entries,
//     e.g. pairing writes — those are not drift);
//   * profile_routes is read from EITHER the top-level or gateway.profile_routes
//     (the engine accepts both spellings — docs/profile-routing.md);
//   * list-valued gates (group_allow_from, admins, toolsets, mention_patterns)
//     compare as order-insensitive sets — a reorder is not drift;
//   * routes compare as a set of normalized {name, platform, chat_id, profile}.
//
// SOUL.md, knowledge skills and the installed admin skills are OURS alone —
// the engine does not rewrite them — so they compare by SHA-256 over
// line-ending-normalized content.

import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { SHARED_SPACE } from './contract.mjs'
import {
  ADMIN_TOOLSET,
  GROUP_TOOLSET,
  HISTORY_BACKFILL_LIMIT,
  OWNED_ENV,
  SHARED_TOOLSET,
  buildGatewayConfig,
  buildProfileConfig,
  buildRoutes,
  wakeWordPattern
} from './generate.mjs'

export function contentChecksum(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

const sortedSet = list => [...new Set((list ?? []).map(String))].sort()

/** Extract the generator-owned EFFECTIVE view from parsed ROOT config data. */
export function effectiveOwnedView(cfgData) {
  const cfg = cfgData && typeof cfgData === 'object' && !Array.isArray(cfgData) ? cfgData : {}
  const gateway = cfg.gateway && typeof cfg.gateway === 'object' ? cfg.gateway : {}
  const whatsapp = cfg.whatsapp && typeof cfg.whatsapp === 'object' ? cfg.whatsapp : {}
  const routesRaw = Array.isArray(cfg.profile_routes)
    ? cfg.profile_routes
    : Array.isArray(gateway.profile_routes)
      ? gateway.profile_routes
      : []
  const routes = routesRaw
    .map(r => ({
      name: String(r?.name ?? ''),
      platform: String(r?.platform ?? ''),
      chat_id: String(r?.chat_id ?? ''),
      profile: String(r?.profile ?? '')
    }))
    // Plain code-unit comparison — never a locale-sensitive collator (matches
    // the subject-hash determinism rule).
    .sort((a, b) => (a.profile + '\0' + a.chat_id < b.profile + '\0' + b.chat_id ? -1 : 1))
  return {
    'gateway.multiplex_profiles': gateway.multiplex_profiles === true,
    profile_routes: routes,
    'whatsapp.dm_policy': whatsapp.dm_policy,
    'whatsapp.allow_from': sortedSet(whatsapp.allow_from),
    'whatsapp.group_policy': whatsapp.group_policy,
    'whatsapp.group_allow_from': sortedSet(whatsapp.group_allow_from),
    'whatsapp.allow_admin_from': sortedSet(whatsapp.allow_admin_from),
    'whatsapp.group_allow_admin_from': sortedSet(whatsapp.group_allow_admin_from),
    'whatsapp.require_mention': whatsapp.require_mention === true,
    'whatsapp.mention_patterns': sortedSet(whatsapp.mention_patterns),
    'whatsapp.history_backfill': whatsapp.history_backfill === true,
    'whatsapp.history_backfill_limit': whatsapp.history_backfill_limit,
    'platform_toolsets.whatsapp': sortedSet(cfg.platform_toolsets?.whatsapp),
    'memory.write_approval': cfg.memory?.write_approval === true,
    'skills.write_approval': cfg.skills?.write_approval === true
  }
}

/** The owned view the CONTRACT demands — derived without any existing config,
 * because every owned key is fully determined by the contract. */
export function expectedOwnedView(contract) {
  return effectiveOwnedView(buildGatewayConfig(contract, undefined))
}

/** The generator-owned EFFECTIVE view of a PROFILE config (fenced toolset +
 * the mirrored model block — a routed turn reads its model from HERE, not from
 * the root, so a missing/stale model block is drift, not cosmetics). */
export function effectiveProfileOwnedView(cfgData) {
  const cfg = cfgData && typeof cfgData === 'object' && !Array.isArray(cfgData) ? cfgData : {}
  const model = cfg.model && typeof cfg.model === 'object' && !Array.isArray(cfg.model) ? cfg.model : {}
  return {
    model: Object.fromEntries(Object.entries(model).map(([k, v]) => [k, v]).sort(([a], [b]) => (a < b ? -1 : 1))),
    'platform_toolsets.whatsapp': sortedSet(cfg.platform_toolsets?.whatsapp),
    'memory.write_approval': cfg.memory?.write_approval === true,
    'skills.write_approval': cfg.skills?.write_approval === true
  }
}

/** The owned view a SPACE profile must carry: the shared space's fence
 * includes session_search, every other (isolated) space keeps the plain
 * fenced set (§2.1), and every space mirrors `rootModel` — the ROOT config's
 * model block as it actually stands on disk. */
export function expectedProfileOwnedView(spaceSlug, rootModel) {
  const toolset = spaceSlug === SHARED_SPACE ? SHARED_TOOLSET : GROUP_TOOLSET
  return effectiveProfileOwnedView(buildProfileConfig(undefined, toolset, rootModel))
}

const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

/** Parse `.env` text into the OWNED-key view (last occurrence wins — dotenv
 * semantics — with surrounding quotes stripped). Non-owned lines are ignored:
 * the engine legitimately appends its own entries. */
export function effectiveEnvOwnedView(envText) {
  const view = Object.fromEntries(Object.keys(OWNED_ENV).map(k => [k, undefined]))
  for (const line of String(envText ?? '').split(/\r?\n/)) {
    const m = ENV_LINE_RE.exec(line)
    if (!m || !(m[1] in view)) continue
    let value = m[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    view[m[1]] = value
  }
  return view
}

export function expectedEnvOwnedView() {
  return { ...OWNED_ENV }
}

/** Compare two owned views; returns the list of drifted key paths. */
export function diffOwnedViews(expected, actual) {
  const drifted = []
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) drifted.push(key)
  }
  return drifted
}

const PROFILE_CONFIG_RE = /^profiles\/([^/]+)\/config\.yaml$/

function verifyConfigEntry(relPath, actualText, expectedView, effectiveView) {
  let parsed
  try {
    parsed = yaml.load(actualText)
  } catch (err) {
    return { path: relPath, status: 'drift', detail: `not parseable YAML: ${err.message}` }
  }
  const drifted = diffOwnedViews(expectedView, effectiveView(parsed))
  return drifted.length === 0
    ? { path: relPath, status: 'ok' }
    : { path: relPath, status: 'drift', detail: `owned keys differ: ${drifted.join(', ')}` }
}

/**
 * Verify a FULL artifact map (from generateArtifacts) against a home — this is
 * THE verify surface: config files by effective owned keys (root and profile
 * views respectively), `.env` by owned env keys, every other artifact
 * (SOUL.md, knowledge skills AND admin skills) by checksum. An absent file
 * reports `missing`, never `ok` (`readFile(relPath)` → text or null when
 * absent; a real read ERROR must throw in the caller, absence is the only
 * soft outcome).
 *
 * Returns `{ ok, artifacts: [{ path, status: 'ok'|'drift'|'missing', detail? }] }`.
 */
export function verifyArtifacts(contract, artifacts, { readFile } = {}) {
  if (typeof readFile !== 'function') {
    throw new TypeError('verifyArtifacts requires a readFile(relPath) callback')
  }
  // The model block each space profile must mirror is read from the ROOT
  // config AS IT STANDS ON DISK, not from the contract: the model/provider are
  // the engine's to own (hermes setup / auth writes them) and the contract
  // never names them. An unreadable/unparseable root config yields {} — the
  // root's own entry reports that separately, and the profiles then correctly
  // read as drifted rather than silently passing.
  let rootModel
  try {
    const rootText = readFile('config.yaml')
    const rootData = rootText == null ? null : yaml.load(rootText)
    if (rootData && typeof rootData === 'object' && !Array.isArray(rootData)) rootModel = rootData.model
  } catch {
    rootModel = undefined
  }

  const report = []
  for (const [relPath, expected] of Object.entries(artifacts)) {
    const actual = readFile(relPath)
    if (actual == null) {
      report.push({ path: relPath, status: 'missing' })
      continue
    }
    if (relPath === 'config.yaml') {
      report.push(verifyConfigEntry(relPath, actual, expectedOwnedView(contract), effectiveOwnedView))
      continue
    }
    const profileConfig = PROFILE_CONFIG_RE.exec(relPath)
    if (profileConfig) {
      report.push(
        verifyConfigEntry(
          relPath,
          actual,
          expectedProfileOwnedView(profileConfig[1], rootModel),
          effectiveProfileOwnedView
        )
      )
      continue
    }
    if (relPath === '.env') {
      const drifted = diffOwnedViews(expectedEnvOwnedView(), effectiveEnvOwnedView(actual))
      report.push(
        drifted.length === 0
          ? { path: relPath, status: 'ok' }
          : { path: relPath, status: 'drift', detail: `owned env keys differ: ${drifted.join(', ')}` }
      )
      continue
    }
    report.push(
      contentChecksum(actual) === contentChecksum(expected)
        ? { path: relPath, status: 'ok' }
        : { path: relPath, status: 'drift', detail: 'content checksum differs from the generated artifact' }
    )
  }
  return { ok: report.every(a => a.status === 'ok'), artifacts: report }
}

// Re-exported so CLI/test callers can assert the exact contract constants
// without importing the generator internals separately.
export {
  ADMIN_TOOLSET,
  GROUP_TOOLSET,
  HISTORY_BACKFILL_LIMIT,
  OWNED_ENV,
  SHARED_SPACE,
  SHARED_TOOLSET,
  buildRoutes,
  wakeWordPattern
}
