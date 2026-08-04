import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SKILL_DESCRIPTION_ROUTING_MAX } from '../../src/lib/business-context/identity'

// Every SKILL.md this repo ships INTO Hermes must keep its frontmatter
// `description` inside Hermes' routing budget: the installed agent's skill
// index truncates descriptions to 60 chars (agent/skill_utils.py,
// SKILL_PROMPT_DESC_LIMIT — mirrored here by SKILL_DESCRIPTION_ROUTING_MAX),
// and a truncated description guts the model's ability to route to the skill.
// This regressed silently once: business-partner shipped a 235-char
// description, so what the model actually saw every turn was "Use when the
// owner has enabled Business Partner mode and ..." — no triggers, no safety
// boundary. The rich "when to use" detail belongs in the skill BODY.

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

// The shipped skill roots: everything under hermes-plugin/ that carries a
// SKILL.md is installed into the user's Hermes by the product installer.
function collectSkillFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectSkillFiles(full))
      continue
    }
    if (entry === 'SKILL.md') out.push(full)
  }
  return out
}

// Same normalization the installed agent applies before measuring
// (_normalize_skill_description strips whitespace and surrounding quotes).
function readDescription(skillFile) {
  const source = readFileSync(skillFile, 'utf8')
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = frontmatter && frontmatter[1].split(/\r?\n/).find(l => l.startsWith('description:'))
  if (!line) return null
  return line.slice('description:'.length).trim().replace(/^['"]|['"]$/g, '')
}

describe('shipped skill descriptions fit Hermes\' 60-char routing budget', () => {
  const skillFiles = collectSkillFiles(path.join(repoRoot, 'hermes-plugin'))

  it('finds the shipped skills at all (guard against a silent move)', () => {
    const names = skillFiles.map(file => path.relative(repoRoot, file))
    expect(names.some(name => name.includes('business-partner'))).toBe(true)
    expect(names.some(name => name.includes('business-bootstrap'))).toBe(true)
  })

  it.each([['SKILL_DESCRIPTION_ROUTING_MAX mirrors the installed agent limit', SKILL_DESCRIPTION_ROUTING_MAX, 60]])(
    '%s',
    (_label, actual, expected) => expect(actual).toBe(expected)
  )

  it('every shipped SKILL.md description is present and within the routing budget', () => {
    const failures = []
    for (const file of skillFiles) {
      const description = readDescription(file)
      const rel = path.relative(repoRoot, file)
      if (!description) {
        failures.push(`${rel}: missing description`)
        continue
      }
      if (description.length > SKILL_DESCRIPTION_ROUTING_MAX) {
        failures.push(`${rel}: ${description.length} chars (> ${SKILL_DESCRIPTION_ROUTING_MAX}) — "${description.slice(0, 57)}..."`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
