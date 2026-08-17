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
//   * `dms: open` (spec §2.2) is DORMANT unless the contract opts in. Only
//     then does the generator emit the RESIDENTS space (profile config with
//     the group fence, public-knowledge skills, private-chat persona, own
//     .env), the platform-only WhatsApp catch-all route onto it, and the
//     DM-shape grant in the egress policy. Under the default `dms: admins`
//     none of those artifacts or keys exist at all — an unknown DM sender is
//     dropped by the engine's own intake gate before any model dispatch.

import yaml from 'js-yaml'
import { renderAdminSoul, renderResidentSoul, renderSharedSoul, renderSoul } from './persona.mjs'
import { ADMIN_SPACE, RESIDENT_SPACE, SHARED_SPACE, SKILL_DESCRIPTION_ROUTING_MAX, contractSpaces } from './contract.mjs'

// Fenced toolset for ISOLATED space profiles: public-group-safe, no
// terminal/file/exec — and deliberately NO session_search: the engine tool's
// `profile` parameter and bare-id fallback can open OTHER profiles' state.db
// read-only (tools/session_search_tool.py:298-318,343-384 resolve profiles
// via get_default_hermes_root(), which ignores the per-turn scope override —
// hermes_constants.py:173-209), so granting it to a sensitive group would
// hand a prompt-injected turn a cross-space read door. Fail closed.
// `clarify` is deliberately ABSENT. Observed live in the pilot group
// 2026-08-14: the agent answered a resident's question by calling clarify,
// which on a messaging platform renders a numbered multiple-choice list and
// PARKS the turn until somebody answers it (tools/clarify_tool.py — the
// interaction itself lives in the platform layer). Nobody did, and the turn
// was still open 21 minutes later at "iteration 1/500, clarify", with the
// group unable to get any other answer out of the bot; every later message
// only produced an "⚡ Interrupting current task" ack. There is no timeout on
// that wait. A public community group is exactly the wrong place for a
// blocking interactive prompt — one unanswered question takes the bot down
// for every resident — so the persona asks for clarification in plain text
// instead (persona.mjs). The admin DM keeps the tool (ADMIN_TOOLSET): it is a
// 1:1 channel with the operator, where blocking is the intended behaviour.
export const GROUP_TOOLSET = Object.freeze(['web', 'skills', 'vision'])
// The shared public space gets the Tachles read-only archive facade. Unlike
// Hermes' raw session_search, this tool cannot choose a profile/database and
// can only read group ids written into the server-owned archive policy.
// Isolated spaces intentionally do not receive it: a single process-level
// policy must never become a cross-space read door.
export const COMMUNITY_ARCHIVE_TOOL = 'community_archive'
export const SHARED_TOOLSET = Object.freeze([...GROUP_TOOLSET, COMMUNITY_ARCHIVE_TOOL])
// The residents' DM space (§2.2) reuses the plain group fence — deliberately
// NOT the shared one: the archive facade reads the community's public group
// history, and a private chat with an unidentified sender is the last place to
// open that door. Same fence as an isolated group, for the same fail-closed
// reason. Named separately so the intent survives any future divergence.
export const RESIDENT_TOOLSET = GROUP_TOOLSET
// Management toolset for the DEFAULT profile (admin DMs + host chat): terminal
// + file are required to run the community CLIs; still no code_execution or
// delegation. All names are engine "configurable keys" valid for whatsapp
// (tools_config.py:96-124; only discord toolsets are platform-restricted,
// tools_config.py:216-228).
export const ADMIN_TOOLSET = Object.freeze([
  'terminal',
  'file',
  'skills',
  'web',
  'clarify',
  'todo',
  COMMUNITY_ARCHIVE_TOOL
])
export const HISTORY_BACKFILL_LIMIT = 50
export const COMMUNITY_ARCHIVE_PLUGIN = 'community-archive'
export const COMMUNITY_ARCHIVE_PLUGIN_FILES = Object.freeze([
  '__init__.py',
  'filters.py',
  'policy.py',
  'query.py',
  'storage.py',
  'tool.py',
  'plugin.yaml'
])
export const DISABLED_COMMUNITY_TOOLSETS = Object.freeze(['session_search'])

