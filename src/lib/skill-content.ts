import { SKILL_DESCRIPTION_ROUTING_MAX, validateSkillName } from './business-context'

// Build a SKILL.md for a plain-language, user-created skill. The routing description is
// clamped to the 60-char routing-index budget (Hermes truncates beyond it), and the
// name is validated against the real 0.19.1 contract so we never POST a rejectable name.
export function buildSkillContent(name: string, description: string) {
  const nameCheck = validateSkillName(name)
  if (!nameCheck.ok) throw new Error(nameCheck.error)
  // A concise, routable description (<=60 chars) derived from the skill name — the name
  // is clamped so the whole line, including the "Use when asked for " prefix and the
  // trailing period, stays inside the routing-index budget.
  const prefix = 'Use when asked for '
  const budget = SKILL_DESCRIPTION_ROUTING_MAX - prefix.length - 1 // room for the trailing '.'
  const routingDescription = `${prefix}${name.slice(0, budget)}.`
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(routingDescription)}`,
    'version: 1.0.0',
    'author: Hermes Business',
    '---',
    '',
    `# ${name}`,
    '',
    description,
    '',
    'Follow this process carefully and improve it when the user provides corrections.'
  ].join('\n')
}
