import { describe, expect, it } from 'vitest'
import {
  ContractError,
  defaultPackDescription,
  loadContract,
  parseContract,
  validateContract,
  SKILL_DESCRIPTION_ROUTING_MAX
} from './contract.mjs'

// A fully valid raw contract; individual tests break exactly one thing.
function validRaw() {
  return {
    community: { name: 'כפר הדגמה', wake_word: 'תכלס' },
    admins: ['972501234567'],
    groups: [
      {
        slug: 'main',
        jid: '120363000000000001@g.us',
        name: 'קבוצת היישוב הראשית',
        purpose: 'שאלות כלליות, מידע יישובי',
        knowledge: ['general']
      },
      {
        slug: 'emergency',
        jid: '120363000000000002@g.us',
        name: 'צח"י',
        purpose: 'חירום בלבד',
        tone: 'strict',
        knowledge: ['general', 'emergency']
      }
    ],
    knowledge: {
      general: { source: 'knowledge/general.md' },
      emergency: { source: 'knowledge/emergency.md', description: 'נהלי חירום יישוביים' }
    }
  }
}

const allExist = () => true
const validate = (raw, fileExists = allExist) => validateContract(raw, { fileExists })

function expectSingleError(raw, pattern, fileExists = allExist) {
  const verdict = validate(raw, fileExists)
  expect(verdict.ok).toBe(false)
  expect(verdict.errors.some(e => pattern.test(e)), verdict.errors.join('\n')).toBe(true)
}

describe('parseContract', () => {
  it('rejects invalid YAML with a ContractError', () => {
    expect(() => parseContract('a: [unclosed')).toThrow(ContractError)
  })

  it('rejects a non-mapping document', () => {
    expect(() => parseContract('- just\n- a list\n')).toThrow(/mapping/)
    expect(() => parseContract('')).toThrow(/mapping/)
  })
})

describe('validateContract — happy path & normalization', () => {
  it('accepts the valid contract and normalizes it', () => {
    const verdict = validate(validRaw())
    expect(verdict.ok).toBe(true)
    const c = verdict.contract
    expect(c.name).toBe('כפר הדגמה')
    expect(c.wakeWord).toBe('תכלס')
    expect(c.admins).toEqual(['972501234567'])
    expect(c.groups.map(g => g.slug)).toEqual(['main', 'emergency'])
    expect(c.groups[0].tone).toBe('default') // tone defaults
    expect(c.groups[1].tone).toBe('strict')
    // A pack without an explicit description gets the derived routable one.
    expect(c.knowledge.general.description).toBe(defaultPackDescription('general'))
    expect(c.knowledge.general.description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_ROUTING_MAX)
    expect(c.knowledge.emergency.description).toBe('נהלי חירום יישוביים')
  })

  it('accepts a YAML-numeric admin entry (unquoted number in community.yaml)', () => {
    const raw = validRaw()
    raw.admins = [972501234567]
    const verdict = validate(raw)
    expect(verdict.ok).toBe(true)
    expect(verdict.contract.admins).toEqual(['972501234567'])
  })

  it('requires the fileExists callback (fail-closed, not fail-open)', () => {
    expect(() => validateContract(validRaw(), {})).toThrow(TypeError)
    expect(() => validateContract(validRaw())).toThrow(TypeError)
  })
})

describe('validateContract — community block', () => {
  it('fails on a missing community block', () => {
    const raw = validRaw()
    delete raw.community
    expectSingleError(raw, /community: block is missing/)
  })

  it('fails on a missing/empty name', () => {
    const raw = validRaw()
    raw.community.name = '  '
    expectSingleError(raw, /community\.name/)
  })

  it('fails on a missing wake word and on a multi-line wake word', () => {
    const raw = validRaw()
    delete raw.community.wake_word
    expectSingleError(raw, /community\.wake_word/)
    const raw2 = validRaw()
    raw2.community.wake_word = 'תכ\nלס'
    expectSingleError(raw2, /wake_word.*single line/)
  })
})

describe('validateContract — admins are MANDATORY (engine fact 8)', () => {
  it('fails on a missing admins list', () => {
    const raw = validRaw()
    delete raw.admins
    expectSingleError(raw, /admins: at least one admin .*REQUIRED/)
  })

  it('fails on an EMPTY admins list — never ships an open /sethome surface', () => {
    const raw = validRaw()
    raw.admins = []
    expectSingleError(raw, /admins: at least one admin .*REQUIRED/)
  })

  it("fails on the spec's own placeholder value 9725XXXXXXXX", () => {
    const raw = validRaw()
    raw.admins = ['9725XXXXXXXX']
    expectSingleError(raw, /placeholder/)
  })

  it('fails on non-digit values and on duplicates', () => {
    const raw = validRaw()
    raw.admins = ['+972-50-1234567']
    expectSingleError(raw, /8-20 digits/)
    const raw2 = validRaw()
    raw2.admins = ['972501234567', '972501234567']
    expectSingleError(raw2, /duplicate admin/)
  })
})

