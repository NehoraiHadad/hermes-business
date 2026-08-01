import { describe, expect, it, vi } from 'vitest'
import { EMPTY_ONBOARDING } from '../constants'
import {
  BUSINESS_CONTEXT_DESCRIPTION,
  BUSINESS_CONTEXT_NAME_PREFIX,
  BUSINESS_CONTEXT_SKILL,
  SKILL_DESCRIPTION_HARD_MAX,
  SKILL_DESCRIPTION_ROUTING_MAX,
  SKILL_NAME_MAX,
  buildBusinessContext,
  businessContextSkillName,
  identifyArtifact,
  persistBusinessContext,
  providerReadyForCompletion,
  renderBusinessContextSkill,
  validateSkillDescription,
  validateSkillName,
  verifyBusinessContextPersisted,
  type BusinessContext,
  type BusinessContextClient
} from './business-context'

const data = { ...EMPTY_ONBOARDING, userName: 'דנה', businessName: 'סטודיו דנה', industry: 'עיצוב', offerings: 'מיתוג' }
const completedAt = '2026-08-01T10:00:00.000Z'
const readySnapshot = {
  provider_ready: true,
  provider_configured: true,
  provider_usable: true,
  provider_state: 'usable',
  provider_label: 'Anthropic',
  connections: [
    { id: 'google', state: 'connected' },
    { id: 'telegram', state: 'available' }
  ]
}
const context = buildBusinessContext({ data, snapshot: readySnapshot, completedAt })

function ctxWith(overrides: Partial<typeof data>, at = completedAt): BusinessContext {
  return buildBusinessContext({ data: { ...data, ...overrides }, snapshot: readySnapshot, completedAt: at })
}

describe('frontmatter limits — the EXACT Hermes 0.19.1 contract (item 1)', () => {
  it('pins the real numeric caps', () => {
    expect(SKILL_NAME_MAX).toBe(64)
    expect(SKILL_DESCRIPTION_HARD_MAX).toBe(1024)
    expect(SKILL_DESCRIPTION_ROUTING_MAX).toBe(60) // routing-index truncation budget
  })

  it('our business-context description is routable (<=60 chars)', () => {
    expect(BUSINESS_CONTEXT_DESCRIPTION.length).toBeLessThanOrEqual(60)
    expect(validateSkillDescription(BUSINESS_CONTEXT_DESCRIPTION)).toMatchObject({ ok: true, routable: true })
  })

  it('validates the description at the exact routing boundary and the hard cap', () => {
    expect(validateSkillDescription('a'.repeat(60))).toMatchObject({ ok: true, routable: true })
    expect(validateSkillDescription('a'.repeat(61))).toMatchObject({ ok: true, routable: false })
    expect(validateSkillDescription('a'.repeat(1024)).ok).toBe(true)
    expect(validateSkillDescription('a'.repeat(1025)).ok).toBe(false)
    expect(validateSkillDescription('').ok).toBe(false)
  })

  it('validates the skill name against the real regex + 64-char cap', () => {
    expect(validateSkillName('business-context').ok).toBe(true)
    expect(validateSkillName('Business_Context').ok).toBe(false) // uppercase not allowed
    expect(validateSkillName('-bad').ok).toBe(false) // must start with letter/digit
    expect(validateSkillName('a'.repeat(65)).ok).toBe(false)
  })
})

describe('versioned skill name — a deterministic, valid content address (immutable versions)', () => {
  it('derives business-context-<digest prefix>, a valid routable name, deterministic per context', async () => {
    const name = await businessContextSkillName(context)
    expect(name.startsWith(BUSINESS_CONTEXT_NAME_PREFIX)).toBe(true)
    expect(validateSkillName(name).ok).toBe(true)
    // Deterministic: same context → same name.
    expect(await businessContextSkillName(context)).toBe(name)
    // A different context (or a different completedAt) → a DIFFERENT immutable version.
    expect(await businessContextSkillName(ctxWith({ businessName: 'אחר' }))).not.toBe(name)
    expect(await businessContextSkillName(ctxWith({}, '2026-09-09T00:00:00.000Z'))).not.toBe(name)
  })
})

