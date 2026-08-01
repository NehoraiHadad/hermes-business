import { useEffect, useState } from 'react'
import { applyPartner, loadPartnerState } from '../../lib/partner'
import { PartnerModeSelector } from '../PartnerModeSelector'

// Durable normal-vs-partner choice during onboarding. It writes through the same
// backend the settings screen uses, so the decision persists across restarts and
// is reflected everywhere. No sandbox folders are chosen here — that stays in
// settings, and with no writable roots this never triggers a runtime restart.
export function OnboardingPartnerChoice() {
  const [mode, setMode] = useState<PartnerMode>('normal')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    loadPartnerState()
      .then(state => {
        if (active) setMode(state.mode)
      })
      .catch(() => {
        /* keep the default 'normal' — a failed read is never treated as partner */
      })
    return () => {
      active = false
    }
  }, [])

  // Never leaks an unhandled rejection: on failure we reconcile the shown mode back to
  // the true persisted state rather than leaving an optimistic value or throwing.
  const choose = async (next: PartnerMode) => {
    setMode(next)
    setBusy(true)
    try {
      const state = await applyPartner({ mode: next })
      setMode(state.mode)
    } catch {
      const actual = await loadPartnerState().catch(() => null)
      if (actual) setMode(actual.mode)
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="onboarding-partner">
      <legend>איך תרצה שהעוזר יעבוד?</legend>
      <PartnerModeSelector mode={mode} onChange={next => void choose(next)} disabled={busy} />
      <p className="onboarding-partner__hint">
        אפשר לשנות זאת בכל רגע במסך התמיכה. מצב שותף לעולם אינו שולח, מוציא כסף או מוחק בלי אישור מפורש.
      </p>
    </fieldset>
  )
}
