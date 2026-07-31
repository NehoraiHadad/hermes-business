// Shared, pure helpers for the fail-closed WhatsApp reply policy. The Electron
// main process (electron/whatsapp-policy.cjs) and the Hermes plugin
// (hermes-plugin/business-whatsapp-policy/policy.py) are the authoritative
// enforcers; this module mirrors their normalization so the UI validates and
// previews identically before persisting through the desktop bridge.

export type WhatsappPolicyMode = 'read_only' | 'selected_chats'

export type WhatsappPolicy = {
  version: 1
  mode: WhatsappPolicyMode
  reply_chats: string[]
}

export const DEFAULT_WHATSAPP_POLICY: WhatsappPolicy = {
  version: 1,
  mode: 'read_only',
  reply_chats: []
}

// Reduce any chat identifier (phone, +phone, whatsapp:JID, @s.whatsapp.net) to
// the bare digits the plugin matches on. Keep this in lockstep with
// normalizeChat() in electron/whatsapp-policy.cjs.
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

export function validateWhatsappPolicy(mode: WhatsappPolicyMode, chatsText: string): PolicyValidation {
  const reply_chats = parseChatList(chatsText)
  if (mode === 'selected_chats' && reply_chats.length === 0) {
    return { error: 'יש לבחור לפחות צ׳אט אחד שבו מותר לעוזר לענות.' }
  }
  return { policy: { version: 1, mode, reply_chats } }
}

export function describeWhatsappPolicy(policy: WhatsappPolicy): string {
  if (policy.mode === 'selected_chats') {
    const count = policy.reply_chats.length
    return `העוזר עונה רק ל־${count} צ׳אטים נבחרים. כל השאר נקראים ונשמרים בלבד.`
  }
  return 'קריאה בלבד: העוזר מתעד את ההודעות אך לעולם לא שולח תשובה או תגובה.'
}
