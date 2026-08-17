// The ONE canonical agent-handoff payload. Both the React/Electron wrapper and the
// Hermes Desktop plugin build the argument dispatched to the first-run Skill from
// here, so the product intent (one concise question at a time, connect official
// integrations, confirm before sensitive actions, no false completion, persist into
// Profile/Memory/Skills — never a giant system prompt) lives in a single place.

import { normalizeOnboarding } from './onboarding-contract.js'
import { resolveProviderStatus, resolveModelReadiness } from './provider-readiness.js'

// The first conversation after an install, before anything is known about what the
// user wants tachles for. It senses business vs community from the answer and then
// continues into the matching bootstrap Skill.
export const WELCOME_COMMAND = 'tachles-welcome'

// The business onboarding conversation. Still dispatched directly whenever the
// business role is already established (e.g. the plugin's fallback questionnaire).
export const BOOTSTRAP_COMMAND = 'business-bootstrap'

const LINES = [
  "פתח את השיחה הראשונה בתכל'ס. The user should start working, not complete a setup interview.",
  'המעטפת ביצעה בדיקה תחומה דרך ה־APIs הרשמיים של Hermes. Use this verified snapshot and do not repeat its checks before asking the first missing question.',
  'Never run hermes doctor, broad scans, connectivity suites, update checks, or CLI --help discovery during onboarding.',
  'שאל שאלה אחת קצרה בכל פעם (לכל היותר שתי שאלות קרובות), ורק אם היא נחוצה כדי לקדם את הבקשה — אין שאלון התקנה.',
  // Role-neutral: the same payload now also opens a community-only first run, so the
  // business-context Skill is named as a conditional, not as an unconditional step.
  'אל תבקש שוב מידע שכבר נמסר. שמור עובדות יציבות דרך Hermes Memory/Profile; אם מדובר בעבודה עסקית — תחזק גם Skill בשם business-context. אל תיצור System Prompt גדול.',
  'הצע אינטגרציה או חיבור רשמי אחד רק כאשר הבקשה הנוכחית זקוקה לו; הסבר את הערך ואשר עם המשתמש לפני פעולה רגישה.',
  'אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.',
  'אל תסמן סיום אם אין ספק/מודל זמין או שחיבור שהוצהר לא עבר בדיקת קריאה בטוחה; אפשר להשהות ולחזור להשלים.',
  // provider_state glossary — short sentences on purpose: this is prompt text
  // the model must actually parse, not a machine note.
  'משמעות provider_state בתמונת המצב:',
  'usable — הספק הוכח חי; המשך כרגיל.',
  'configured — נבחר ספק/מודל אך המעטפת לא צפתה בסיבוב חי. התשובה המוצלחת שלך בשיחה הזו היא בעצמה ההוכחה — התייחס למצב הזה כ־usable והמשך.',
  'runtime_only או unavailable — לא נמצא ספק, אחרי שכל המקורות הרשמיים נבדקו.',
  'unknown — מקור רשמי (ראה provider_sources) נכשל או לא נבדק. עצור ואמת מחדש; אל תסמן סיום כוזב ואל תיכשל כוזב.'
]

export function buildBootstrapPrompt(input = {}) {
  const { snapshot = {}, data } = input
  const lines = [...LINES, '', `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(snapshot)}`]
  if (data) lines.push('', JSON.stringify(normalizeOnboarding(data), null, 2))
  return lines.join('\n')
}

// React/Electron snapshot. Honest provider_ready: prefers an already-resolved
// ProviderStatus, else resolves from raw oauth/env; runtime uptime alone is NOT it.
export function buildVerifiedSnapshot(input = {}) {
  const { runtime, skills = [], tasks = [], connections = [], providerStatus, oauthProviders, env, error } = input
  const status = providerStatus || resolveProviderStatus({ runtime, oauthProviders, env, error })
  return {
    provider_ready: status.provider_ready,
    provider_state: status.provider_state,
    provider_label: status.provider_label,
    // Honest configured-vs-usable, so the durable receipt records provider facts from
    // authoritative state (a configured key is NOT proof of usability).
    provider_configured: status.provider_configured === true,
    provider_usable: status.provider_usable === true,
    provider_sources: status.provider_sources,
    runtime_running: Boolean(runtime && runtime.running),
    hermes_version: runtime && runtime.version ? runtime.version : null,
    skills: skills.map(skill => skill && skill.name).filter(Boolean).slice(0, 100),
    scheduled_tasks: tasks.length,
    connections: connections.map(connection => ({
      id: connection.id,
      state: connection.state,
      official: connection.official !== false
    }))
  }
}

// Plugin snapshot: same honest contract, driven by the model id the plugin can see.
export function buildModelSnapshot(input = {}) {
  const { model, gateway, profile, skills = [], scheduledTasks = 0 } = input
  const status = resolveModelReadiness(model)
  return {
    provider_ready: status.provider_ready,
    provider_state: status.provider_state,
    provider_label: status.provider_label,
    model: model || null,
    gateway,
    profile: profile || 'default',
    skills: skills.slice(0, 100),
    scheduled_tasks: scheduledTasks
  }
}
