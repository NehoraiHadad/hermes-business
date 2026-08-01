// The ONE canonical agent-handoff payload. Both the React/Electron wrapper and the
// Hermes Desktop plugin build their /business-bootstrap prompt and verified snapshot
// from here, so the product intent (one concise question at a time, connect official
// integrations, confirm before sensitive actions, no false completion, persist into
// Profile/Memory/Skills — never a giant system prompt) lives in a single place.

import { normalizeOnboarding } from './onboarding-contract.js'
import { resolveProviderStatus, resolveModelReadiness } from './provider-readiness.js'

export const BOOTSTRAP_COMMAND = '/business-bootstrap'

const LINES = [
  'המשך את הקמת העוזר לעסק. This is guided first-run setup for a non-technical business owner.',
  'המעטפת ביצעה בדיקה תחומה דרך ה־APIs הרשמיים של Hermes. Use this verified snapshot and do not repeat its checks before asking the first missing question.',
  'Never run hermes doctor, broad scans, connectivity suites, update checks, or CLI --help discovery during onboarding.',
  'שאל שאלה אחת קצרה בכל פעם (לכל היותר שתי שאלות קרובות) והסבר בקצרה למה — אל תציג את כל השאלון בבת אחת.',
  'אל תבקש שוב מידע שכבר נמסר. שמור עובדות יציבות דרך Hermes Memory/Profile ותחזק Skill בשם business-context; אל תיצור System Prompt גדול.',
  'המלץ בכל פעם על אינטגרציה/חיבור רשמי אחד בעל הערך המיידי הגבוה ביותר, הסבר את הערך, ואשר עם המשתמש לפני כל פעולה רגישה.',
  'אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.',
  'אל תסמן סיום אם אין ספק/מודל זמין או שחיבור שהוצהר לא עבר בדיקת קריאה בטוחה; אפשר להשהות ולחזור להשלים.',
  'provider_state semantics: usable=proven live; configured=a model/provider is selected but the wrapper did not observe a round-trip — YOUR own successful reply in this session IS that usability proof, so treat configured+a real answer as usable and proceed (never a false-negative deadlock); runtime_only/unavailable=no provider found (all official sources inspected); unknown=an official source (see provider_sources) failed/was not inspected — pause and re-verify, never falsely complete NOR falsely fail.'
]

export function buildBootstrapPrompt(input = {}) {
  const { snapshot = {}, data } = input
  const lines = [BOOTSTRAP_COMMAND, ...LINES, '', `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(snapshot)}`]
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
