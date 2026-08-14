// Community-mode generator core: contract → artifact map. PURE — no I/O.
//
// Input:  a validated contract (contract.mjs), the CURRENT config.yaml/.env
//         texts of the target HERMES_HOME (may be undefined for a fresh home),
//         injected readers for knowledge pack sources and the shipped admin
//         skill templates, and the deployment paths to bake into those skills.
// Output: a plain object mapping HERMES_HOME-relative POSIX paths → exact file
//         content (LF). The apply layer (apply.mjs) writes it; verify
//         (verify.mjs) re-derives it and compares.
//
// Config ownership model: the generator OWNS a fixed set of keys and rewrites
// them from the contract on every run; every other existing key — model/
// provider blocks, connection state, whatever the operator or the engine
// added — is preserved verbatim. This is what makes re-running the generator
// on a live home safe and idempotent. The same model applies to `.env`
// (owned KEYS replaced in place, all other lines preserved) and to the
// per-space `profiles/<space>/config.yaml` files.
//
// The owned keys implement the spec's verified engine facts (§2, §6.1):
//   * gateway.multiplex_profiles: true — without it profile_routes is ignored
//     entirely (fact 1).
//   * one route per group (platform: whatsapp, chat_id: JID → profile: the
//     group's context SPACE, §2.1 — the shared `village` profile by default,
//     the group's own slug-profile when `isolated: true`). The engine accepts
//     N routes onto one profile with no uniqueness constraint beyond the
//     per-route chat_id match (gateway/profile_routing.py:109-170 — `name` is
//     log-only), and sessions inside one profile stay per-chat
//     (`agent:<profile>:whatsapp:group:<chat_id>...`, gateway/session.py:
//     1070-1211), so consolidation shares MEMORY without merging THREADS;
//     routes are written at the TOP-LEVEL `profile_routes` (both forms are
//     accepted by the engine; we canonicalize to one so effective-config
//     comparison has a single place to look, and drop a stale
//     gateway.profile_routes so two route lists can never diverge).
//   * acceptance gates are GLOBAL (fact 4): group_policy allowlist over the
//     UNION of all group JIDs, one wake word → one mention pattern.
//   * ADMIN-ONLY DMs are natively expressible as a TWO-LAYER config (M2
//     verification, §6.1): the bridge's bot-mode sender gate applies to EVERY
//     inbound message including group participants whenever dm_policy is not
//     `pairing` (bridge.js:652, allowlist.js:66-88 — empty allowlist =
//     deny-all), so `.env` must carry WHATSAPP_ALLOWED_USERS=* to let resident
//     group traffic through; the GATEWAY then enforces `whatsapp.dm_policy:
//     allowlist` + `whatsapp.allow_from: <admins>` (adapter.py:435,442-454 —
//     config presence beats the env var; whatsapp_common.py:276-289 — non-admin
//     DMs are silently dropped, never buffered).
//   * admins fill allow_admin_from + group_allow_admin_from (fact 8 — the
//     contract validator already refuses an empty admins list) AND the DM
//     allowlist above.
//   * per-profile toolset fencing is REAL but requires a per-profile
//     config.yaml (M2 verification, §6.1): a routed turn loads the PROFILE's
//     config (run.py:3304-3309 under _profile_runtime_scope) and an ABSENT
//     profile config falls back to the platform DEFAULT toolset — the full
//     hermes-whatsapp core set incl. terminal/write_file/execute_code
//     (tools_config.py:2279-2286, toolsets.py:531-533) — NOT to the root
//     config. So every SPACE profile gets its own config.yaml pinning its
//     fence (SHARED_TOOLSET for the shared space, GROUP_TOOLSET for isolated
//     ones), and the ROOT config (default profile = the admin-DM channel)
//     gets the ADMIN_TOOLSET with terminal+file so the agent can run the
//     community CLIs.
//   * memory/skills write approvals stay ON so resident chatter can never
//     silently become bot "knowledge" (spec §5.1).
//   * the shipped admin skills (assets/community-skills/) are installed into
//     the DEFAULT profile's skills dir only — group profiles never see them —
//     with the deployment paths substituted and the ≤60-char routing
//     description enforced fail-closed (fact 9).

import yaml from 'js-yaml'
import { renderSharedSoul, renderSoul } from './persona.mjs'
import { SHARED_SPACE, SKILL_DESCRIPTION_ROUTING_MAX, contractSpaces } from './contract.mjs'

