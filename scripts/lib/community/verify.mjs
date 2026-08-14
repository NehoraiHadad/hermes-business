// Community-mode drift verification. PURE — reads arrive via callbacks.
//
// The engine REWRITES config.yaml (comments stripped, keys reordered — observed
// live 2026-08-14, spec §3.2), so config.yaml is never compared as text.
// Instead both sides are parsed and only the generator-OWNED keys are compared
// as VALUES:
//   * profile_routes is read from EITHER the top-level or gateway.profile_routes
//     (the engine accepts both spellings — docs/profile-routing.md);
//   * list-valued gates (group_allow_from, admins, toolsets, mention_patterns)
//     compare as order-insensitive sets — a reorder is not drift;
//   * routes compare as a set of normalized {name, platform, chat_id, profile}.
//
// SOUL.md and knowledge skills are OURS alone — the engine does not rewrite
// them — so they compare by SHA-256 over line-ending-normalized content.

import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { buildGatewayConfig, buildRoutes, wakeWordPattern, WHATSAPP_TOOLSET, HISTORY_BACKFILL_LIMIT } from './generate.mjs'

export function contentChecksum(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

const sortedSet = list => [...new Set((list ?? []).map(String))].sort()

/** Extract the generator-owned EFFECTIVE view from parsed config data. */
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

/** Compare two owned views; returns the list of drifted key paths. */
export function diffOwnedViews(expected, actual) {
  const drifted = []
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) drifted.push(key)
  }
  return drifted
}

/**
 * Verify a FULL artifact map (from generateArtifacts) against a home — this is
 * THE verify surface: config.yaml by effective owned keys, every other
 * artifact (SOUL.md AND knowledge skills) by checksum. An absent file reports
 * `missing`, never `ok` (`readFile(relPath)` → text or null when absent; a
 * real read ERROR must throw in the caller, absence is the only soft outcome).
 *
 * Returns `{ ok, artifacts: [{ path, status: 'ok'|'drift'|'missing', detail? }] }`.
 */
export function verifyArtifacts(contract, artifacts, { readFile } = {}) {
  if (typeof readFile !== 'function') {
    throw new TypeError('verifyArtifacts requires a readFile(relPath) callback')
  }
  const report = []
  for (const [relPath, expected] of Object.entries(artifacts)) {
    const actual = readFile(relPath)
    if (actual == null) {
      report.push({ path: relPath, status: 'missing' })
      continue
    }
    if (relPath === 'config.yaml') {
      let parsed
      try {
        parsed = yaml.load(actual)
      } catch (err) {
        report.push({ path: relPath, status: 'drift', detail: `not parseable YAML: ${err.message}` })
        continue
      }
      const drifted = diffOwnedViews(expectedOwnedView(contract), effectiveOwnedView(parsed))
      report.push(
        drifted.length === 0
          ? { path: relPath, status: 'ok' }
          : { path: relPath, status: 'drift', detail: `owned keys differ: ${drifted.join(', ')}` }
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
export { buildRoutes, wakeWordPattern, WHATSAPP_TOOLSET, HISTORY_BACKFILL_LIMIT }
