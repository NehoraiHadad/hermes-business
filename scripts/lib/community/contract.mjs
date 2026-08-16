// Canonical community-mode contract: parsing + fail-closed validation.
//
// `community.yaml` is the single source of truth for a multi-group Tachles
// deployment (docs/specs/community-mode.md §3.1). This module turns the raw
// YAML into a NORMALIZED contract object or a complete list of validation
// errors — it never partially accepts a contract. Pure: file existence is
// checked through an injected `fileExists` callback, never by touching disk.
//
// The rules encode the verified engine facts the spec pins:
//   * admins are MANDATORY (≥1). Without `group_allow_admin_from`, slash
//     enforcement in groups is disabled entirely and `/` bypasses the mention
//     requirement — any group member could `/sethome` (spec §2 fact 8). A
//     placeholder value (e.g. "9725XXXXXXXX" from the spec example) must fail
//     validation, not silently ship an open admin surface.
//   * a knowledge skill description over 60 chars never loads into the routing
//     index (spec §2 fact 9) — enforced here, at validation time.
//   * acceptance gates are global (spec §2 fact 4): one wake word for all
//     groups, so `wake_word` lives at community level, not per group.
//   * groups map to CONTEXT SPACES (spec §2.1): by default every group shares
//     the `village` space (one profile, shared session memory, history search
//     across the member groups); a group marked `isolated: true` gets a space
//     (= profile) of its own. The slug stays the group's IDENTITY (SOUL text,
//     knowledge attachment, route names) — the PROFILE is per-space.

import yaml from 'js-yaml'

// Profile directory name per group. Conservative: lowercase/digits/hyphen,
// no leading/trailing hyphen (spec §3.1: slug → profiles/<slug>/).
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
export const SLUG_MAX = 64

// WhatsApp group JIDs: digits (historic JIDs may carry a hyphenated epoch)
// ending in @g.us. Anything else — including placeholder dots like the spec's
// "1203...@g.us" example — is rejected.
export const GROUP_JID_RE = /^[0-9][0-9-]*@g\.us$/

// Admin MSISDNs: digits only, international form without '+'. A value with
// X/x placeholders, dots or angle brackets is a template left unfilled.
export const ADMIN_RE = /^[0-9]{8,20}$/

// Knowledge pack name doubles as the skill directory + frontmatter name, so it
// follows the validated Hermes skill-name contract (src/lib/business-context/
// identity.ts: ^[a-z0-9][a-z0-9._-]*$, ≤64).
export const PACK_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/
export const PACK_NAME_MAX = 64

// The 60-char routing budget (engine truncates the routing index above it and
// the skill is never fully discoverable — spec §2 fact 9).
export const SKILL_DESCRIPTION_ROUTING_MAX = 60

export const TONES = ['default', 'strict']

// The shared context space (spec §2.1): every non-isolated group routes to
// this one profile, so their session memory is mutually searchable.
export const SHARED_SPACE = 'village'

// The management space (2026-08-16, "מי אמר ש-DM == מנהל"): contract admins'
// DMs route HERE — never to the owner's default profile. DM != admin: any
// other DM falls back to the shared space's community persona, so a resident
// can ask community questions privately with the same fenced capability the
// groups get. Admin capability is a ROUTE, not an assumption about DMs.
export const ADMIN_SPACE = 'admin'

// Reserved group slugs:
//   * 'default' — the profile that OWNS the WhatsApp connection (spec §2
//     fact 5); routing a group onto it would collide with the default-profile
//     state dir.
//   * 'village' (SHARED_SPACE) — names the shared context-space profile; an
//     isolated group with this slug would collide with it, and a non-isolated
//     one would shadow the space/group distinction.
export const RESERVED_SLUGS = new Set(['default', SHARED_SPACE, ADMIN_SPACE])

export class ContractError extends Error {
  constructor(errors) {
    super(`community contract invalid:\n${errors.map(e => `  - ${e}`).join('\n')}`)
    this.name = 'ContractError'
    this.errors = errors
  }
}

/** Parse community.yaml text into a raw object (js-yaml v4 is safe-by-default).
 * A non-mapping document fails closed. */
