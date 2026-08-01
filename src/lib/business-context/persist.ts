import { BUSINESS_CONTEXT_SKILL, isBusinessContextVariantName } from './identity'
import type { BusinessContext } from './payload'
import { businessContextSkillName, identifyArtifact, renderBusinessContextSkill } from './skill'

// Business-context persistence uses ONLY the official Hermes 0.19.1 Skills API surfaces exposed
// by rest-skills.ts: IMMUTABLE versioned skill creation (POST /api/skills, 400/409 if the name is
// taken) plus the official enable/disable toggle (PUT /api/skills/toggle). There is no custom
// write engine, no update/overwrite, and no lock: each onboarding renders a content-addressed
// version named `business-context-<digest>`, creates it once, enables it, and DISABLES the older
// owned versions (never deleting or overwriting them). Prior data is preserved as immutable,
// disabled skills; exactly one version stays active. Reads/list/toggle stay official too.
export type SkillMeta = { name?: string; enabled?: boolean }
export type BusinessContextClient = {
  listSkills(): Promise<SkillMeta[]>
  getSkillContent(name: string): Promise<{ content?: string } | null>
  setSkillEnabled(name: string, enabled: boolean): Promise<unknown>
  // The ONLY write path: official immutable create. Rejects (400/409) when the name already
  // exists — the caller then verifies the existing bytes are our own identical owned content.
  createSkillRaw(name: string, content: string): Promise<unknown>
}

const FOREIGN_PREFIX = 'כבר קיים Skill בשם זה שאינו שייך ל־Hermes Business'

// A skill in the business-context name family exists but is NOT our identical owned artifact —
// a foreign skill squatting the name (or a content-address collision with different bytes). We
// refuse rather than overwrite so the existing skill is never destroyed; guide the user, leaking
// no paths/tokens/internals.
export function foreignCollisionError(name: string, reason: string): Error {
  return new Error(
    `${FOREIGN_PREFIX} ("${name}": ${reason}). כדי להגן על ה־Skill הקיים, ההיכרות לא נשמרה. שנה/י את שמו או הסר/י אותו ידנית ב־Hermes ונסה/י שוב.`
  )
}

// The official create returned a name-taken error (400/409). Distinguished from a hard failure
// (network/permission) so only a genuine collision triggers the read-and-verify-identical branch.
function isCreateCollision(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /already exists|conflict|\b409\b|\b400\b/i.test(msg)
}

async function readContent(client: BusinessContextClient, name: string): Promise<string | null> {
  const res = await client.getSkillContent(name).catch(() => null)
  return typeof res?.content === 'string' ? res.content : null
}

// The name is a content address, so an EXISTING skill under it must be our byte-identical owned
// content — otherwise a foreign skill (or a genuine digest collision with different owned bytes)
// holds the name and we refuse rather than adopt/overwrite it.
async function assertOwnedIdentical(client: BusinessContextClient, name: string, desired: string): Promise<void> {
  const content = await readContent(client, name)
  const id = await identifyArtifact(content)
  if (id.kind !== 'owned') {
    throw foreignCollisionError(name, id.kind === 'foreign' ? id.reason : 'שם ה־Skill תפוס אך תוכנו אינו קריא או אינו שלנו')
  }
  if (!id.digestOk || content !== desired) {
    throw foreignCollisionError(name, 'קיים Skill באותו שם עם תוכן שונה משלנו')
  }
}

// Persist the routable business-context skill through official surfaces only, and FAIL CLOSED.
// Renders a content-addressed immutable version, creates it (idempotent — an already-present
// version must be our identical owned content or it is a foreign collision), enables it, verifies
// the enabled bytes are ours + intact, then disables every OTHER owned business-context version so
// exactly one stays active. Older versions are preserved (never deleted/overwritten); foreign
// same-family skills are never touched (ownership is verified before disabling).
export async function persistBusinessContext(client: BusinessContextClient, context: BusinessContext): Promise<void> {
  const name = await businessContextSkillName(context)
  const desired = await renderBusinessContextSkill(context)

  const listedBefore = await client.listSkills().catch(() => [] as SkillMeta[])
  const already = listedBefore.some(s => s?.name === name)

  if (already) {
    // Name present in the index → it must be our identical owned content (enable, don't recreate).
    await assertOwnedIdentical(client, name, desired)
  } else {
    try {
      await client.createSkillRaw(name, desired)
    } catch (err) {
      if (!isCreateCollision(err)) throw err // hard failure (network/permission) → fail closed
      // Created concurrently under our name → accept only our own identical owned content.
      await assertOwnedIdentical(client, name, desired)
    }
  }

  // Enable our version (official toggle). Idempotent if it was already enabled.
  await client.setSkillEnabled(name, true)

  // Verify the enabled artifact is on disk, exactly our bytes, owned and integrity-intact.
  const confirmed = await readContent(client, name)
  if (confirmed !== desired) {
    throw new Error('תוכן ה־Skill שנשמר ב־Hermes אינו תואם להקשר המבוקש; ההיכרות לא סומנה כהושלמה')
  }
  const finalId = await identifyArtifact(confirmed)
  if (finalId.kind !== 'owned' || !finalId.digestOk) {
    throw new Error('לא ניתן היה לאמת את תקינות ה־Skill שנשמר ב־Hermes; ההיכרות לא סומנה כהושלמה')
  }

  // Single active version: disable every OTHER owned business-context version. Immutable creates
  // mean we never overwrite; disabling (not deleting) preserves all prior data while only the
  // newest routes. Foreign skills sharing the name family are verified NOT ours and left alone.
  const listedNow = await client.listSkills().catch(() => [] as SkillMeta[])
  for (const meta of listedNow) {
    const other = meta?.name
    if (!isBusinessContextVariantName(other) || other === name || meta.enabled === false) continue
    const id = await identifyArtifact(await readContent(client, other))
    if (id.kind === 'owned') await client.setSkillEnabled(other, false)
  }
}

// Durable completion check for restart/resume. Finds an ENABLED, owned business-context version in
// the index whose on-disk content carries our exact identity AND a matching FULL-DOCUMENT digest.
// A disabled/missing/tampered version does not count. Fails closed on any read/list error.
export async function verifyBusinessContextPersisted(client: BusinessContextClient): Promise<boolean> {
  const listed = await client.listSkills().catch(() => null)
  if (!listed) return false
  for (const meta of listed) {
    const name = meta?.name
    if (!isBusinessContextVariantName(name) || meta.enabled === false) continue
    const id = await identifyArtifact(await readContent(client, name))
    if (id.kind === 'owned' && id.digestOk) return true
  }
  return false
}

// Re-exported for callers/tests that build the family name directly.
export { BUSINESS_CONTEXT_SKILL }