describe('render + parse — routable, owned, checksum-verified (items 4, 12)', () => {
  it('renders a valid SKILL.md with the versioned name, a <=60 description and the full context', async () => {
    const md = await renderBusinessContextSkill(context)
    const name = await businessContextSkillName(context)
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toMatch(new RegExp(`description: .{1,60}\\n`))
    expect(md).toContain(`name: ${name}`)
    // Human-readable fields present (operational, not a receipt-only blob).
    expect(md).toContain('סטודיו דנה')
    expect(md).toContain('## מתי לטעון')
    // Machine payload recovered via the marker, NOT a ``` fence.
    expect(md).not.toContain('```')
    const id = await identifyArtifact(md)
    expect(id.kind).toBe('owned')
    if (id.kind === 'owned') {
      expect(id.digestOk).toBe(true)
      expect(id.identityOk).toBe(true)
      for (const key of Object.keys(EMPTY_ONBOARDING)) expect(key in id.context.business).toBe(true)
      expect(id.context.business.businessName).toBe('סטודיו דנה')
      expect(id.context.provider).toEqual({ ready: true, configured: true, usable: true, state: 'usable', label: 'Anthropic' })
    }
  })

  it('prefers SHA-256 (a full-document integrity digest, not authentication) when WebCrypto is present', async () => {
    const md = await renderBusinessContextSkill(context)
    expect(md).toMatch(/digest=sha-256:[0-9a-f]{64}/)
  })

  it('digest covers the FULL rendered document — ANY byte change to body/frontmatter/payload/completedAt is detected', async () => {
    const md = await renderBusinessContextSkill(context)
    // (1) Human-readable BODY tamper — previously undetected, now MUST fail the digest.
    const bodyTamper = md.replace('סטודיו דנה', 'מתחזה')
    const idBody = await identifyArtifact(bodyTamper)
    expect(idBody.kind === 'owned' && idBody.digestOk).toBe(false)
    // (2) FRONTMATTER tamper (author) — must fail the digest.
    const fmTamper = md.replace('author: Hermes Business', 'author: Attacker')
    const idFm = await identifyArtifact(fmTamper)
    expect(idFm.kind === 'owned' && idFm.digestOk).toBe(false)
    // (3) PAYLOAD tamper — must fail the digest.
    const payloadCorrupt = md.replace(/payload:[A-Za-z0-9+/=]+/, m => m.slice(0, -4) + 'AAAA')
    const idPayload = await identifyArtifact(payloadCorrupt)
    expect(idPayload.kind === 'owned' && idPayload.digestOk).toBe(false)
    // A stripped/absent marker reads foreign (never overwrite).
    expect((await identifyArtifact('just a foreign skill')).kind).toBe('foreign')
  })

  it('re-digest of the untouched rendered document verifies (round-trip stable)', async () => {
    const md = await renderBusinessContextSkill(context)
    const id = await identifyArtifact(md)
    expect(id.kind === 'owned' && id.digestOk).toBe(true)
  })

  it('STRICT identity — an unknown/newer version or off-whitelist identity reads FOREIGN, not owned', async () => {
    const md = await renderBusinessContextSkill(context)
    // Bump the marker identity to an un-whitelisted version — must be refused as foreign.
    const bumped = md.replace('identity=hermes-business:business-context@1', 'identity=hermes-business:business-context@2')
    expect((await identifyArtifact(bumped)).kind).toBe('foreign')
    // A completely different owner prefix is foreign too.
    const other = md.replace('identity=hermes-business:business-context@1', 'identity=someone-else:business-context@1')
    expect((await identifyArtifact(other)).kind).toBe('foreign')
  })
})

describe('providerReadyForCompletion — fail closed', () => {
  it('is true only when the snapshot proves an authoritative-ready provider', () => {
    expect(providerReadyForCompletion(readySnapshot)).toBe(true)
    expect(providerReadyForCompletion({ provider_ready: false })).toBe(false)
    expect(providerReadyForCompletion({})).toBe(false)
    expect(providerReadyForCompletion({ provider_ready: 'yes' })).toBe(false)
  })
})

