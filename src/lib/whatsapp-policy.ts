export type WhatsappPolicyMode = 'read_only' | 'selected_chats'
export type WhatsappBehavior = 'monitor' | 'assist'
export type WhatsappPlatform = 'whatsapp' | 'whatsapp_cloud'
export type WhatsappSource = {
  id: string
  name: string
  type: 'dm' | 'group'
  platform: WhatsappPlatform
}

export type WhatsappPolicy = {
  version: 2
  mode: WhatsappPolicyMode
  behavior: WhatsappBehavior
  instructions: string
  reply_chats: string[]
  reply_groups: string[]
  sources: WhatsappSource[]
}

export const DEFAULT_WHATSAPP_POLICY: WhatsappPolicy = {
  version: 2,
  mode: 'read_only',
  behavior: 'monitor',
  instructions: '',
  reply_chats: [],
  reply_groups: [],
  sources: []
}

export function normalizeChat(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^whatsapp(?:_cloud)?:/, '')
    .replace(/^\+/, '')
    .replace(/@(?:s\.whatsapp\.net|lid)$/i, '')
  return /^[\d\s().-]+$/.test(normalized)
    ? normalized.replace(/\D/g, '')
    : normalized
}

export function parseChatList(text: string): string[] {
  return [...new Set(String(text || '').split(/[,\n]/).map(normalizeChat).filter(Boolean))]
}

export function chatsToText(chats: string[]): string {
  return (chats || []).join('\n')
}

export function allowedUsersForPolicy(policy: WhatsappPolicy): string {
  return policy.mode === 'selected_chats' ? policy.reply_chats.join(',') : ''
}

export type PolicyValidation = { policy: WhatsappPolicy } | { error: string }

export function buildWhatsappPolicy(
  mode: WhatsappPolicyMode,
  selected: WhatsappSource[],
  behavior: WhatsappBehavior = 'monitor',
  instructions = ''
): PolicyValidation {
  const sources = [...new Map(selected.map(source => {
    const platform = source.platform === 'whatsapp_cloud' ? 'whatsapp_cloud' : 'whatsapp'
    const type = source.type === 'group' ? 'group' : 'dm'
    const id = String(source.id || '').trim()
    const safe = { id, name: String(source.name || '').trim().slice(0, 160), type, platform } as WhatsappSource
    return [`${platform}:${id}`, safe]
  })).values()].filter(source => source.id && !(source.platform === 'whatsapp_cloud' && source.type === 'group'))
  if (mode === 'selected_chats' && sources.length === 0) {
    return { error: 'יש לבחור לפחות שיחה או קבוצה אחת.' }
  }
  return { policy: {
    version: 2,
    mode,
    behavior: behavior === 'assist' ? 'assist' : 'monitor',
    instructions: String(instructions).trim().slice(0, 2000),
    reply_chats: [...new Set(sources.filter(source => source.type === 'dm').map(source => normalizeChat(source.id)))],
    reply_groups: [...new Set(sources.filter(source => source.type === 'group').map(source => source.id))],
    sources
  } }
}

export function validateWhatsappPolicy(
  mode: WhatsappPolicyMode,
  chatsText: string,
  groups: string[] = [],
  behavior: WhatsappBehavior = 'monitor',
  instructions = ''
): PolicyValidation {
  const sources: WhatsappSource[] = [
    ...parseChatList(chatsText).map(id => ({ id, name: 'בחירה שמורה', type: 'dm' as const, platform: 'whatsapp' as const })),
    ...groups.map(id => ({ id, name: 'בחירה שמורה', type: 'group' as const, platform: 'whatsapp' as const }))
  ]
  return buildWhatsappPolicy(mode, sources, behavior, instructions)
}

export function describeWhatsappPolicy(policy: WhatsappPolicy): string {
  if (policy.mode === 'selected_chats') {
    const count = policy.sources?.length || policy.reply_chats.length + policy.reply_groups.length
    return `העוזר פעיל רק ב־${count} שיחות וקבוצות נבחרות. כל השאר נקראים ונשמרים בלבד.`
  }
  return 'קריאה בלבד: העוזר מתעד את ההודעות אך לעולם לא שולח תשובה או תגובה.'
}

// LIVE proof that the reply policy is actually being enforced by the RUNNING gateway —
// not merely that a policy FILE exists on disk. A file can be present while the plugin
// failed to load, the hook was not registered, or the gateway has not been reloaded
// since a config change. Only a positive live signal counts as protection.
export type WhatsappGuardStatus = {
  pluginLoaded: boolean // the business-whatsapp-policy plugin is loaded in the running gateway
  enforcing: boolean // its pre_gateway_dispatch reply-policy hook is active right now
  mode: WhatsappPolicyMode | null // the mode the LIVE guard reports enforcing
  replyChats?: number
}

// Parse a gateway introspection response (e.g. GET /api/plugins/business-whatsapp-policy
// or the desktop bridge equivalent) into a guard proof. Returns null unless the response
// POSITIVELY proves the plugin is loaded — a missing/partial/foreign shape fails closed
// to "no proof" so a connected channel reads UNKNOWN, never falsely protected.
export function interpretWhatsappGuard(raw: unknown): WhatsappGuardStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const pluginLoaded = r.plugin_loaded === true || r.loaded === true
  if (!pluginLoaded) return null
  const hooks = Array.isArray(r.hooks) ? r.hooks.map(String) : []
  const enforcing = r.enforcing === true || hooks.includes('pre_gateway_dispatch')
  const rawMode = typeof r.mode === 'string' ? r.mode : null
  const mode = rawMode === 'read_only' || rawMode === 'selected_chats' ? rawMode : null
  return { pluginLoaded, enforcing, mode, replyChats: typeof r.reply_chats === 'number' ? r.reply_chats : undefined }
}

// Honest enforcement-health verdict for the support panel. Protection requires a LIVE
// running-gateway guard proof, NOT a policy file: with no proof (undefined/null), or a
// plugin that is loaded-but-not-enforcing, a connected channel reads UNKNOWN/unprotected
// (error). Returns null when nothing is connected (no protection concern to show).
export type WhatsappProtectionInput = {
  cloudConnected: boolean
  qrConnected: boolean
  guard: WhatsappGuardStatus | null | undefined
}

export function describeWhatsappProtection(
  input: WhatsappProtectionInput
): { value: string; state: 'ok' | 'warning' | 'error' } | null {
  if (!input.cloudConnected && !input.qrConnected) return null
  const g = input.guard
  if (!g || !g.pluginLoaded || !g.enforcing) {
    return { value: 'לא ידוע אם ההגנה נאכפת בשרת — אין אישור חי מהשער הפעיל', state: 'error' }
  }
  if (g.mode !== 'read_only' && g.mode !== 'selected_chats') {
    return { value: 'ההגנה טעונה בשרת אך ללא מדיניות מענה תקפה — בדוק את רכיב ההגנה', state: 'error' }
  }
  if (g.mode === 'read_only') return { value: 'קריאה בלבד (מוגן, נאכף בשרת)', state: 'ok' }
  return { value: `מענה לנבחרים בלבד (${g.replyChats ?? '?'}) — נאכף בשרת`, state: 'ok' }
}
