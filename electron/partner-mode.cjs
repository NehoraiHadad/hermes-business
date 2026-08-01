const { putConfig } = require('./hermes-config.cjs')
const { PERSONALITY_NAME, PERSONALITY_PROMPT } = require('./partner-personality.cjs')

// Installs and selects the Business Partner personality on the ONE Hermes
// `default` profile through native config only — SOUL.md is never touched. This
// writes JUST the personality: the named definition under `agent.personalities`
// and the `display.personality` selector.
//
// The safe approval/delegation/terminal posture is pinned by sandbox-config.cjs in
// the same apply, and the reversible, versioned backup/restore of every field this
// feature owns — including display.personality — lives in partner-config.cjs. So
// there is no backup logic here and no competing config engine: this module only
// asserts the persona forward. The named personality definition is deliberately
// LEFT installed when partner mode is disabled (harmless while unselected) so
// re-enabling is instantaneous; disabling only flips display.personality back via
// partner-config.restoreOwned.
async function applyPersona(api) {
  await putConfig(
    {
      agent: { personalities: { [PERSONALITY_NAME]: PERSONALITY_PROMPT } },
      display: { personality: PERSONALITY_NAME }
    },
    api
  )
}

module.exports = { applyPersona }