// A fake Hermes skills backend exposing ONLY the official surfaces persistence is allowed to
// use: listSkills, getSkillContent, the enable/disable toggle, and the IMMUTABLE create
// (createSkillRaw = POST /api/skills; it rejects a name that already exists). There is no
// custom write engine and NO update route — a rewrite/overwrite is impossible by construction.
function fakeSkills(initial: Array<{ name: string; content: string; enabled?: boolean }> = []) {
  const store = new Map<string, { content: string; enabled: boolean }>()
  for (const s of initial) store.set(s.name, { content: s.content, enabled: s.enabled ?? true })
  const calls: string[] = []
  const client = {
    store,
    calls,
    listSkills: vi.fn(async () => [...store.entries()].map(([name, v]) => ({ name, enabled: v.enabled }))),
    getSkillContent: vi.fn(async (name: string) => ({ content: store.get(name)?.content })),
    setSkillEnabled: vi.fn(async (name: string, enabled: boolean) => {
      calls.push(`enable:${name}:${enabled}`)
      const cur = store.get(name)
      if (cur) cur.enabled = enabled
    }),
    // Official immutable create: 400/409 if the name is taken. NEVER overwrites.
    createSkillRaw: vi.fn(async (name: string, content: string) => {
      calls.push(`create:${name}`)
      if (store.has(name)) throw new Error('400 already exists')
      store.set(name, { content, enabled: true })
    })
  }
  return client as typeof client & BusinessContextClient
}

const FOREIGN = (name: string) => `---\nname: ${name}\ndescription: someone elses skill\n---\n# mine\n`

describe('persistBusinessContext — official create + enable/disable only, immutable & fail closed (items 3, 7)', () => {
  it('creates an immutable version via the official POST, enables it, confirms bytes + checksum', async () => {
    const c = fakeSkills()
    const name = await businessContextSkillName(context)
    await expect(persistBusinessContext(c, context)).resolves.toBeUndefined()
    expect(c.calls).toContain(`create:${name}`)
    expect(c.store.get(name)?.content).toBe(await renderBusinessContextSkill(context))
    expect(c.store.get(name)?.enabled).toBe(true)
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(true)
  })

  it('is idempotent — an identical owned version already present is enabled, never recreated/rewritten', async () => {
    const name = await businessContextSkillName(context)
    const desired = await renderBusinessContextSkill(context)
    const c = fakeSkills([{ name, content: desired, enabled: true }])
    await persistBusinessContext(c, context)
    expect(c.calls).not.toContain(`create:${name}`) // no create — already present
    expect(c.store.get(name)?.content).toBe(desired) // byte-identical, untouched
    expect(c.store.get(name)?.enabled).toBe(true)
  })

  it('new data → a NEW immutable version is created + enabled; the prior owned version is DISABLED, preserved, never overwritten', async () => {
    const older = ctxWith({ businessName: 'שם ישן' })
    const olderName = await businessContextSkillName(older)
    const olderContent = await renderBusinessContextSkill(older)
    const c = fakeSkills([{ name: olderName, content: olderContent, enabled: true }])
    await persistBusinessContext(c, context)
    const newName = await businessContextSkillName(context)
    expect(newName).not.toBe(olderName)
    expect(c.calls).toContain(`create:${newName}`)
    // Prior version is PRESERVED byte-for-byte and merely deactivated — never overwritten/deleted.
    expect(c.store.get(olderName)?.content).toBe(olderContent)
    expect(c.store.get(olderName)?.enabled).toBe(false)
    // Exactly one active version — the newest.
    expect(c.store.get(newName)?.enabled).toBe(true)
  })

  it('re-enables a DISABLED owned version of the same context', async () => {
    const name = await businessContextSkillName(context)
    const c = fakeSkills([{ name, content: await renderBusinessContextSkill(context), enabled: false }])
    await persistBusinessContext(c, context)
    expect(c.calls).toContain(`enable:${name}:true`)
    expect(c.store.get(name)?.enabled).toBe(true)
  })

  it('REFUSES a FOREIGN skill squatting the exact versioned name (never destroys, guides the user)', async () => {
    const name = await businessContextSkillName(context)
    const c = fakeSkills([{ name, content: FOREIGN(name), enabled: true }])
    await expect(persistBusinessContext(c, context)).rejects.toThrow(/אינו שייך ל־Hermes Business/)
    expect(c.store.get(name)?.content).toContain('# mine') // untouched
    expect(c.calls).not.toContain(`create:${name}`)
    expect(c.calls.some(x => x.startsWith('enable:'))).toBe(false)
  })

  it('REFUSES when the versioned name holds DIFFERENT owned bytes (content-address collision) — never overwrites', async () => {
    const name = await businessContextSkillName(context)
    // Owned + valid, but NOT the bytes we would render for this context.
    const otherOwned = await renderBusinessContextSkill(ctxWith({ businessName: 'תוכן אחר' }))
    const c = fakeSkills([{ name, content: otherOwned, enabled: true }])
    await expect(persistBusinessContext(c, context)).rejects.toThrow(/אינו שייך ל־Hermes Business/)
    expect(c.store.get(name)?.content).toBe(otherOwned) // untouched
  })

  it('a create COLLISION where a racer stored OUR identical content → converges (adopt + enable), no overwrite', async () => {
    const c = fakeSkills()
    const name = await businessContextSkillName(context)
    const desired = await renderBusinessContextSkill(context)
    c.createSkillRaw = vi.fn(async (n: string) => {
      c.calls.push(`create:${n}`)
      c.store.set(n, { content: desired, enabled: true }) // racer wrote exactly our content
      throw new Error('409 already exists')
    })
    await expect(persistBusinessContext(c, context)).resolves.toBeUndefined()
    expect(c.store.get(name)?.content).toBe(desired)
    expect(c.store.get(name)?.enabled).toBe(true)
  })

  it('a create COLLISION where a FOREIGN skill won the race → fails clearly, never overwrites', async () => {
    const c = fakeSkills()
    const name = await businessContextSkillName(context)
    c.createSkillRaw = vi.fn(async (n: string) => {
      c.calls.push(`create:${n}`)
      c.store.set(n, { content: FOREIGN(n), enabled: true })
      throw new Error('409 already exists')
    })
    await expect(persistBusinessContext(c, context)).rejects.toThrow(/אינו שייך ל־Hermes Business/)
    expect(c.store.get(name)?.content).toContain('# mine') // preserved
  })

  it('FAILS CLOSED and propagates a hard create error (not a recoverable collision)', async () => {
    const c = fakeSkills()
    c.createSkillRaw = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(persistBusinessContext(c, context)).rejects.toThrow(/network down/)
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(false)
  })

  it('disables ONLY owned prior versions — a foreign same-family skill is left untouched', async () => {
    const older = ctxWith({ businessName: 'ישן' })
    const olderName = await businessContextSkillName(older)
    const foreignName = `${BUSINESS_CONTEXT_NAME_PREFIX}foreignxx`
    const c = fakeSkills([
      { name: olderName, content: await renderBusinessContextSkill(older), enabled: true },
      { name: foreignName, content: FOREIGN(foreignName), enabled: true }
    ])
    await persistBusinessContext(c, context)
    expect(c.store.get(olderName)?.enabled).toBe(false) // owned → deactivated
    expect(c.store.get(foreignName)?.enabled).toBe(true) // foreign → untouched
    expect(c.store.get(foreignName)?.content).toBe(FOREIGN(foreignName)) // never overwritten
  })
})

