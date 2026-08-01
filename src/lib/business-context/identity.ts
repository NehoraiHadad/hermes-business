// Validated Hermes 0.19.1 skill-frontmatter limits, taken from the REAL contract in
// the installed agent (tools/skill_manager_tool.py + agent/skill_utils.py):
//   • name  — required, <= 64 chars, must match ^[a-z0-9][a-z0-9._-]*$
//   • description — required; HARD reject > 1024 chars (skill_manager_tool.py:464),
//     but the routing/progressive-loading index TRUNCATES to 60 chars
//     (skill_utils.extract_skill_description: len>60 → desc[:57]+"..."). So a skill is
//     only fully DISCOVERABLE/ROUTABLE when its description fits the 60-char budget.
// We enforce the routing budget for our own skills so they stay routable, and expose
// the hard caps so tests pin the exact contract.

export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_HARD_MAX = 1024
export const SKILL_DESCRIPTION_ROUTING_MAX = 60
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/

// The business-context skill FAMILY (valid name per the regex above). It is the payload
// `skill` field and the base of the identity marker — the shared ownership family, NOT the
// on-disk name. Each persisted version is an IMMUTABLE instance named `business-context-<digest>`
// (see BUSINESS_CONTEXT_NAME_PREFIX + businessContextSkillName). We create versioned instances
// through the official Skills API and only ever toggle them enabled/disabled — never overwrite —
// so prior data is preserved while exactly one version stays active.
export const BUSINESS_CONTEXT_SKILL = 'business-context'
// Every persisted instance's directory/frontmatter name begins with this prefix. A legacy
// fixed 'business-context' skill (from an earlier client) is also treated as a family member.
export const BUSINESS_CONTEXT_NAME_PREFIX = `${BUSINESS_CONTEXT_SKILL}-`

// True for any name in the business-context family: the legacy fixed name or a versioned
// `business-context-<digest>` instance. A NAME match alone proves nothing about ownership —
// callers still verify the CONTENT is owned (identifyArtifact) before disabling anything, so a
// foreign skill that merely shares the name family is never touched.
export function isBusinessContextVariantName(name: unknown): name is string {
  return typeof name === 'string' && (name === BUSINESS_CONTEXT_SKILL || name.startsWith(BUSINESS_CONTEXT_NAME_PREFIX))
}
// Ownership CONVENTION marker + collision-safe RESERVED versioned identity. This is an
// unkeyed ownership marker, NOT authentication — it lets us refuse to overwrite a foreign
// skill that merely shares the name, and lets a read-back positively identify OUR artifact.
// A foreign skill that shares the name 'business-context' will NOT carry this owner/identity.
// Bump the version to migrate our own artifact; add the new identity to ACCEPTED_IDENTITIES.
export const BUSINESS_CONTEXT_OWNER = 'hermes-business'
export const BUSINESS_CONTEXT_VERSION = 1
export const BUSINESS_CONTEXT_IDENTITY = `${BUSINESS_CONTEXT_OWNER}:${BUSINESS_CONTEXT_SKILL}@${BUSINESS_CONTEXT_VERSION}`

// STRICT identity acceptance. Verification accepts ONLY these exact identities — a
// version-whitelist, never a loose `hermes-business:`-prefix match. An unknown/newer
// version (or any other identity) is refused rather than silently trusted or overwritten,
// which both closes the "any prefixed identity passes" hole and prevents an older client
// from clobbering a newer artifact. Extend this set (with real migration handling) when
// BUSINESS_CONTEXT_VERSION is bumped.
export const ACCEPTED_BUSINESS_CONTEXT_IDENTITIES: readonly string[] = Object.freeze([
  BUSINESS_CONTEXT_IDENTITY
])

// True only for an exact, whitelisted identity string. Used by both the marker check and
// the payload `context.identity` invariant so the two can never diverge.
export function isAcceptedBusinessContextIdentity(identity: unknown): identity is string {
  return typeof identity === 'string' && ACCEPTED_BUSINESS_CONTEXT_IDENTITIES.includes(identity)
}

// A <=60-char description so the full text survives the routing-index truncation.
export const BUSINESS_CONTEXT_DESCRIPTION = 'פרופיל העסק והמשתמש להקשר בכל שיחה עתידית'

export type FrontmatterVerdict = { ok: boolean; error?: string; routable: boolean }

// Validate a skill name against the hard contract (reject) — mirrors _validate_name.
export function validateSkillName(name: string): { ok: boolean; error?: string } {
  if (!name) return { ok: false, error: 'שם ה־Skill חסר' }
  if (name.length > SKILL_NAME_MAX) return { ok: false, error: `שם ה־Skill ארוך מ־${SKILL_NAME_MAX} תווים` }
  if (!SKILL_NAME_RE.test(name)) return { ok: false, error: 'שם ה־Skill חייב אותיות קטנות/ספרות/._- ולהתחיל באות או ספרה' }
  return { ok: true }
}

// Validate a description: `ok` reflects the HARD reject limit (>1024 fails a real
// create/edit); `routable` reflects the 60-char routing budget (over it, the routing
// index truncates and the skill is only partially discoverable). Our own artifacts
// must be BOTH ok and routable.
export function validateSkillDescription(description: string): FrontmatterVerdict {
  if (!description) return { ok: false, routable: false, error: 'תיאור ה־Skill חסר' }
  if (description.length > SKILL_DESCRIPTION_HARD_MAX) {
    return { ok: false, routable: false, error: `התיאור ארוך מ־${SKILL_DESCRIPTION_HARD_MAX} תווים` }
  }
  const routable = description.length <= SKILL_DESCRIPTION_ROUTING_MAX
  return { ok: true, routable, error: routable ? undefined : 'התיאור יקוצץ באינדקס הניתוב (מעל 60 תווים)' }
}