// Platforms on which the egress gate may serve an UNENUMERABLE DM sender
// (`dms: open`, §2.2). WhatsApp only: it is the one platform this generator
// configures, and the plugin's DM-shape test is written against WhatsApp's
// chat-id forms.
export const DM_OPEN_PLATFORMS = Object.freeze(['whatsapp'])

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
export function buildRoutes(contract, adminLids = {}) {
  const groupRoutes = contract.groups.map(g => ({
    name: `${g.slug}-route`,
    platform: 'whatsapp',
    chat_id: g.jid,
    profile: g.isolated === true ? g.slug : SHARED_SPACE
  }))
  // DM model (2026-08-16, user decision "מי אמר ש-DM == מנהל"):
  //   * an ADMIN's DM routes to the management space — specificity 4 wins;
  //   * under `dms: open`, EVERY OTHER DM falls back to the RESIDENTS space
  //     via a platform-only route (specificity 0, engine-sorted last) — a
  //     resident can ask pool-hours/prayer-times privately, answered from the
  //     public knowledge with the group fence. Nothing ever falls through to
  //     the owner's default profile.
  // Classic DM JIDs are `<msisdn>@s.whatsapp.net` — but a modern WhatsApp DM
  // presents its chat_id as `<lid>@lid`, and route matching is an EXACT
  // string compare (gateway/profile_routing.py:102 — no LID resolution;
  // verified live 2026-08-16: the admin's DM fell through to the default
  // profile). The native fix stays declarative: when the engine's own
  // lid-mapping session file already knows the admin's LID, emit a SECOND
  // route in LID form. `adminLids` maps msisdn → lid digits and is read from
  // `platforms/whatsapp/session/lid-mapping-<msisdn>.json` by the CLI.
  const adminRoutes = contract.admins.flatMap(admin => {
    const routes = [
      { name: `admin-dm-${admin}`, platform: 'whatsapp', chat_id: `${admin}@s.whatsapp.net`, profile: ADMIN_SPACE }
    ]
    const lid = adminLids?.[admin]
    if (lid) {
      routes.push({ name: `admin-dm-lid-${admin}`, platform: 'whatsapp', chat_id: `${lid}@lid`, profile: ADMIN_SPACE })
    }
    return routes
  })
  // The resident catch-all exists only when the operator explicitly opened
  // DMs. Under dmMode 'admins' the native intake gate already filtered every
  // non-admin, so no route is written — fail-safe over fail-open.
  //
  // It is a PLATFORM-ONLY route: no chat_id (and no guild/thread) means
  // specificity 0, and the engine matches most-specific-first
  // (gateway/profile_routing.py:109-170), so every exact route above — each
  // group chat, each admin DM in msisdn AND LID form — still wins. This is the
  // engine's native per-platform catch-all; it can only ever collect what
  // nothing else claimed, which is exactly the unknown DM sender we cannot
  // enumerate in advance.
  const dmCatchAll = contract.dmMode === 'open'
    ? [{ name: 'residents-dm-catchall', platform: 'whatsapp', profile: RESIDENT_SPACE }]
    : []
  return [...groupRoutes, ...adminRoutes, ...dmCatchAll]
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

/** Order-preserving union of an existing list value with owned additions. */
const unionList = (existing, additions) => [
  ...new Set([...(Array.isArray(existing) ? existing.map(String) : []), ...additions.map(String)])
]

/**
 * Merge the contract-owned keys into (a clone of) the existing ROOT config
 * object — ADDITIVELY. This runs against the user's ONE real HERMES_HOME
 * (user decision 2026-08-16: community is a capability of the single Hermes,
 * never a second installation), so a pre-existing business deployment must
 * keep working:
 *   * allow/admin lists and mention patterns are UNIONED, never replaced;
 *   * the root toolset, write approvals, dm_policy and history backfill are
 *     written only when ABSENT — an explicit existing choice is the owner's;
 *   * `session_search` stays ENABLED at root (the owner's own assistant);
 *     the fence lives in the group profiles (buildProfileConfig);
 *   * hard fences stay OWNED (exact): group_policy allowlist, the observation
 *     retention list, require_mention, and the empty group slash surface —
 *     observation gating is meaningless without them;
 *   * profile_routes: routes claimed by the contract (whatsapp routes onto our
 *     space profiles or onto contract group ids) are regenerated; any other
 *     existing route survives verbatim.
 * Existing non-owned keys — including the model block — survive verbatim.
 */
export function buildGatewayConfig(contract, existingConfigText, adminLids = {}) {
  const cfg = clone(parseExistingConfig(existingConfigText, 'config.yaml')) ?? {}

  const gateway = asMapping(clone(cfg.gateway))
  gateway.multiplex_profiles = true
  // Canonicalize: routes live top-level only (see header note).
  delete gateway.profile_routes
  cfg.gateway = gateway

  // RESIDENT_SPACE is owned even when the contract does NOT generate it: a
  // deployment downgraded from `dms: open` back to 'admins' must have its
  // catch-all route RECLAIMED (i.e. dropped), not preserved as a foreign route.
  const ownedSlugs = new Set([...contractSpaces(contract).map(space => space.slug), RESIDENT_SPACE])
  const ownedJids = new Set(contract.groups.map(g => g.jid))
  const existingRoutes = Array.isArray(cfg.profile_routes) ? cfg.profile_routes : []
  const foreignRoutes = existingRoutes.filter(route => {
    if (!route || typeof route !== 'object') return false
    if (String(route.platform ?? '') !== 'whatsapp') return true
    return !ownedSlugs.has(String(route.profile ?? '')) && !ownedJids.has(String(route.chat_id ?? ''))
  })
  cfg.profile_routes = [...foreignRoutes, ...buildRoutes(contract, adminLids)]

  const whatsapp = asMapping(clone(cfg.whatsapp))
  // DM audience (2026-08-16 user decision): enforced by Hermes' NATIVE intake
  // gate, never reinvented here. dm_policy is OWNED from the contract:
  //   * dmMode 'admins' (default) → 'allowlist': an unknown DM sender is
  //     dropped at intake (_is_dm_allowed) and NEVER reaches the model;
  //   * dmMode 'open' (explicit opt-in) → residents may DM; buildRoutes sends
  //     them to the fenced shared community persona, admins to the
  //     management space — no DM ever lands in the owner's default profile.
  // allow_from stays admin-unioned in BOTH modes: it is the allowlist under
  // 'admins' and harmless defense in depth under 'open'.
  whatsapp.dm_policy = contract.dmMode === 'open' ? 'open' : 'allowlist'
  whatsapp.allow_from = unionList(whatsapp.allow_from, contract.admins)
  whatsapp.group_policy = 'allowlist'
  whatsapp.group_allow_from = unionList(whatsapp.group_allow_from, contract.groups.map(g => g.jid))
  whatsapp.allow_admin_from = unionList(whatsapp.allow_admin_from, contract.admins)
  whatsapp.group_allow_admin_from = unionList(whatsapp.group_allow_admin_from, contract.admins)
  // Residents get no slash-command surface in public groups. Allowlisted
  // admin DMs still retain Hermes' built-in /help and /whoami floor, which is
  // enough to discover/administer the agent without exposing group controls.
  // OWNED (not merged): this is a fence, and the engine key is global.
  whatsapp.group_user_allowed_commands = []
  whatsapp.require_mention = true
  whatsapp.mention_patterns = unionList(whatsapp.mention_patterns, [wakeWordPattern(contract.wakeWord)])
  whatsapp.observe_unmentioned_group_messages = true
  // The retention fence is EXACT, never unioned: only non-isolated contract
  // groups may have ambient traffic durably observed.
  whatsapp.observe_allowed_chats = contract.groups
    .filter(group => group.isolated !== true)
    .map(group => group.jid)
  if (whatsapp.history_backfill === undefined) whatsapp.history_backfill = true
  if (whatsapp.history_backfill_limit === undefined) whatsapp.history_backfill_limit = HISTORY_BACKFILL_LIMIT
  cfg.whatsapp = whatsapp

  // The ROOT toolset is NOT touched at all: every WhatsApp audience is routed
  // to a space profile (groups → spaces, admin DMs → admin space, any other
  // DM → shared space), so the default profile serves only the owner's own
  // surfaces and its toolset is the owner's business. ADMIN_TOOLSET lives in
  // the admin space profile (buildProfileConfig), never at root.
  const memory = asMapping(clone(cfg.memory))
  if (memory.write_approval === undefined) memory.write_approval = true
  cfg.memory = memory

  const skills = asMapping(clone(cfg.skills))
  if (skills.write_approval === undefined) skills.write_approval = true
  cfg.skills = skills

  const plugins = asMapping(clone(cfg.plugins))
  plugins.enabled = [...new Set([...(Array.isArray(plugins.enabled) ? plugins.enabled : []), COMMUNITY_ARCHIVE_PLUGIN])]
  plugins.disabled = (Array.isArray(plugins.disabled) ? plugins.disabled : []).filter(
    name => name !== COMMUNITY_ARCHIVE_PLUGIN
  )
  const entries = asMapping(clone(plugins.entries))
  entries[COMMUNITY_ARCHIVE_PLUGIN] = {
    ...asMapping(entries[COMMUNITY_ARCHIVE_PLUGIN]),
    allow_tool_override: false
  }
  plugins.entries = entries
  cfg.plugins = plugins

  return cfg
}

/**
 * The companion business-whatsapp-policy plugin holds ALL WhatsApp egress
 * read-only/selected (native outbound ships unguarded — the gate is the
 * layer's core value). Community turns run in the SAME gateway process, so
 * contract-approved chats must be authorized there too, or every community
 * reply is skipped (observed live 2026-08-16: `pre_gateway_dispatch skip:
 * business_whatsapp_read_only` on the pilot group).
 *
 * `community_sources` is the GENERATOR-OWNED section of the policy file:
 * exactly the contract's group JIDs + admin DMs, regenerated on every apply
 * (an exact fence, like observe_allowed_chats). Everything else — the owner's
 * mode/behavior/sources for the business surface — is preserved verbatim; an
 * absent file starts from the plugin's own fail-closed defaults. A
 * present-but-unparseable file is REFUSED, never overwritten.
 *
 * `community_dm_open_platforms` is the SECOND generator-owned key, and it
 * exists only under `dms: open` (§2.2). Resident DM senders cannot be
 * enumerated in advance, so the contract grants a SHAPE instead of a list: the
 * plugin authorizes a destination when the platform is named here AND the
 * identifier is DM-shaped (bare msisdn, @s.whatsapp.net, @lid, @c.us —
 * policy.py `_dm_open_allowed`). Groups, broadcast lists and newsletters are
 * never DM-shaped, so the group fence is untouched. Owned in BOTH directions:
 * downgrading back to `dms: admins` DELETES the key, so a grant can never
 * outlive the contract that authorized it.
 */
export function buildEgressPolicy(contract, existingPolicyText, adminLids = {}) {
  let existing = null
  if (typeof existingPolicyText === 'string' && existingPolicyText.trim()) {
    let parsed
    try {
      parsed = JSON.parse(existingPolicyText)
    } catch {
      throw new Error('existing business/whatsapp-policy.json is not valid JSON — refusing to merge over it')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('existing business/whatsapp-policy.json is not a JSON object — refusing to merge over it')
    }
    existing = parsed
  }
  const base = existing ?? {
    // Mirrors the plugin's default_policy(): behavior-neutral for the owner
    // surface (everything denied) until the owner configures it.
    version: 2,
    mode: 'read_only',
    behavior: 'monitor',
    reply_chats: [],
    reply_groups: [],
    sources: []
  }
  const policy = {
    ...base,
    community_sources: [
      ...contract.groups.map(g => ({ id: g.jid, type: 'group', platform: 'whatsapp' })),
      ...contract.admins.flatMap(a => {
        const entries = [{ id: `${a}@s.whatsapp.net`, type: 'dm', platform: 'whatsapp' }]
        // A modern DM chat presents as `<lid>@lid` — the reply target the
        // gate matches against is that chat id, so the grant must carry it.
        if (adminLids?.[a]) entries.push({ id: `${adminLids[a]}@lid`, type: 'dm', platform: 'whatsapp' })
        return entries
      })
    ]
  }
  if (contract.dmMode === 'open') policy.community_dm_open_platforms = [...DM_OPEN_PLATFORMS]
  else delete policy.community_dm_open_platforms
  return policy
}

/** Server-owned allowlist for the read-only archive facade. Sensitive/isolated
 * groups are deliberately absent, so shared resident turns cannot query them. */
export function buildArchivePolicy(contract) {
  return {
    version: 1,
    groups: contract.groups
      .filter(group => group.isolated !== true)
      .map(group => ({ id: group.jid, name: group.name }))
  }
}

/**
 * Merge the owned PROFILE keys into (a clone of) an existing space-profile
 * config. Every space profile pins its toolset — an absent profile config
 * would fall back to the engine's FULL default whatsapp toolset, not to the
 * root config (M2 verification, §6.1). `toolset` selects the fence: the
 * shared space passes SHARED_TOOLSET (adds community_archive), isolated spaces
 * keep the default GROUP_TOOLSET.
 *
 * `rootModel` is the ROOT config's `model` block, MIRRORED here. Under the
 * multiplexer a routed turn runs with `get_hermes_home()` overridden to the
 * profile dir (gateway/run.py `_profile_runtime_scope`), so the profile's own
 * config.yaml is the ONLY model source — a profile without it resolves no
 * model at all. Observed live on the pilot 2026-08-14: a routed group turn
 * died with `HTTP 400: No models provided`, and with the model name alone it
 * picked the wrong provider (`No usable credentials found for 'openai-api'`),
 * so BOTH `default` and `provider` have to travel. Credentials do NOT: the
 * same run proved auth.json still resolves from the root home, which is why
 * we mirror the model block and never duplicate the OAuth store (a second
 * copy would race the refresh-token rotation).
 */
export function buildProfileConfig(
  existingConfigText,
  toolset = GROUP_TOOLSET,
  rootModel,
  { archivePlugin = false, disableSessionSearch = true } = {}
) {
  const cfg = clone(parseExistingConfig(existingConfigText, 'profile config.yaml')) ?? {}

  const model = asMapping(clone(rootModel))
  if (Object.keys(model).length > 0) cfg.model = model
  else delete cfg.model

  const toolsets = asMapping(clone(cfg.platform_toolsets))
  toolsets.whatsapp = [...toolset]
  cfg.platform_toolsets = toolsets

  const memory = asMapping(clone(cfg.memory))
  memory.write_approval = true
  cfg.memory = memory

  const skills = asMapping(clone(cfg.skills))
  skills.write_approval = true
  cfg.skills = skills

  const agent = asMapping(clone(cfg.agent))
  if (disableSessionSearch) {
    agent.disabled_toolsets = [
      ...new Set([
        ...(Array.isArray(agent.disabled_toolsets) ? agent.disabled_toolsets : []),
        ...DISABLED_COMMUNITY_TOOLSETS
      ])
    ]
  } else {
    // The management space: admins search their OWN management history —
    // session_search is scoped to this profile home, so it exposes no
    // resident or business conversations.
    agent.disabled_toolsets = (Array.isArray(agent.disabled_toolsets) ? agent.disabled_toolsets : []).filter(
      name => !DISABLED_COMMUNITY_TOOLSETS.includes(name)
    )
    if (agent.disabled_toolsets.length === 0) delete agent.disabled_toolsets
  }
  cfg.agent = agent
  if (Object.keys(cfg.agent).length === 0) delete cfg.agent

  const plugins = asMapping(clone(cfg.plugins))
  if (archivePlugin) {
    plugins.enabled = [...new Set([...(Array.isArray(plugins.enabled) ? plugins.enabled : []), COMMUNITY_ARCHIVE_PLUGIN])]
    plugins.disabled = (Array.isArray(plugins.disabled) ? plugins.disabled : []).filter(
      name => name !== COMMUNITY_ARCHIVE_PLUGIN
    )
    const entries = asMapping(clone(plugins.entries))
    entries[COMMUNITY_ARCHIVE_PLUGIN] = {
      ...asMapping(entries[COMMUNITY_ARCHIVE_PLUGIN]),
      allow_tool_override: false
    }
    plugins.entries = entries
    cfg.plugins = plugins
  } else {
    // An isolated profile must never inherit a stale registration of the
    // cross-group archive facade from an earlier shared-space deployment.
    plugins.enabled = (Array.isArray(plugins.enabled) ? plugins.enabled : []).filter(
      name => name !== COMMUNITY_ARCHIVE_PLUGIN
    )
    plugins.disabled = [...new Set([...(Array.isArray(plugins.disabled) ? plugins.disabled : []), COMMUNITY_ARCHIVE_PLUGIN])]
    const entries = asMapping(clone(plugins.entries))
    delete entries[COMMUNITY_ARCHIVE_PLUGIN]
    plugins.entries = entries
    cfg.plugins = plugins
  }

  return cfg
}

/** The toolset fence a space profile pins (§2.1, §2.2). Every space pins one:
 * an absent profile config would silently fall back to the engine's FULL
 * default whatsapp toolset. */
export function spaceToolset(space) {
  if (space.admin) return ADMIN_TOOLSET
  if (space.shared) return SHARED_TOOLSET
  if (space.resident) return RESIDENT_TOOLSET
  return GROUP_TOOLSET
}

/** The SOUL.md a space profile ships — one persona renderer per space kind
 * (§2.1, §2.2). */
function renderSpaceSoul(space, contract) {
  const identity = { communityName: contract.name, wakeWord: contract.wakeWord }
  if (space.admin) return renderAdminSoul(identity)
  if (space.resident) return renderResidentSoul(identity)
  if (space.shared) return renderSharedSoul({ ...identity, groups: space.groups, tone: space.tone })
  return renderSoul({ ...identity, group: space.groups[0] })
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
export function buildEnvFile(existingEnvText, ownedEnv = OWNED_ENV) {
  const owned = { ...ownedEnv }
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

/**
 * Per-SPACE profile .env — the authorization the engine actually consults on
 * routed turns. Live finding 2026-08-16 (gateway -vv): under multiplex,
 * `_platform_gate_env` reads ONLY the routed profile's secret scope
 * (agent/secret_scope.py — os.environ fallback is disabled to stop
 * cross-profile allowlist leaks, issue #72348), and triggered group messages
 * carry NO user_id (the shared-transcript observe path strips sender
 * identity), so authz_mixin's chat-scoped check
 * (WHATSAPP_GROUP_ALLOWED_USERS) is the ONLY thing that can authorize them —
 * and it must live in profiles/<space>/.env, not the root .env. Without it
 * the turn dies as "Ignoring message with no user_id from whatsapp".
 *
 * Owned keys (exact fences, per space):
 *   * group spaces: WHATSAPP_GROUP_ALLOWED_USERS = exactly that space's
 *     contract group JIDs;
 *   * residents space (dms 'open' only): WHATSAPP_ALLOWED_USERS='*' — by
 *     definition its senders cannot be listed, and they were already
 *     intake-gated by the NATIVE dm_policy at the adapter, with the operator
 *     explicitly opting into open DMs. No group key: nothing routes a group
 *     here;
 *   * admin space: WHATSAPP_ALLOWED_USERS = exactly the contract admins.
 */
export function spaceOwnedEnv(space, contract, adminLids = {}) {
  const owned = {}
  if (space.resident) {
    owned.WHATSAPP_ALLOWED_USERS = '*'
  } else if (space.admin) {
    // Both identity forms per admin: msisdn AND (when the engine's own
    // lid-mapping already knows it) the LID digits — DM senders present
    // either, and the env allowlist match is plain string equality.
    owned.WHATSAPP_ALLOWED_USERS = contract.admins
      .flatMap(a => (adminLids?.[a] ? [a, adminLids[a]] : [a]))
      .join(',')
  } else {
    // Group spaces stay chat-scoped only: under `dms: open` the DM audience
    // belongs to the residents space, so no group profile's sender gate is
    // widened for it.
    owned.WHATSAPP_GROUP_ALLOWED_USERS = space.groups.map(g => g.jid).join(',')
  }
  return owned
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
 * shared-community SOUL, toolset with community_archive); each `isolated: true`
 * group gets `profiles/<slug>/` with the per-group SOUL and the fenced
 * toolset without archive/search access; under `dms: open` (§2.2) a
 * `profiles/residents/` is added for DM senders nothing else claims.
 *
 * Returns `{ 'config.yaml': text, '.env': text,
 *            'skills/<admin skill>/SKILL.md': text,
 *            'profiles/<space>/config.yaml': text,
 *            'profiles/<space>/SOUL.md': text,
 *            'profiles/<space>/skills/<pack>/SKILL.md': text, ... }`.
 */
export function generateArtifacts(
  contract,
  {
    readKnowledgeSource,
    readAdminSkillTemplate,
    readCommunityPluginFile,
    deployPaths,
    existingConfigText,
    existingEnvText,
    existingEgressPolicyText,
    readProfileConfigText,
    readProfileEnvText,
    adminLids
  } = {}
) {
  if (typeof readKnowledgeSource !== 'function') {
    throw new TypeError('generateArtifacts requires a readKnowledgeSource(sourcePath) callback')
  }
  if (typeof readAdminSkillTemplate !== 'function') {
    throw new TypeError('generateArtifacts requires a readAdminSkillTemplate(name) callback (the shipped admin skills are part of the artifact set)')
  }
  if (typeof readCommunityPluginFile !== 'function') {
    throw new TypeError(
      'generateArtifacts requires a readCommunityPluginFile(name) callback (the scoped archive plugin is part of the safety boundary)'
    )
  }
  const readProfileConfig = typeof readProfileConfigText === 'function' ? readProfileConfigText : () => undefined
  const readProfileEnv = typeof readProfileEnvText === 'function' ? readProfileEnvText : () => undefined

  const artifacts = {}
  const lids = adminLids ?? {}
  const rootConfig = buildGatewayConfig(contract, existingConfigText, lids)
  artifacts['config.yaml'] = dumpConfig(rootConfig)
  // WHATSAPP_GROUP_ALLOWED_USERS at ROOT too: the intake authorization check
  // (authz_mixin._is_user_authorized) runs BEFORE the routed profile's secret
  // scope is installed, so it falls back to the process env — verified live
  // 2026-08-16 with gateway -vv: with the var only in profiles/<space>/.env
  // the group turn still died as "no user_id". Chat-scoped and exact: all
  // contract group JIDs (the per-space fences stay in config + profile .env).
  artifacts['.env'] = buildEnvFile(existingEnvText, {
    ...OWNED_ENV,
    WHATSAPP_GROUP_ALLOWED_USERS: contract.groups.map(g => g.jid).join(',')
  })
  // No activation marker: under the single-home model there is no second
  // runtime to route to — the community capability is active exactly when the
  // generated fences + archive policy exist in this home.
  artifacts['community/archive-policy.json'] = `${JSON.stringify(buildArchivePolicy(contract), null, 2)}\n`
  // Egress authorization for contract chats in the companion WhatsApp gate —
  // without it, community replies are silently skipped at dispatch.
  artifacts['business/whatsapp-policy.json'] = `${JSON.stringify(buildEgressPolicy(contract, existingEgressPolicyText, lids), null, 2)}\n`

  for (const name of COMMUNITY_ARCHIVE_PLUGIN_FILES) {
    const source = readCommunityPluginFile(name)
    if (typeof source !== 'string' || source.length === 0) {
      throw new Error(`community archive plugin file is missing or empty: ${name}`)
    }
    artifacts[`plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`] = source.replace(/\r\n/g, '\n').replace(/\n?$/, '\n')
  }

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
    // The routed-turn authorization scope (see spaceOwnedEnv): without this
    // file the engine's per-profile secret scope is empty and every routed
    // group turn is dropped with "no user_id" before it can run.
    artifacts[`profiles/${space.slug}/.env`] = buildEnvFile(
      readProfileEnv(space.slug),
      spaceOwnedEnv(space, contract, lids)
    )
    artifacts[`profiles/${space.slug}/config.yaml`] = dumpConfig(
      buildProfileConfig(
        readProfileConfig(space.slug),
        spaceToolset(space),
        rootConfig.model,
        // The archive serves the shared community persona AND the management
        // space; admins additionally keep session_search over their own
        // management history (scoped to this profile home).
        { archivePlugin: space.shared || space.admin, disableSessionSearch: !space.admin }
      )
    )
    if (space.shared || space.admin) {
      for (const name of COMMUNITY_ARCHIVE_PLUGIN_FILES) {
        artifacts[`profiles/${space.slug}/plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`] =
          artifacts[`plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`]
      }
    }
    artifacts[`profiles/${space.slug}/SOUL.md`] = renderSpaceSoul(space, contract)
    if (space.admin) {
      // The routed admin DM channel carries the management skills. The root
      // copies installed by BusinessInstall stay owner-facing (companion).
      for (const name of ADMIN_SKILLS) {
        artifacts[`profiles/${space.slug}/skills/${name}/SKILL.md`] = artifacts[`skills/${name}/SKILL.md`]
      }
    }
    for (const pack of space.knowledge) {
      artifacts[`profiles/${space.slug}/skills/${pack}/SKILL.md`] = rendered[pack]
    }
  }
  return artifacts
}
