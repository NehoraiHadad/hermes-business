// Community-mode generator core: contract → artifact map. PURE — no I/O.
//
// Input:  a validated contract (contract.mjs), the CURRENT config.yaml text of
//         the target HERMES_HOME (may be undefined for a fresh home), and an
//         injected reader for knowledge pack sources.
// Output: a plain object mapping HERMES_HOME-relative POSIX paths → exact file
//         content (LF). The apply layer (apply.mjs) writes it; verify
//         (verify.mjs) re-derives it and compares.
//
// Config ownership model: the generator OWNS a fixed set of keys (see
// OWNED_CONFIG_NOTES below) and rewrites them from the contract on every run;
// every other existing key — model/provider blocks, connection state, whatever
// the operator or the engine added — is preserved verbatim. This is what makes
// re-running the generator on a live home safe and idempotent.
//
// The owned keys implement the spec's verified engine facts:
//   * gateway.multiplex_profiles: true — without it profile_routes is ignored
//     entirely (fact 1).
//   * one route per group (platform: whatsapp, chat_id: JID → profile: slug);
//     routes are written at the TOP-LEVEL `profile_routes` (both forms are
//     accepted by the engine; we canonicalize to one so effective-config
//     comparison has a single place to look, and drop a stale
//     gateway.profile_routes so two route lists can never diverge).
//   * acceptance gates are GLOBAL (fact 4): group_policy allowlist over the
//     UNION of all group JIDs, one wake word → one mention pattern,
//     dm_policy disabled.
//   * admins fill allow_admin_from + group_allow_admin_from (fact 8 — the
//     contract validator already refuses an empty admins list).
//   * platform_toolsets.whatsapp is a reduced, public-group-safe toolset;
//     memory/skills write approvals stay ON so resident chatter can never
//     silently become bot "knowledge" (spec §5.1).

import yaml from 'js-yaml'
import { renderSoul } from './persona.mjs'
import { SKILL_DESCRIPTION_ROUTING_MAX } from './contract.mjs'

export const WHATSAPP_TOOLSET = Object.freeze(['web', 'skills', 'vision', 'clarify'])
export const HISTORY_BACKFILL_LIMIT = 50

/** Escape a literal wake word into a regex fragment for mention_patterns. */
export function wakeWordPattern(wakeWord) {
  return `^${wakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
}

/** The deterministic route list: one per group, in contract order. */
export function buildRoutes(contract) {
  return contract.groups.map(g => ({
    name: `${g.slug}-route`,
    platform: 'whatsapp',
    chat_id: g.jid,
    profile: g.slug
  }))
}

/** Deep-clone plain YAML data (objects/arrays/scalars only). */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function asMapping(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * Merge the contract-owned keys into (a clone of) the existing config object.
 * Existing non-owned keys — including the model block — survive verbatim.
 */
export function buildGatewayConfig(contract, existingConfigText) {
  let existing = {}
  if (typeof existingConfigText === 'string' && existingConfigText.trim()) {
    const parsed = yaml.load(existingConfigText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('existing config.yaml is not a YAML mapping — refusing to merge over it')
    }
    existing = parsed
  }
  const cfg = clone(existing) ?? {}

  const gateway = asMapping(clone(cfg.gateway))
  gateway.multiplex_profiles = true
  // Canonicalize: routes live top-level only (see header note).
  delete gateway.profile_routes
  cfg.gateway = gateway

  cfg.profile_routes = buildRoutes(contract)

  const whatsapp = asMapping(clone(cfg.whatsapp))
  whatsapp.dm_policy = 'disabled'
  whatsapp.group_policy = 'allowlist'
  whatsapp.group_allow_from = [...new Set(contract.groups.map(g => g.jid))]
  whatsapp.allow_admin_from = [...contract.admins]
  whatsapp.group_allow_admin_from = [...contract.admins]
  whatsapp.require_mention = true
  whatsapp.mention_patterns = [wakeWordPattern(contract.wakeWord)]
  whatsapp.history_backfill = true
  whatsapp.history_backfill_limit = HISTORY_BACKFILL_LIMIT
  cfg.whatsapp = whatsapp

  const toolsets = asMapping(clone(cfg.platform_toolsets))
  toolsets.whatsapp = [...WHATSAPP_TOOLSET]
  cfg.platform_toolsets = toolsets

  const memory = asMapping(clone(cfg.memory))
  memory.write_approval = true
  cfg.memory = memory

  const skills = asMapping(clone(cfg.skills))
  skills.write_approval = true
  cfg.skills = skills

  return cfg
}

/** Deterministic YAML text for a config object (sorted keys, no line folding). */
export function dumpConfig(cfg) {
  return yaml.dump(cfg, { sortKeys: true, lineWidth: -1, noRefs: true })
}

/** Render one knowledge pack as a Hermes skill document. The description was
 * already validated ≤60 chars (routing budget); this re-asserts it fail-closed
 * because a skill that silently drops out of routing is worse than an error. */
export function renderKnowledgeSkill({ pack, description, sourcePath, sourceContent }) {
  if (typeof description !== 'string' || description.length > SKILL_DESCRIPTION_ROUTING_MAX) {
    throw new Error(`knowledge pack "${pack}": description missing or over ${SKILL_DESCRIPTION_ROUTING_MAX} chars — it would never load for routing`)
  }
  // JSON.stringify yields a valid YAML double-quoted scalar (colons, quotes,
  // Hebrew all safe) — the frontmatter must survive any YAML parser.
  return [
    '---',
    `name: ${pack}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    `<!-- generated by tachles community-mode from ${sourcePath}; edit the source and re-run the generator -->`,
    '',
    sourceContent.replace(/\r\n/g, '\n').replace(/\n?$/, '\n')
  ].join('\n')
}

/**
 * The full artifact map for a deployment. Pure: knowledge sources arrive via
 * `readKnowledgeSource(sourcePath)` (the CLI reads them relative to the
 * contract file); the current gateway config arrives as text.
 *
 * Returns `{ 'config.yaml': text, 'profiles/<slug>/SOUL.md': text,
 *            'profiles/<slug>/skills/<pack>/SKILL.md': text, ... }`.
 */
export function generateArtifacts(contract, { readKnowledgeSource, existingConfigText } = {}) {
  if (typeof readKnowledgeSource !== 'function') {
    throw new TypeError('generateArtifacts requires a readKnowledgeSource(sourcePath) callback')
  }
  const artifacts = {}
  artifacts['config.yaml'] = dumpConfig(buildGatewayConfig(contract, existingConfigText))

  // Read each pack's source ONCE; a shared pack renders identical bytes into
  // every profile that declares it.
  const rendered = {}
  for (const [pack, decl] of Object.entries(contract.knowledge)) {
    const sourceContent = readKnowledgeSource(decl.source)
    if (typeof sourceContent !== 'string') {
      throw new Error(`knowledge pack "${pack}": source ${decl.source} could not be read`)
    }
    rendered[pack] = renderKnowledgeSkill({
      pack,
      description: decl.description,
      sourcePath: decl.source,
      sourceContent
    })
  }

  for (const group of contract.groups) {
    artifacts[`profiles/${group.slug}/SOUL.md`] = renderSoul({
      communityName: contract.name,
      wakeWord: contract.wakeWord,
      group
    })
    for (const pack of group.knowledge) {
      artifacts[`profiles/${group.slug}/skills/${pack}/SKILL.md`] = rendered[pack]
    }
  }
  return artifacts
}