describe('validateContract — groups', () => {
  it('fails on a missing or empty groups list', () => {
    const raw = validRaw()
    raw.groups = []
    expectSingleError(raw, /groups: at least one group/)
  })

  it('fails on a slug that is not [a-z0-9-] or has edge hyphens', () => {
    for (const slug of ['Main', 'main group', '-main', 'main-', 'ראשית']) {
      const raw = validRaw()
      raw.groups[0].slug = slug
      expectSingleError(raw, /slug/)
    }
  })

  it('reserves the "default" slug (the default profile owns the WhatsApp connection)', () => {
    const raw = validRaw()
    raw.groups[0].slug = 'default'
    expectSingleError(raw, /reserved/)
  })

  it('fails on duplicate slugs and duplicate JIDs', () => {
    const raw = validRaw()
    raw.groups[1].slug = 'main'
    expectSingleError(raw, /duplicate slug/)
    const raw2 = validRaw()
    raw2.groups[1].jid = raw2.groups[0].jid
    expectSingleError(raw2, /duplicate JID/)
  })

  it("fails on the spec's placeholder JID and on non-@g.us ids", () => {
    const raw = validRaw()
    raw.groups[0].jid = '1203...@g.us'
    expectSingleError(raw, /placeholder/)
    const raw2 = validRaw()
    raw2.groups[0].jid = '972501234567@s.whatsapp.net' // a DM JID is NOT a group
    expectSingleError(raw2, /group JID/)
  })

  it('fails on missing name/purpose and on an unknown tone', () => {
    const raw = validRaw()
    raw.groups[0].name = ''
    expectSingleError(raw, /\.name/)
    const raw2 = validRaw()
    delete raw2.groups[0].purpose
    expectSingleError(raw2, /\.purpose/)
    const raw3 = validRaw()
    raw3.groups[0].tone = 'angry'
    expectSingleError(raw3, /tone.*not a known tone/)
  })

  it('fails on a knowledge ref that no pack declares', () => {
    const raw = validRaw()
    raw.groups[0].knowledge = ['general', 'nonexistent']
    expectSingleError(raw, /unknown knowledge pack "nonexistent"/)
  })
})

describe('validateContract — knowledge packs', () => {
  it('fails when a declared source file does not exist (fail-closed)', () => {
    const raw = validRaw()
    expectSingleError(raw, /file not found: knowledge\/general\.md/, source => source !== 'knowledge/general.md')
  })

  it('fails on an invalid pack name (it becomes the skill name)', () => {
    const raw = validRaw()
    raw.knowledge['General Pack'] = { source: 'knowledge/x.md' }
    expectSingleError(raw, /pack name/)
  })

  it('fails on a missing source path', () => {
    const raw = validRaw()
    raw.knowledge.general = {}
    expectSingleError(raw, /knowledge\.general\.source/)
  })

  it(`ENFORCES the ${SKILL_DESCRIPTION_ROUTING_MAX}-char routing budget on descriptions (engine fact 9)`, () => {
    const raw = validRaw()
    raw.knowledge.general = { source: 'knowledge/general.md', description: 'א'.repeat(SKILL_DESCRIPTION_ROUTING_MAX + 1) }
    expectSingleError(raw, /routing budget/)
    // Exactly at the budget is fine.
    const raw2 = validRaw()
    raw2.knowledge.general = { source: 'knowledge/general.md', description: 'א'.repeat(SKILL_DESCRIPTION_ROUTING_MAX) }
    expect(validate(raw2).ok).toBe(true)
  })

  it('derived descriptions stay within the routing budget even for max-length pack names', () => {
    expect(defaultPackDescription('a'.repeat(64)).length).toBeLessThanOrEqual(SKILL_DESCRIPTION_ROUTING_MAX)
  })
})

describe('loadContract', () => {
  it('aggregates ALL violations into one ContractError', () => {
    const text = ['community:', '  name: ""', 'admins: []', 'groups: []'].join('\n')
    try {
      loadContract(text, { fileExists: allExist })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError)
      expect(err.errors.length).toBeGreaterThanOrEqual(4) // name, wake_word, admins, groups
    }
  })

  it('round-trips a valid YAML document', () => {
    const text = [
      'community:',
      '  name: "כפר הדגמה"',
      '  wake_word: "תכלס"',
      'admins:',
      '  - "972501234567"',
      'groups:',
      '  - slug: main',
      '    jid: "120363000000000001@g.us"',
      '    name: "ראשית"',
      '    purpose: "מידע כללי"',
      '    knowledge: [general]',
      'knowledge:',
      '  general: { source: knowledge/general.md }'
    ].join('\n')
    const contract = loadContract(text, { fileExists: allExist })
    expect(contract.groups[0].jid).toBe('120363000000000001@g.us')
    expect(contract.knowledge.general.source).toBe('knowledge/general.md')
  })
})
