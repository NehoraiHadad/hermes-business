const path = require('node:path')

// The official named personality installed under `agent.personalities` — the ONE
// map Hermes 0.19.1 actually reads (config.get('agent').get('personalities')).
// A personality VALUE is a plain prompt string (Hermes also accepts
// {system_prompt,tone,style}; it does NOT understand name/label/description). The
// name is the map KEY. Selection is a separate string: config.display.personality.
//
// The prompt is SMALL on purpose — the detailed behaviour lives in the packaged
// `business-partner` Hermes Skill, not in a giant system prompt. Enabling partner
// mode flips config.display.personality to this name; disabling restores the exact
// previous selector. The named personality itself is left in place (harmless when
// inactive) so re-enabling is instantaneous and idempotent.

const PERSONALITY_NAME = 'business-partner'
const PARTNER_SKILL_ID = 'business-partner'

// Human-facing metadata for the desktop UI only — Hermes has no config field for
// these, so they are NEVER sent to /api/config.
const PERSONALITY_LABEL = 'Business Partner'
const PERSONALITY_DESCRIPTION =
  'Proactive business partner: challenges assumptions, researches, drafts proposals, and delegates to native sub-agent teams. Never sends, spends, publishes, deletes, or commits without explicit approval.'

// The actual personality value written to agent.personalities[PERSONALITY_NAME].
// Must be a non-empty prompt string so Hermes' _resolve_personality_prompt keeps it.
const PERSONALITY_PROMPT = [
  'You are the owner\'s proactive business partner, not a passive assistant.',
  'Challenge weak assumptions, research before acting, and present complete proposals with tradeoffs and a small reversible first step.',
  'Use Hermes native delegate_task to run focused sub-agent teams and coordinate their results.',
  'Follow the packaged business-partner Skill for detailed behaviour.',
  'Hard boundary: never silently send messages/emails, spend money, publish, delete, commit code, change permissions, or make external commitments — each needs explicit in-the-moment approval. Drafts and research are always allowed.',
  'Keep approvals manual and scheduled jobs deny-by-default. Only propose cron check-ins after the owner explicitly enables them.'
].join(' ')

function partnerSkillSource() {
  return path.join(__dirname, '..', 'hermes-plugin', 'business-partner', 'SKILL.md')
}

module.exports = {
  PERSONALITY_NAME,
  PARTNER_SKILL_ID,
  PERSONALITY_LABEL,
  PERSONALITY_DESCRIPTION,
  PERSONALITY_PROMPT,
  partnerSkillSource
}
