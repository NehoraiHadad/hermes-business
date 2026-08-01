// Public surface for the durable, ROUTABLE business-context skill — the single source
// of truth for onboarding completion. Replaces the receipt-only JSON blob: a genuinely
// operational SKILL.md (valid <=60 frontmatter, triggers, instructions, full context)
// with an authoritative machine payload, ownership-safe persistence, and exact-byte
// verification. See identity/payload/skill/persist for the pieces.

export {
  BUSINESS_CONTEXT_SKILL,
  BUSINESS_CONTEXT_NAME_PREFIX,
  BUSINESS_CONTEXT_OWNER,
  BUSINESS_CONTEXT_IDENTITY,
  BUSINESS_CONTEXT_DESCRIPTION,
  SKILL_NAME_MAX,
  SKILL_DESCRIPTION_HARD_MAX,
  SKILL_DESCRIPTION_ROUTING_MAX,
  isBusinessContextVariantName,
  validateSkillName,
  validateSkillDescription
} from './identity'
export { buildBusinessContext, canonicalPayload, contentChecksum, type BusinessContext } from './payload'
export { renderBusinessContextSkill, businessContextSkillName, identifyArtifact, type Identified } from './skill'
export {
  persistBusinessContext,
  verifyBusinessContextPersisted,
  foreignCollisionError,
  type BusinessContextClient
} from './persist'

// Completion requires an authoritative-ready provider by default (the product needs a
// working provider). Fail closed on configured-but-unverified / unknown / absent.
export function providerReadyForCompletion(snapshot: Record<string, unknown>): boolean {
  return snapshot?.provider_ready === true
}
