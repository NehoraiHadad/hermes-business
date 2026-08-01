import type { OnboardingData } from '../../types'
import {
  BUSINESS_CONTEXT_DESCRIPTION,
  BUSINESS_CONTEXT_IDENTITY,
  BUSINESS_CONTEXT_NAME_PREFIX,
  BUSINESS_CONTEXT_OWNER,
  BUSINESS_CONTEXT_SKILL,
  BUSINESS_CONTEXT_VERSION,
  isAcceptedBusinessContextIdentity,
  validateSkillDescription,
  validateSkillName
} from './identity'
import {
  buildBusinessContext,
  contentChecksum,
  decodeBase64,
  encodeBase64,
  stableStringify,
  type BusinessContext
} from './payload'

// A persisted version's name is a CONTENT ADDRESS: `business-context-<digest prefix>` where the
// digest is over the full canonical context (including completedAt). Identical context → identical
// name AND identical rendered bytes (idempotent); any change → a new, immutable version name. The
// name is derived from the context, NOT from the rendered document, so there is no circular
// dependency with the document's own embedded integrity digest (which covers the frontmatter name).
export const BUSINESS_CONTEXT_NAME_DIGEST_LEN = 16

export async function businessContextSkillName(context: BusinessContext): Promise<string> {
  const digest = await contentChecksum(stableStringify(context))
  const name = `${BUSINESS_CONTEXT_NAME_PREFIX}${digest.hash.slice(0, BUSINESS_CONTEXT_NAME_DIGEST_LEN)}`
  const check = validateSkillName(name)
  if (!check.ok) throw new Error(`שם ה־Skill שנגזר אינו תקין: ${check.error}`)
  return name
}

export { buildBusinessContext }
export type { BusinessContext }

// A self-delimited machine payload carried in HTML comments — recovered by an exact
// marker regex, NEVER by parsing a Markdown ``` fence (which arbitrary body text could
// forge or the server could reflow). Line 1 declares owner/identity/digest; line 2 is
// the base64 of the full context JSON. The digest is a FULL-DOCUMENT integrity digest
// (see documentDigest): it covers the entire rendered SKILL.md — frontmatter, human
// instructions/body, AND the machine payload (which itself carries completedAt) — with
// only the digest token's own value blanked. This is a corruption/tamper-EVIDENCE digest
// (unkeyed), an ownership convention, NOT authentication.
const MARKER_RE = /<!--\s*hermes-business-context\s+identity=(\S+)\s+digest=([\w-]+):([0-9a-f]+)\s*-->/
const PAYLOAD_RE = /<!--\s*payload:([A-Za-z0-9+/=]+)\s*-->/

// The literal placeholder the digest region substitutes for the digest's own value, so
// the document can be digested self-referentially. Chosen to not collide with `<algo>:<hash>`.
const DIGEST_PENDING = 'PENDING'

// Reduce a rendered document to its canonical DIGEST REGION: the exact bytes with only
// the digest token's value blanked to DIGEST_PENDING. Digesting this covers every other
// byte of the file. Byte-for-byte reproducible in Python (companion backend CAS route)
// because it is a single deterministic string substitution over UTF-8 text.
export function digestRegion(doc: string): string {
  return doc.replace(/(<!--\s*hermes-business-context\s+identity=\S+\s+digest=)[\w-]+:[0-9a-f]+/, `$1${DIGEST_PENDING}`)
}

// The full-document integrity digest: SHA-256 (WebCrypto) or FNV-1a fallback over the
// digest region. This is what the marker embeds and what identifyArtifact recomputes.
export async function documentDigest(doc: string): Promise<{ algo: string; hash: string }> {
  return contentChecksum(digestRegion(doc))
}

function fieldLines(business: OnboardingData): string {
  const rows: [string, string][] = [
    ['שם', business.userName],
    ['תפקיד', business.role],
    ['שפה', business.language],
    ['סגנון תשובות', business.responseStyle],
    ['שעות עבודה', business.workHours],
    ['שם העסק', business.businessName],
    ['תחום', business.industry],
    ['שירותים ומוצרים', business.offerings],
    ['לקוחות', business.customers],
    ['שעות פעילות', business.businessHours],
    ['סגנון תקשורת', business.communicationStyle],
    ['מגבלות והתחייבויות אסורות', business.restrictions],
    ['תהליכים חוזרים', business.recurringProcesses],
    ['מערכות בשימוש', business.systems],
    ['משימות לחיסכון', business.timeSavers],
    ['פעולות הדורשות אישור', business.approvals.join('; ')]
  ]
  return rows.map(([label, value]) => `- ${label}: ${value || '—'}`).join('\n')
}

