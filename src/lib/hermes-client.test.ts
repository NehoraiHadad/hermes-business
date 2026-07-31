import { describe, expect, it } from 'vitest'
import { buildSkillContent } from './skill-content'

describe('Hermes Skill document creation', () => {
  it('keeps the routing description inside Hermes 60-character budget', () => {
    const content = buildSkillContent(
      'a-very-long-business-process-name-that-needs-truncation',
      'This detailed procedure belongs in the body and may be much longer.'
    )
    const routingLine = content.split('\n').find(line => line.startsWith('description: '))
    const routingDescription = JSON.parse(routingLine?.slice('description: '.length) || '""')
    expect(routingDescription.length).toBeLessThanOrEqual(60)
    expect(routingDescription.endsWith('.')).toBe(true)
    expect(content).toContain('This detailed procedure belongs in the body')
  })
})