export function parseContract(text) {
  let raw
  try {
    raw = yaml.load(text)
  } catch (err) {
    throw new ContractError([`community.yaml is not valid YAML: ${err.message}`])
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError(['community.yaml must be a YAML mapping'])
  }
  return raw
}

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0

function looksLikePlaceholder(value) {
  return /[Xx]{2,}|\.{3}|…|[<>]|TODO|CHANGEME/.test(value)
}

/** Derived routing description when a pack declares none. Kept short so it
 * always fits the 60-char budget for any valid pack name. */
export function defaultPackDescription(pack) {
  const desc = `ידע קהילה: ${pack}`
  return desc.length <= SKILL_DESCRIPTION_ROUTING_MAX
    ? desc
    : `ידע קהילה: ${pack.slice(0, SKILL_DESCRIPTION_ROUTING_MAX - 'ידע קהילה: '.length)}`
}

/**
 * Validate a raw contract object. Returns `{ ok: true, contract }` with a
 * normalized contract, or `{ ok: false, errors }` listing EVERY violation.
 *
 * `fileExists(sourcePath)` is REQUIRED (fail-closed): knowledge pack sources
 * must be proven to exist, and a caller that cannot prove existence must not
 * validate. The callback receives the `source` path exactly as declared; the
 * CLI resolves it relative to the contract file's directory.
 */
