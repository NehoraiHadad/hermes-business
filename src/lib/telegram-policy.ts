// Shared, pure helpers for the fail-closed Telegram reply policy. The Electron
// main process (electron/telegram-policy.cjs) and the Hermes plugin
// (hermes-plugin/business-whatsapp-policy/telegram_policy.py) are the
// authoritative enforcers; this module mirrors their normalization so the UI
// validates and previews identically before persisting through the desktop
// bridge. Unlike WhatsApp, Telegram exposes a third "full access" mode; the
// safest option is read-only and it is always the default.

export type TelegramPolicyMode = 'full_access' | 'read_only' | 'selected_chats'

export type TelegramPolicy = {
  version: 1
  mode: TelegramPolicyMode
  reply_chats: string[]
}

export const TELEGRAM_MODES: readonly TelegramPolicyMode[] = [
  'full_access',
  'read_only',
  'selected_chats'
]

export const DEFAULT_TELEGRAM_POLICY: TelegramPolicy = {
  version: 1,
  mode: 'read_only',
  reply_chats: []
}

// Canonicalize a Telegram identifier (numeric user/chat id or @username) to the
// exact string the plugin matches on. Keep in lockstep with
// normalize_identifier() in telegram_policy.py and normalizeTelegram() in
// electron/telegram-policy.cjs: numeric ids fold to str(int) (sign kept, leading
// zeros dropped); usernames drop a leading '@' and lower-case (case-insensitive).
export function normalizeTelegram(value: string): string {
  let raw = String(value || '')
    .trim()
    .replace(/^telegram:/i, '')
    .replace(/^@/, '')
  if (!raw) return ''
  if (/^-?\d+$/.test(raw)) {
    const negative = raw.startsWith('-')
    const digits = raw.replace(/^-/, '').replace(/^0+(?=\d)/, '')
    return negative && digits !== '0' ? `-${digits}` : digits
  }
  return raw.toLowerCase()
}

export function parseTelegramList(text: string): string[] {
  return [...new Set(String(text || '').split(/[,\n]/).map(normalizeTelegram).filter(Boolean))]
}

export function telegramChatsToText(chats: string[]): string {
  return (chats || []).join('\n')
}

export type TelegramPolicyValidation = { policy: TelegramPolicy } | { error: string }

export function validateTelegramPolicy(
  mode: TelegramPolicyMode,
  chatsText: string
): TelegramPolicyValidation {
  const reply_chats = parseTelegramList(chatsText)
  if (mode === 'selected_chats' && reply_chats.length === 0) {
    return { error: 'יש לבחור לפחות משתמש או קבוצה אחת שבהם מותר לעוזר לענות.' }
  }
  return { policy: { version: 1, mode, reply_chats } }
}

export function describeTelegramPolicy(policy: TelegramPolicy): string {
  if (policy.mode === 'full_access') {
    return 'גישה מלאה: העוזר עונה לכל משתמש שמורשה על ידי Telegram/Hermes.'
  }
  if (policy.mode === 'selected_chats') {
    const count = policy.reply_chats.length
    return `העוזר עונה רק ל־${count} משתמשים/קבוצות נבחרים. כל השאר נקראים ונשמרים בלבד.`
  }
  return 'קריאה בלבד: העוזר מתעד את ההודעות אך לעולם לא שולח תשובה או תגובה.'
}
