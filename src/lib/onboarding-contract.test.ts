import { describe, expect, it } from 'vitest'
import {
  EMPTY_ONBOARDING,
  LEGACY_ALIASES,
  ONBOARDING_KEYS,
  ONBOARDING_STEPS,
  normalizeOnboarding
} from '../../shared/onboarding-contract.js'
import { EMPTY_ONBOARDING as CONSTANTS_EMPTY } from '../constants'

describe('canonical onboarding contract', () => {
  it('re-exports one shared default through React constants (no second copy)', () => {
    expect(CONSTANTS_EMPTY).toBe(EMPTY_ONBOARDING)
  })

  it('every legacy alias and step field maps onto a canonical key (schema parity)', () => {
    for (const target of Object.values(LEGACY_ALIASES)) expect(ONBOARDING_KEYS).toContain(target)
    const stepKeys = ONBOARDING_STEPS.flatMap(step => step.fields.map(field => field.key))
    for (const key of stepKeys) expect(ONBOARDING_KEYS).toContain(key)
    // Every canonical field is asked somewhere — the form and the data contract agree.
    for (const key of ONBOARDING_KEYS) expect(stepKeys).toContain(key)
  })

  it('migrates legacy plugin-form keys into canonical, preserving user values', () => {
    const legacy = {
      name: 'דנה',
      answerStyle: 'קצר ומעשי',
      repetitiveTasks: 'תזכורות',
      openingHours: '08:00–17:00',
      voice: 'חם ומקצועי',
      forbiddenPromises: 'לא להתחייב למחיר',
      processes: 'הצעות מחיר',
      businessName: 'סטודיו אור',
      unknownField: 'drop me'
    }
    const normalized = normalizeOnboarding(legacy)
    expect(normalized).toMatchObject({
      userName: 'דנה',
      responseStyle: 'קצר ומעשי',
      timeSavers: 'תזכורות',
      businessHours: '08:00–17:00',
      communicationStyle: 'חם ומקצועי',
      restrictions: 'לא להתחייב למחיר',
      recurringProcesses: 'הצעות מחיר',
      businessName: 'סטודיו אור'
    })
    expect(normalized).not.toHaveProperty('unknownField')
    expect(Object.keys(normalized).sort()).toEqual([...ONBOARDING_KEYS].sort())
  })

  it('coerces approvals (legacy string or array) into a canonical list', () => {
    expect(normalizeOnboarding({ approvals: 'שליחה, מחיקה' }).approvals).toEqual(['שליחה', 'מחיקה'])
    expect(normalizeOnboarding({ approvals: ['א', 'ב'] }).approvals).toEqual(['א', 'ב'])
    expect(normalizeOnboarding({ approvals: '' }).approvals).toEqual(EMPTY_ONBOARDING.approvals)
  })

  it('canonical answers survive normalization unchanged (idempotent)', () => {
    const data = { ...EMPTY_ONBOARDING, userName: 'רון', businessName: 'רון בע"מ' }
    expect(normalizeOnboarding(data)).toEqual(data)
    expect(normalizeOnboarding(normalizeOnboarding(data))).toEqual(data)
  })

  it('shared-state parity: React-form and legacy plugin-form yield the same canonical facts', () => {
    const fromReact = { userName: 'דנה', businessName: 'סטודיו אור', communicationStyle: 'חם ומקצועי' }
    const fromPlugin = { name: 'דנה', businessName: 'סטודיו אור', voice: 'חם ומקצועי' }
    expect(normalizeOnboarding(fromReact)).toEqual(normalizeOnboarding(fromPlugin))
  })
})