export function validateContract(raw, { fileExists } = {}) {
  if (typeof fileExists !== 'function') {
    throw new TypeError('validateContract requires a fileExists(sourcePath) callback (fail-closed)')
  }
  const errors = []
  const community = raw?.community
  if (!community || typeof community !== 'object' || Array.isArray(community)) {
    errors.push('community: block is missing')
  }
  const name = community?.name
  if (!isNonEmptyString(name)) errors.push('community.name: required non-empty string')
  const wakeWord = community?.wake_word
  if (!isNonEmptyString(wakeWord)) {
    errors.push('community.wake_word: required non-empty string')
  } else if (/[\r\n]/.test(wakeWord)) {
    errors.push('community.wake_word: must be a single line')
  }

  // ── DM audience (2026-08-16 user decision): DMs are gated by Hermes' OWN
  // intake mechanism (dm_policy — strangers are filtered before any model
  // dispatch). The contract only CHOOSES between two native postures:
  //   * 'admins' (DEFAULT, fail-safe): dm_policy=allowlist, admins only —
  //     an unknown sender is dropped at intake and never reaches the AI;
  //   * 'open' (explicit operator opt-in): residents may DM and are routed
  //     to the fenced shared community persona.
  const rawDms = community?.dms
  let dmMode = 'admins'
  if (rawDms !== undefined) {
    if (rawDms === 'open' || rawDms === 'admins') dmMode = rawDms
    else errors.push('community.dms: must be "admins" (default — unknown DM senders are filtered at intake) or "open" (residents get the fenced community persona)')
  }

  // ── admins (MANDATORY ≥1 — engine fact 8: empty admins = open /sethome) ──
  const admins = []
  if (!Array.isArray(raw?.admins) || raw.admins.length === 0) {
    errors.push('admins: at least one admin number is REQUIRED (without group_allow_admin_from, any group member can run /sethome — engine fact 8)')
  } else {
    for (const [i, entry] of raw.admins.entries()) {
      const value = typeof entry === 'number' ? String(entry) : entry
      if (!isNonEmptyString(value)) {
        errors.push(`admins[${i}]: must be a non-empty string of digits`)
        continue
      }
      const trimmed = value.trim()
      if (!ADMIN_RE.test(trimmed)) {
        errors.push(
          looksLikePlaceholder(trimmed)
            ? `admins[${i}]: "${trimmed}" looks like an unfilled placeholder — fill in the real admin number`
            : `admins[${i}]: "${trimmed}" must be 8-20 digits (international form, no '+')`
        )
        continue
      }
      if (admins.includes(trimmed)) {
        errors.push(`admins[${i}]: duplicate admin "${trimmed}"`)
        continue
      }
      admins.push(trimmed)
    }
  }

  // ── knowledge packs (validated before groups so refs can be checked) ──
  const packs = {}
  const rawKnowledge = raw?.knowledge ?? {}
  if (typeof rawKnowledge !== 'object' || Array.isArray(rawKnowledge)) {
    errors.push('knowledge: must be a mapping of pack name → { source }')
  } else {
    for (const [pack, decl] of Object.entries(rawKnowledge)) {
      if (!PACK_NAME_RE.test(pack) || pack.length > PACK_NAME_MAX) {
        errors.push(`knowledge.${pack}: pack name must match ${PACK_NAME_RE} and be ≤${PACK_NAME_MAX} chars (it becomes the skill name)`)
        continue
      }
      if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
        errors.push(`knowledge.${pack}: must be a mapping with a "source" file path`)
        continue
      }
      if (!isNonEmptyString(decl.source)) {
        errors.push(`knowledge.${pack}.source: required non-empty file path`)
        continue
      }
      if (!fileExists(decl.source)) {
        errors.push(`knowledge.${pack}.source: file not found: ${decl.source}`)
      }
      const description = isNonEmptyString(decl.description)
        ? decl.description.trim()
        : defaultPackDescription(pack)
      if (/[\r\n]/.test(description)) {
        errors.push(`knowledge.${pack}.description: must be a single line`)
      } else if (description.length > SKILL_DESCRIPTION_ROUTING_MAX) {
        errors.push(`knowledge.${pack}.description: ${description.length} chars — over the ${SKILL_DESCRIPTION_ROUTING_MAX}-char routing budget, the skill would NEVER load for routing (engine fact 9)`)
      }
      packs[pack] = { source: decl.source, description }
    }
  }

  // ── groups ──
  const groups = []
  const seenSlugs = new Set()
  const seenJids = new Set()
  if (!Array.isArray(raw?.groups) || raw.groups.length === 0) {
    errors.push('groups: at least one group is required')
  } else {
    for (const [i, g] of raw.groups.entries()) {
      const at = field => `groups[${i}]${g?.slug ? ` (${g.slug})` : ''}.${field}`
      if (!g || typeof g !== 'object' || Array.isArray(g)) {
        errors.push(`groups[${i}]: must be a mapping`)
        continue
      }
      const slug = g.slug
      if (!isNonEmptyString(slug) || !SLUG_RE.test(slug) || slug.length > SLUG_MAX) {
        errors.push(`${at('slug')}: must match ${SLUG_RE} and be ≤${SLUG_MAX} chars (it becomes profiles/<slug>/)`)
      } else if (RESERVED_SLUGS.has(slug)) {
        errors.push(
          slug === SHARED_SPACE
            ? `${at('slug')}: "${slug}" is reserved — it names the shared context-space profile (spec §2.1)`
            : `${at('slug')}: "${slug}" is reserved — the default profile owns the WhatsApp connection (engine fact 5)`
        )
      } else if (seenSlugs.has(slug)) {
        errors.push(`${at('slug')}: duplicate slug "${slug}"`)
      } else {
        seenSlugs.add(slug)
      }
      const jid = g.jid
      if (!isNonEmptyString(jid) || !GROUP_JID_RE.test(jid.trim())) {
        const shown = typeof jid === 'string' ? jid.trim() : jid
        errors.push(
          typeof shown === 'string' && looksLikePlaceholder(shown)
            ? `${at('jid')}: "${shown}" looks like an unfilled placeholder — fill in the real group JID`
            : `${at('jid')}: must be a WhatsApp group JID (digits ending in @g.us)`
        )
      } else if (seenJids.has(jid.trim())) {
        errors.push(`${at('jid')}: duplicate JID "${jid.trim()}"`)
      } else {
        seenJids.add(jid.trim())
      }
      if (!isNonEmptyString(g.name)) errors.push(`${at('name')}: required non-empty string`)
      if (!isNonEmptyString(g.purpose)) errors.push(`${at('purpose')}: required non-empty string`)
      const tone = g.tone ?? 'default'
      const toneValid = TONES.includes(tone)
      if (!toneValid) {
        errors.push(`${at('tone')}: "${tone}" is not a known tone (${TONES.join('|')})`)
      }
      const isolated = g.isolated ?? false
      if (typeof isolated !== 'boolean') {
        errors.push(`${at('isolated')}: must be true or false (default false — the group shares the "${SHARED_SPACE}" context space)`)
      }
      const knowledge = g.knowledge ?? []
      if (!Array.isArray(knowledge)) {
        errors.push(`${at('knowledge')}: must be a list of knowledge pack names`)
      } else {
        for (const ref of knowledge) {
          if (!isNonEmptyString(ref) || !(ref in packs)) {
            errors.push(`${at('knowledge')}: unknown knowledge pack "${ref}" (declare it under top-level knowledge:)`)
          }
        }
      }
      const normalizedSlug = isNonEmptyString(slug) ? slug : `group-${i}`
      const isIsolated = isolated === true
      groups.push({
        slug: normalizedSlug,
        jid: isNonEmptyString(jid) ? jid.trim() : '',
        name: isNonEmptyString(g.name) ? g.name.trim() : '',
        purpose: isNonEmptyString(g.purpose) ? g.purpose.trim() : '',
        tone: toneValid ? tone : 'default',
        toneValid,
        isolated: isIsolated,
        // The profile this group's turns run under (spec §2.1): shared space
        // by default, its own slug-named space when isolated.
        space: isIsolated ? normalizedSlug : SHARED_SPACE,
        knowledge: Array.isArray(knowledge) ? knowledge.filter(r => isNonEmptyString(r) && r in packs) : []
      })
    }
  }

  // ── shared-space tone coherence (spec §2.1) ──
  // The shared space renders ONE SOUL.md for all its member groups, so their
  // tones must agree. Only tones that individually validated participate —
  // an invalid tone already has its own error and must not double-report.
  const sharedMembers = groups.filter(g => !g.isolated && g.toneValid)
  const sharedTones = [...new Set(sharedMembers.map(g => g.tone))].sort()
  if (sharedTones.length > 1) {
    const strictSlugs = sharedMembers.filter(g => g.tone === 'strict').map(g => g.slug)
    errors.push(
      `groups: the shared "${SHARED_SPACE}" space mixes tones (${sharedTones.join(', ')}) — one shared persona cannot be both; ` +
        `mark the strict group(s) as isolated: true instead (${strictSlugs.join(', ')})`
    )
  }
  for (const g of groups) delete g.toneValid

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    contract: {
      name: name.trim(),
      wakeWord: wakeWord.trim(),
      dmMode,
      admins,
      groups,
      knowledge: packs
    }
  }
}

