import { PROVIDER_API_KEYS } from './hermes/core'
import type { OAuthProvider } from './hermes/providers'

// Map the LIVE Hermes provider catalog (`GET /api/providers/oauth`) onto the
// provider modal's option list (user decision 2026-08-04: render the full
// catalog, not a curated subset). Every provider lands on exactly one of THREE
// UI shapes, keyed off the catalog's own `flow` field:
//
//   device-flow — code + browser + poll: the flow already built for Codex,
//                 parameterized by provider id (nous, minimax, xai, ...)
//   api-key     — the existing paste-a-key form (env-key providers; the
//                 catalog's `anthropic` card IS its API-key card)
//   external    — display-only card: managed by an outside CLI (qwen, copilot,
//                 claude-code, and any future plugin provider)
//
// Fail-safe: an unrecognized `flow` renders as `external` — a safe, honest
// info card — never a broken interactive flow. `pkce` (browser + paste-back
// code) has no wired gateway door in this product yet, so a non-anthropic pkce
// provider also falls back to the external card rather than a flow we cannot
// complete.

export type ProviderUi = 'codex-oauth' | 'device-flow' | 'api-key' | 'external'

export type ProviderOption = {
  id: string
  label: string
  ui: ProviderUi
  cliCommand?: string
  docsUrl?: string
  loggedIn: boolean
}

// Hebrew display labels for the ids we know; an unknown id keeps the catalog's
// own English name (honest, and it still renders safely as an external card).
const HEBREW_LABELS: Record<string, string> = {
  nous: 'Nous Portal — חשבון חינם להתחלה',
  'openai-codex': 'OpenAI Codex — חיבור ChatGPT',
  'qwen-oauth': 'Qwen — מתחברים דרך Qwen CLI',
  'minimax-oauth': 'MiniMax — חיבור עם חשבון',
  'xai-oauth': 'xAI Grok — חיבור עם מנוי',
  'copilot-acp': 'GitHub Copilot — מתחברים דרך CLI',
  anthropic: 'Anthropic — API key',
  'claude-code': 'Claude Code — מנוי Anthropic (דרך CLI)',
  openrouter: 'OpenRouter — API key',
  openai: 'OpenAI API — API key',
  gemini: 'Google Gemini — API key'
}

// The pre-catalog hardcoded list, kept as the STATIC FALLBACK for when the
// catalog read fails: the user must never be left without a way to connect.
const STATIC_FALLBACK: ProviderOption[] = [
  { id: 'openai-codex', label: HEBREW_LABELS['openai-codex'], ui: 'codex-oauth', loggedIn: false },
  { id: 'openrouter', label: HEBREW_LABELS.openrouter, ui: 'api-key', loggedIn: false },
  { id: 'anthropic', label: HEBREW_LABELS.anthropic, ui: 'api-key', loggedIn: false },
  { id: 'openai', label: HEBREW_LABELS.openai, ui: 'api-key', loggedIn: false },
  { id: 'gemini', label: HEBREW_LABELS.gemini, ui: 'api-key', loggedIn: false }
]

export function staticFallbackOptions(): ProviderOption[] {
  return STATIC_FALLBACK.map(option => ({ ...option }))
}

function uiFor(entry: OAuthProvider): ProviderUi {
  // Codex keeps its dedicated component: it carries the existing-grant liveness
  // probe and the strings the packaged E2E pins.
  if (entry.id === 'openai-codex') return 'codex-oauth'
  // The catalog's `anthropic` pkce card is literally its API-key card — our
  // validated paste-a-key path already covers it.
  if (entry.id in PROVIDER_API_KEYS) return 'api-key'
  if (entry.flow === 'device_code') return 'device-flow'
  // `external`, unknown flows, and un-wired `pkce` providers: display-only card.
  return 'external'
}

/**
 * Build the provider modal's option list from the live catalog. `catalog` is
 * null (read failed) or empty ⇒ the static fallback. API-key-only providers
 * that Hermes does not list on its accounts catalog (openrouter/openai/gemini)
 * are appended after the catalog entries so the paste-a-key path stays reachable.
 */
export function buildProviderOptions(catalog: OAuthProvider[] | null | undefined): ProviderOption[] {
  if (!Array.isArray(catalog) || catalog.length === 0) return staticFallbackOptions()
  const options: ProviderOption[] = []
  const seen = new Set<string>()
  for (const entry of catalog) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) continue
    seen.add(entry.id)
    options.push({
      id: entry.id,
      label: HEBREW_LABELS[entry.id] || entry.name || entry.id,
      ui: uiFor(entry),
      cliCommand: entry.cli_command,
      docsUrl: entry.docs_url,
      loggedIn: Boolean(entry.status?.logged_in)
    })
  }
  // A catalog that yielded nothing renderable is a failed read, not an empty
  // product — fall back BEFORE appending the api-key extras, so a stream of
  // malformed entries cannot masquerade as a keys-only product.
  if (!options.length) return staticFallbackOptions()
  for (const id of Object.keys(PROVIDER_API_KEYS)) {
    if (seen.has(id)) continue
    options.push({ id, label: HEBREW_LABELS[id] || id, ui: 'api-key', loggedIn: false })
  }
  return options
}