// Render a genuinely operational, ROUTABLE SKILL.md: valid frontmatter (<=60 desc),
// explicit triggers + instructions, the full context as human-readable fields, and the
// authoritative machine payload with an embedded corruption checksum. Deterministic
// given `context`, so a read-back can be compared byte-for-byte.
export async function renderBusinessContextSkill(context: BusinessContext): Promise<string> {
  const name = await businessContextSkillName(context)
  const nameCheck = validateSkillName(name)
  const descCheck = validateSkillDescription(BUSINESS_CONTEXT_DESCRIPTION)
  if (!nameCheck.ok || !descCheck.ok || !descCheck.routable) {
    throw new Error(`frontmatter לא תקין: ${nameCheck.error || descCheck.error}`)
  }
  // Render the whole document first with a PENDING digest placeholder, digest THAT (so the
  // digest covers frontmatter + body + payload verbatim), then substitute the real value.
  const encoded = encodeBase64(stableJson(context))
  const pending = [
    '---',
    `name: ${name}`,
    `description: ${BUSINESS_CONTEXT_DESCRIPTION}`,
    'version: 1.0.0',
    'author: Hermes Business',
    'metadata:',
    '  hermes:',
    `    owner: ${BUSINESS_CONTEXT_OWNER}`,
    `    schema: ${BUSINESS_CONTEXT_VERSION}`,
    '    tags: [business, context, profile, onboarding]',
    '---',
    '',
    '# Business Context — הקשר העסק והמשתמש',
    '',
    '## מתי לטעון את ה־Skill הזה',
    'בתחילת כל שיחה עם בעל/ת העסק, או כשצריך מידע על העסק, המשתמש, שעות העבודה,',
    'הגבולות, סגנון התקשורת או התהליכים החוזרים.',
    '',
    '## הוראות',
    '- השתמש בפרטים שלהלן כהקשר מוסמך; אל תשאל שוב מידע שכבר מופיע כאן.',
    '- כבד את הגבולות ואת הפעולות הדורשות אישור מפורש.',
    '- כשהמשתמש מעדכן פרט, עדכן את ה־Skill הזה דרך מנגנון ה־Skills של Hermes באותו מבנה בדיוק.',
    '',
    '## פרטי המשתמש והעסק',
    fieldLines(context.business),
    '',
    '## נתונים מובנים (לקריאת המערכת)',
    'ה־payload הבא הוא ההעתק המוסמך של ההקשר; אל תערוך אותו ידנית.',
    `<!-- hermes-business-context identity=${BUSINESS_CONTEXT_IDENTITY} digest=${DIGEST_PENDING} -->`,
    `<!-- payload:${encoded} -->`,
    ''
  ].join('\n')
  const digest = await contentChecksum(digestRegion(pending))
  return pending.replace(
    `<!-- hermes-business-context identity=${BUSINESS_CONTEXT_IDENTITY} digest=${DIGEST_PENDING} -->`,
    `<!-- hermes-business-context identity=${BUSINESS_CONTEXT_IDENTITY} digest=${digest.algo}:${digest.hash} -->`
  )
}

function stableJson(context: BusinessContext): string {
  // Full context (incl. completedAt) so the artifact records everything; parse recovers it.
  return JSON.stringify(context)
}

export type Identified =
  | { kind: 'absent' }
  | { kind: 'foreign'; reason: string }
  | { kind: 'owned'; context: BusinessContext; digestOk: boolean; identityOk: boolean }

// Decide ownership + integrity of whatever is stored under the business-context name.
//
// FOREIGN (never overwrite): no owner marker, an identity outside the strict whitelist, an
// unparseable payload, or a payload whose owner/skill/schema/identity invariants do not
// match OURS. A missing marker is the frontmatter-name vs directory-leaf ambiguity → foreign
// (fail safe, "do not destroy"). Strict identity means an unknown/newer VERSION is refused
// rather than trusted or clobbered by an older client.
//
// OWNED: carries our exact identity + invariants. `digestOk` is the FULL-DOCUMENT integrity
// result — it recomputes the digest over the entire file (digest region) and compares to the
// embedded value, so ANY byte change to frontmatter, human body/instructions, completedAt,
// or payload flips it to false. `identityOk` is always true for an owned result (the identity
// gate is part of the owned decision); it is surfaced so callers can assert it explicitly.
export async function identifyArtifact(content: string | null | undefined): Promise<Identified> {
  if (typeof content !== 'string' || !content.trim()) return { kind: 'absent' }
  const marker = MARKER_RE.exec(content)
  const payload = PAYLOAD_RE.exec(content)
  if (!marker || !payload) return { kind: 'foreign', reason: 'Skill קיים בשם זה ללא סימן הבעלות של Hermes Business' }
  // STRICT, version-whitelisted identity — not a loose owner-prefix match.
  if (!isAcceptedBusinessContextIdentity(marker[1])) {
    return { kind: 'foreign', reason: 'סימן הזהות של ה־Skill אינו זהות מוכרת של Hermes Business' }
  }
  let context: BusinessContext
  try {
    context = JSON.parse(decodeBase64(payload[1]))
  } catch {
    return { kind: 'foreign', reason: 'לא ניתן לפענח את ה־payload של ה־Skill' }
  }
  // Payload identity/ownership invariants must ALL match the expected constants — and the
  // payload's own `identity` must equal the marker identity (context.identity == expected).
  if (
    context?.owner !== BUSINESS_CONTEXT_OWNER ||
    context?.skill !== BUSINESS_CONTEXT_SKILL ||
    context?.schema !== BUSINESS_CONTEXT_VERSION ||
    !isAcceptedBusinessContextIdentity(context?.identity) ||
    context.identity !== marker[1]
  ) {
    return { kind: 'foreign', reason: 'הזהות/הבעלות שב־payload אינה תואמת את ההקשר העסקי המוכר' }
  }
  const expected = await documentDigest(content)
  const digestOk = `${expected.algo}:${expected.hash}` === `${marker[2]}:${marker[3]}`
  return { kind: 'owned', context, digestOk, identityOk: true }
}