/**
 * Derive the CONTEXT SPACES of a validated contract (spec §2.1): the shared
 * `village` space first (when at least one group is non-isolated), then one
 * space per isolated group, in contract order. Each space is
 * `{ slug, shared, groups, tone, knowledge }` where `knowledge` is the UNION
 * of the member groups' packs (first-appearance order, deduplicated) and
 * `tone` is the space's uniform tone (validation refuses a mixed shared
 * space, so the first member's tone is authoritative there).
 *
 * Groups built by hand (tests) may omit `isolated`; absent means false.
 */
export function contractSpaces(contract) {
  const spaces = []
  const shared = contract.groups.filter(g => g.isolated !== true)
  if (shared.length > 0) {
    spaces.push({
      slug: SHARED_SPACE,
      shared: true,
      admin: false,
      groups: shared,
      tone: shared[0].tone ?? 'default',
      knowledge: [...new Set(shared.flatMap(g => g.knowledge ?? []))]
    })
  }
  for (const g of contract.groups) {
    if (g.isolated === true) {
      spaces.push({
        slug: g.slug,
        shared: false,
        admin: false,
        groups: [g],
        tone: g.tone ?? 'default',
        knowledge: [...new Set(g.knowledge ?? [])]
      })
    }
  }
  // The management space always exists: admins are mandatory, and their DMs
  // must never land in the owner's default profile.
  spaces.push({ slug: ADMIN_SPACE, shared: false, admin: true, groups: [], tone: 'default', knowledge: [] })
  return spaces
}

/** Parse + validate in one throw-on-failure step (CLI convenience). */
export function loadContract(text, { fileExists }) {
  const verdict = validateContract(parseContract(text), { fileExists })
  if (!verdict.ok) throw new ContractError(verdict.errors)
  return verdict.contract
}
