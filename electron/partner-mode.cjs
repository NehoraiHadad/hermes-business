const { getConfig, putConfig } = require('./hermes-config.cjs')
const { PERSONALITY_NAME, PERSONALITY_PROMPT } = require('./partner-personality.cjs')

// Enables/disables the Business Partner personality on the ONE existing Hermes
// `default` profile through native config only. SOUL.md is never touched. The
// switch is just config.display.personality; the named personality definition is
// installed once and left in place. Enabling also pins the safe approval posture:
// manual approvals, cron deny, no sub-agent auto-approve.

// Capture the exact previous display.personality the first time partner mode is
// turned on, so disabling restores it byte-for-byte. If partner mode is already
// active we must NOT recapture (that would overwrite the real backup with our own
// injected value) — this is what makes enable idempotent.
async function enablePersonality(previousBackup, api) {
  const config = await getConfig(api)
  const display = (config && config.display) || {}
  const alreadyActive = display.personality === PERSONALITY_NAME
  const backup =
    alreadyActive && previousBackup
      ? previousBackup
      : { display: typeof display.personality === 'string' ? display.personality : null }

  // Hermes reads personalities from `agent.personalities` and selects one via the
  // separate `display.personality` string. The value is a plain prompt string.
  // Deep-merge server-side means agent.personalities is extended, not replaced.
  await putConfig(
    {
      agent: { personalities: { [PERSONALITY_NAME]: PERSONALITY_PROMPT } },
      display: { personality: PERSONALITY_NAME },
      approvals: { mode: 'manual', cron_mode: 'deny' },
      delegation: { subagent_auto_approve: false }
    },
    api
  )
  return { backup, personality: PERSONALITY_NAME }
}

// Restore the captured previous personality. Deep-merge cannot delete a key, so
// an absent previous value is restored as null (Hermes falls back to its default
// personality). The named personality definition is intentionally left in config.
async function disablePersonality(previousBackup, api) {
  const restore = previousBackup && typeof previousBackup.display === 'string' ? previousBackup.display : null
  await putConfig({ display: { personality: restore } }, api)
  return { restored: restore }
}

module.exports = { enablePersonality, disablePersonality }