// Fenced toolset for ISOLATED space profiles: public-group-safe, no
// terminal/file/exec — and deliberately NO session_search: the engine tool's
// `profile` parameter and bare-id fallback can open OTHER profiles' state.db
// read-only (tools/session_search_tool.py:298-318,343-384 resolve profiles
// via get_default_hermes_root(), which ignores the per-turn scope override —
// hermes_constants.py:173-209), so granting it to a sensitive group would
// hand a prompt-injected turn a cross-space read door. Fail closed.
export const GROUP_TOOLSET = Object.freeze(['web', 'skills', 'vision', 'clarify'])
// The SHARED space additionally gets the engine's session-history search
// toolset (`session_search`, tools/session_search_tool.py:1143-1146; a
// configurable key valid for whatsapp, hermes_cli/tools_config.py:114). Its
// DEFAULT scope is the CURRENT profile's state.db (SessionDB() →
// _default_db_path() → get_hermes_home()/state.db, hermes_state.py:366-383,
// which honors the _profile_runtime_scope override, gateway/run.py:2065-2098)
// — that is exactly the shared space, so an answer given in group A is
// findable from group B. The cross-profile `profile=` parameter remains an
// engine-level residual risk documented in the spec (§6.1.1 verification 4).
export const SHARED_TOOLSET = Object.freeze([...GROUP_TOOLSET, 'session_search'])
// Management toolset for the DEFAULT profile (admin DMs + host chat): terminal
// + file are required to run the community CLIs; still no code_execution or
// delegation. All names are engine "configurable keys" valid for whatsapp
// (tools_config.py:96-124; only discord toolsets are platform-restricted,
// tools_config.py:216-228).
export const ADMIN_TOOLSET = Object.freeze(['terminal', 'file', 'skills', 'web', 'clarify', 'todo'])
export const HISTORY_BACKFILL_LIMIT = 50

// The admin skills shipped in assets/community-skills/, installed into the
// default profile's skills dir (skills/<name>/SKILL.md under HERMES_HOME).
export const ADMIN_SKILLS = Object.freeze(['community-bootstrap', 'community-admin'])

// Owned `.env` keys — the PROVEN pilot bridge posture (start-pilot.ps1):
// bot mode on a dedicated number, bridge sender gate opened with '*' so the
// GATEWAY allowlists are the single enforcement point. The engine loads
// <home>/.env with override=True at startup (env_loader.py:495-500).
export const OWNED_ENV = Object.freeze({
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_MODE: 'bot',
  WHATSAPP_ALLOWED_USERS: '*'
})