describe('verifyBusinessContextPersisted — resume gate finds an enabled owned version with valid digest (item 2)', () => {
  it('is TRUE for a freshly persisted, listed, enabled, intact version', async () => {
    const name = await businessContextSkillName(context)
    const c = fakeSkills([{ name, content: await renderBusinessContextSkill(context), enabled: true }])
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(true)
  })

  it('is FALSE when the owned version is DISABLED (present content, toggled off → will not route)', async () => {
    const name = await businessContextSkillName(context)
    const c = fakeSkills([{ name, content: await renderBusinessContextSkill(context), enabled: false }])
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(false)
  })

  it('is FALSE when no business-context version is in the index', async () => {
    const c = fakeSkills()
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(false)
  })

  it('is FALSE when the on-disk BODY was tampered (full-document digest mismatch)', async () => {
    const name = await businessContextSkillName(context)
    const tampered = (await renderBusinessContextSkill(context)).replace('סטודיו דנה', 'מתחזה')
    const c = fakeSkills([{ name, content: tampered, enabled: true }])
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(false)
  })

  it('is FALSE when the FRONTMATTER was tampered', async () => {
    const name = await businessContextSkillName(context)
    const tampered = (await renderBusinessContextSkill(context)).replace('author: Hermes Business', 'author: Attacker')
    const c = fakeSkills([{ name, content: tampered, enabled: true }])
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(false)
  })

  it('is FALSE when a listSkills read fails (fail closed)', async () => {
    const name = await businessContextSkillName(context)
    const c = fakeSkills([{ name, content: await renderBusinessContextSkill(context), enabled: true }])
    c.listSkills = vi.fn(async () => {
      throw new Error('index unreadable')
    })
    await expect(verifyBusinessContextPersisted(c)).resolves.toBe(false)
  })
})
