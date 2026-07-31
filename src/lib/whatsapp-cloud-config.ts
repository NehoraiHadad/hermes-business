import type { WhatsappCloudCredentials } from './hermes/whatsapp-rest'

export type CloudCredentialDraft = Omit<WhatsappCloudCredentials, 'verifyToken'>

export function validateCloudCredentials(
  draft: CloudCredentialDraft
): { credentials: CloudCredentialDraft } | { error: string } {
  const phoneNumberId = draft.phoneNumberId.trim()
  const accessToken = draft.accessToken.trim()
  const appSecret = draft.appSecret.trim()

  if (!/^\d{13,20}$/.test(phoneNumberId)) {
    return { error: 'Phone Number ID צריך להיות המזהה המספרי של Meta ‏(13–20 ספרות), לא מספר הטלפון.' }
  }
  if (!accessToken.startsWith('EAA') || accessToken.length < 80) {
    return { error: 'נדרש Access Token של Meta שמתחיל ב־EAA. אין להדביק כאן מפתח של ספק ה־AI.' }
  }
  if (!/^[0-9a-fA-F]{32}$/.test(appSecret)) {
    return { error: 'App Secret צריך להכיל בדיוק 32 תווי hexadecimal מתוך הגדרות האפליקציה ב־Meta.' }
  }
  return { credentials: { phoneNumberId, accessToken, appSecret } }
}

export function createVerifyToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function webhookCallback(publicBaseUrl: string): string {
  const base = publicBaseUrl.trim().replace(/\/+$/, '')
  return base ? `${base}/whatsapp/webhook` : '/whatsapp/webhook'
}
