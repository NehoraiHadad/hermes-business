import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Static contract for the conversation-first redesign of the two shipped
// business Skills. These are the behavioral guarantees the UI relies on:
// onboarding reads as one conversation (no wizard), knowledge is persisted
// only after explicit confirmation, connections are intent-led, and the
// partner keeps read/draft vs send/spend/delete boundaries explicit.

const repoRoot = path.resolve(__dirname, '..', '..')
const bootstrap = readFileSync(
  path.join(repoRoot, 'hermes-plugin', 'business-shell', 'skills', 'business-bootstrap', 'SKILL.md'),
  'utf8'
)
const partner = readFileSync(
  path.join(repoRoot, 'hermes-plugin', 'business-partner', 'SKILL.md'),
  'utf8'
)

describe('business-bootstrap conversation-first contract', () => {
  it('reads as one conversation: no numbered phases, steps, or checklist framing', () => {
    expect(bootstrap).not.toMatch(/^#+\s*Phase\s+\d/im)
    expect(bootstrap).not.toMatch(/^#+\s*Step\s+\d/im)
    expect(bootstrap).toMatch(/Never show phases/i)
    expect(bootstrap).toMatch(/Ask one question at a time/)
  })

  it('reaches a useful question quickly with bounded read-only inspection', () => {
    expect(bootstrap).toMatch(/at most three short read-only/i)
    expect(bootstrap).toMatch(/first useful question/i)
  })

  it('persists business knowledge only via draft -> recap -> explicit confirm', () => {
    expect(bootstrap).toMatch(/\*\*Draft\*\*/)
    expect(bootstrap).toMatch(/\*\*Recap\*\*/)
    expect(bootstrap).toMatch(/\*\*Confirm\*\*/)
    expect(bootstrap).toMatch(/\*\*Persist\*\*/)
    expect(bootstrap).toMatch(/explicit confirmation/i)
    // unknowns stay unknown; the user can correct or skip
    expect(bootstrap).toMatch(/stay unknown/i)
    expect(bootstrap).toMatch(/correct any item/i)
    expect(bootstrap).toMatch(/skip any item/i)
    expect(bootstrap).toMatch(/business-context/)
  })

  it('keeps connections just-in-time, intent-led, and official-by-default', () => {
    expect(bootstrap).toMatch(/Recommend one connection only when the user's \*stated goal\* needs it/)
    expect(bootstrap).toMatch(/never more than one at a time/i)
    expect(bootstrap).toMatch(/Never ask the user to\s+understand how an integration is implemented/i)
    expect(bootstrap).toMatch(/official, recommended Hermes path/i)
    // unofficial routes only as a disclosed fallback
    expect(bootstrap).toMatch(/cannot satisfy the expressed goal/i)
    expect(bootstrap).toMatch(/disclose the risk in plain language/i)
  })

  it('delivers first value before optional setup and keeps hard safety gates', () => {
    expect(bootstrap).toMatch(/First value before optional setup/i)
    expect(bootstrap).toMatch(/Never request API keys/)
    expect(bootstrap).toMatch(/requires explicit approval/i)
    expect(bootstrap).toMatch(/read-only check/i)
  })
})

describe('business-partner concise-partner contract', () => {
  it('clarifies the outcome and works from confirmed business context', () => {
    expect(partner).toMatch(/outcome the owner actually wants/i)
    expect(partner).toMatch(/business-context/)
    expect(partner).toMatch(/never invent business facts/i)
  })

  it('suggests the smallest high-leverage next step without forcing delegation', () => {
    expect(partner).toMatch(/smallest high-leverage\s+next step/i)
    expect(partner).toMatch(/do the\s+work directly/i)
    expect(partner).toMatch(/genuinely splits/i)
  })

  it('keeps the read/draft vs send/spend/delete boundary explicit', () => {
    expect(partner).toMatch(/drafting are always allowed/i)
    expect(partner).toMatch(/explicit owner approval/i)
    expect(partner).toMatch(/sending a message or email/)
    expect(partner).toMatch(/spending money/)
    expect(partner).toMatch(/deleting or overwriting/)
    expect(partner).toMatch(/separate, explicit\s+approval/i)
  })

  it('keeps unattended check-ins draft-only under cron_mode deny', () => {
    expect(partner).toMatch(/cron_mode: deny/)
    expect(partner).toMatch(/Never\s+send, spend, publish, delete, commit/i)
  })
})