/** Escape a literal wake word into a regex fragment for mention_patterns. */
export function wakeWordPattern(wakeWord) {
  return `^${wakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
}

/** The deterministic route list: one per group, in contract order. Each
 * group's JID routes to its context SPACE's profile (§2.1) — several routes
 * onto one profile is engine-supported (profile_routing.py:109-170; `name`
 * is log-only and stays unique per group anyway). */
export function buildRoutes(contract) {
  return contract.groups.map(g => ({
    name: `${g.slug}-route`,
    platform: 'whatsapp',
    chat_id: g.jid,
    profile: g.isolated === true ? g.slug : SHARED_SPACE
  }))
}

/** Deep-clone plain YAML data (objects/arrays/scalars only). */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function asMapping(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function parseExistingConfig(existingConfigText, label) {
  if (typeof existingConfigText === 'string' && existingConfigText.trim()) {
    const parsed = yaml.load(existingConfigText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`existing ${label} is not a YAML mapping — refusing to merge over it`)
    }
    return parsed
  }
  return {}
}

/**
 * Merge the contract-owned keys into (a clone of) the existing ROOT config
 * object. Existing non-owned keys — including the model block — survive
 * verbatim.
 */
export function buildGatewayConfig(contract, existingConfigText) {
  const cfg = clone(parseExistingConfig(existingConfigText, 'config.yaml')) ?? {}

  const gateway = asMapping(clone(cfg.gateway))
  gateway.multiplex_profiles = true
  // Canonicalize: routes live top-level only (see header note).
  delete gateway.profile_routes
  cfg.gateway = gateway

  cfg.profile_routes = buildRoutes(contract)

  const whatsapp = asMapping(clone(cfg.whatsapp))
  // Admin-only DMs (M2): gateway-level allowlist. The bridge stays open via
  // OWNED_ENV's WHATSAPP_ALLOWED_USERS=* — config presence wins at the
  // adapter, so this allowlist never leaks into the bridge sender gate.
  whatsapp.dm_policy = 'allowlist'
  whatsapp.allow_from = [...contract.admins]
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
  toolsets.whatsapp = [...ADMIN_TOOLSET]
  cfg.platform_toolsets = toolsets

  const memory = asMapping(clone(cfg.memory))
  memory.write_approval = true
  cfg.memory = memory

  const skills = asMapping(clone(cfg.skills))
  skills.write_approval = true
  cfg.skills = skills

  return cfg
}

/**
 * Merge the owned PROFILE keys into (a clone of) an existing space-profile
 * config. Every space profile pins its toolset — an absent profile config
 * would fall back to the engine's FULL default whatsapp toolset, not to the
 * root config (M2 verification, §6.1). `toolset` selects the fence: the
 * shared space passes SHARED_TOOLSET (adds session_search), isolated spaces
 * keep the default GROUP_TOOLSET.
 */
export function buildProfileConfig(existingConfigText, toolset = GROUP_TOOLSET) {
  const cfg = clone(parseExistingConfig(existingConfigText, 'profile config.yaml')) ?? {}

  const toolsets = asMapping(clone(cfg.platform_toolsets))
  toolsets.whatsapp = [...toolset]
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

const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/**
 * Merge the owned env keys into an existing `.env` text, preserving every
 * other line (comments, other keys, engine-written pairing entries) verbatim.
 * The FIRST occurrence of an owned key is rewritten in place; later duplicate
 * occurrences of that key are dropped (dotenv last-wins would otherwise let a
 * stale duplicate override the owned value); missing keys are appended.
 */
export function buildEnvFile(existingEnvText) {
  const owned = { ...OWNED_ENV }
  const seen = new Set()
  const out = []
  const lines = typeof existingEnvText === 'string' ? existingEnvText.split(/\r?\n/) : []
  // Drop a single trailing empty line (re-added by the final join).
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    const m = ENV_LINE_RE.exec(line)
    const key = m?.[1]
    if (key && key in owned) {
      if (!seen.has(key)) {
        seen.add(key)
        out.push(`${key}=${owned[key]}`)
      }
      continue // duplicates of an owned key are dropped
    }
    out.push(line)
  }
  for (const key of Object.keys(owned)) {
    if (!seen.has(key)) out.push(`${key}=${owned[key]}`)
  }
  return out.join('\n') + '\n'
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

// ---------------------------------------------------------------------------
// Admin skills (assets/community-skills/<name>/SKILL.md → skills/<name>/)
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g

/** The placeholders an admin skill template may use; every value is REQUIRED. */
export const DEPLOY_PATH_KEYS = Object.freeze([
  'HOME_DIR', // the deployment HERMES_HOME
  'CONTRACT_PATH', // community.yaml
  'INSTALL_ROOT', // deployment root (engine/, home/ live under it)
  'GENERATE_CLI', // absolute path of scripts/community-generate.mjs
  'PROVISION_CLI' // absolute path of scripts/community-provision.mjs
])

/** Extract + validate the YAML frontmatter of a skill document (fail-closed). */
export function parseSkillFrontmatter(text, label = 'skill') {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, '\n'))
  if (!m) throw new Error(`${label}: SKILL.md must start with a --- YAML frontmatter block`)
  let fm
  try {
    fm = yaml.load(m[1])
  } catch (err) {
    throw new Error(`${label}: frontmatter is not valid YAML: ${err.message}`)
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error(`${label}: frontmatter must be a YAML mapping`)
  }
  return fm
}

/**
 * Substitute the deployment paths into a shipped admin skill template and
 * validate it fail-closed:
 *   * every {{PLACEHOLDER}} must be a known DEPLOY_PATH_KEY with a non-empty
 *     value — an unknown or leftover placeholder refuses;
 *   * frontmatter name must equal the skill's directory name;
 *   * routing description must be a single line ≤60 chars (fact 9 — over
 *     budget means the skill NEVER loads for routing).
 * Returns LF-normalized text with a trailing newline.
 */
export function renderAdminSkill({ name, template, deployPaths }) {
  if (typeof template !== 'string' || !template.trim()) {
    throw new Error(`admin skill "${name}": template is missing or empty`)
  }
  const paths = deployPaths ?? {}
  for (const key of DEPLOY_PATH_KEYS) {
    if (typeof paths[key] !== 'string' || paths[key].trim() === '') {
      throw new Error(`admin skill "${name}": deployPaths.${key} is required (fail-closed — a skill with unresolved paths would instruct wrong commands)`)
    }
  }
  const substituted = template.replace(/\r\n/g, '\n').replace(PLACEHOLDER_RE, (whole, key) => {
    if (!DEPLOY_PATH_KEYS.includes(key)) {
      throw new Error(`admin skill "${name}": unknown placeholder {{${key}}} in template`)
    }
    return paths[key]
  })
  const leftover = /\{\{[A-Z_]+\}\}/.exec(substituted)
  if (leftover) {
    throw new Error(`admin skill "${name}": unresolved placeholder ${leftover[0]} after substitution`)
  }
  const fm = parseSkillFrontmatter(substituted, `admin skill "${name}"`)
  if (fm.name !== name) {
    throw new Error(`admin skill "${name}": frontmatter name ${JSON.stringify(fm.name)} must equal the skill directory name`)
  }
  const description = fm.description
  if (typeof description !== 'string' || !description.trim()) {
    throw new Error(`admin skill "${name}": frontmatter description is required`)
  }
  if (/[\r\n]/.test(description)) {
    throw new Error(`admin skill "${name}": description must be a single line`)
  }
  if (description.length > SKILL_DESCRIPTION_ROUTING_MAX) {
    throw new Error(
      `admin skill "${name}": description is ${description.length} chars — over the ${SKILL_DESCRIPTION_ROUTING_MAX}-char routing budget, the skill would NEVER load for routing (fact 9)`
    )
  }
  return substituted.replace(/\n?$/, '\n')
}

/**
 * The full artifact map for a deployment. Pure: knowledge sources arrive via
 * `readKnowledgeSource(sourcePath)`, admin skill templates via
 * `readAdminSkillTemplate(name)`, current config/env texts as strings, and an
 * optional `readProfileConfigText(space)` for merge-preserving profile configs.
 *
 * Profiles are per context SPACE (§2.1), not per group: all non-isolated
 * groups share `profiles/village/` (union of their knowledge packs, one
 * shared-community SOUL, toolset with session_search); each `isolated: true`
 * group gets `profiles/<slug>/` with the per-group SOUL and the fenced
 * toolset WITHOUT session_search.
 *
 * Returns `{ 'config.yaml': text, '.env': text,
 *            'skills/<admin skill>/SKILL.md': text,
 *            'profiles/<space>/config.yaml': text,
 *            'profiles/<space>/SOUL.md': text,
 *            'profiles/<space>/skills/<pack>/SKILL.md': text, ... }`.
 */
export function generateArtifacts(
  contract,
  { readKnowledgeSource, readAdminSkillTemplate, deployPaths, existingConfigText, existingEnvText, readProfileConfigText } = {}
) {
  if (typeof readKnowledgeSource !== 'function') {
    throw new TypeError('generateArtifacts requires a readKnowledgeSource(sourcePath) callback')
  }
  if (typeof readAdminSkillTemplate !== 'function') {
    throw new TypeError('generateArtifacts requires a readAdminSkillTemplate(name) callback (the shipped admin skills are part of the artifact set)')
  }
  const readProfileConfig = typeof readProfileConfigText === 'function' ? readProfileConfigText : () => undefined

  const artifacts = {}
  artifacts['config.yaml'] = dumpConfig(buildGatewayConfig(contract, existingConfigText))
  artifacts['.env'] = buildEnvFile(existingEnvText)

  // Admin skills → DEFAULT profile only (skills/ at the HOME root). Group
  // profiles must never see management skills.
  for (const name of ADMIN_SKILLS) {
    const template = readAdminSkillTemplate(name)
    if (typeof template !== 'string') {
      throw new Error(`admin skill "${name}": template could not be read`)
    }
    artifacts[`skills/${name}/SKILL.md`] = renderAdminSkill({ name, template, deployPaths })
  }

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

  for (const space of contractSpaces(contract)) {
    artifacts[`profiles/${space.slug}/config.yaml`] = dumpConfig(
      buildProfileConfig(readProfileConfig(space.slug), space.shared ? SHARED_TOOLSET : GROUP_TOOLSET)
    )
    artifacts[`profiles/${space.slug}/SOUL.md`] = space.shared
      ? renderSharedSoul({
          communityName: contract.name,
          wakeWord: contract.wakeWord,
          groups: space.groups,
          tone: space.tone
        })
      : renderSoul({
          communityName: contract.name,
          wakeWord: contract.wakeWord,
          group: space.groups[0]
        })
    for (const pack of space.knowledge) {
      artifacts[`profiles/${space.slug}/skills/${pack}/SKILL.md`] = rendered[pack]
    }
  }
  return artifacts
}
