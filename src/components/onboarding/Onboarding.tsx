import { ArrowLeft, Download, LoaderCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { EMPTY_ONBOARDING } from '../../constants'
import type { Connection, OnboardingData } from '../../types'
import { Logo } from '../ui/Logo'
import { OnboardingStep } from './OnboardingSteps'

export function Onboarding({
  runtime,
  connections,
  installing,
  installError,
  onInstall,
  onComplete,
  onProvider,
  onConnection
}: {
  runtime: HermesRuntime | null
  connections: Connection[]
  installing: boolean
  installError: string
  onInstall: () => Promise<unknown>
  onComplete: (data: OnboardingData) => Promise<void>
  onProvider: () => void
  onConnection: (id: string) => void
}) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState(EMPTY_ONBOARDING)
  const [saving, setSaving] = useState(false)
  const [completeError, setCompleteError] = useState('')
  const total = 5
  const patch = (values: Partial<OnboardingData>) => setData(current => ({ ...current, ...values }))

  const continueFromWelcome = async () => {
    if (!runtime?.running) {
      try {
        await onInstall()
      } catch {
        return
      }
    }
    setStep(2)
  }

  return (
    <div className="onboarding">
      <section className="onboarding__card">
        <div className="onboarding__brand">
          <Logo />
          <strong>העוזר לעסק</strong>
        </div>
        <div className="onboarding__progress">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={index + 1 <= step ? 'active' : ''} />
          ))}
          <small>שלב {step} מתוך {total}</small>
        </div>

        <OnboardingStep
          step={step}
          data={data}
          patch={patch}
          runtime={runtime}
          connections={connections}
          installError={installError}
          onProvider={onProvider}
          onConnection={onConnection}
        />

        <div className="onboarding__footer">
          {step > 1 ? (
            <button className="ghost-button" onClick={() => setStep(value => value - 1)}>
              חזרה
            </button>
          ) : (
            <span />
          )}
          {step === 1 ? (
            <button className="primary-button" disabled={installing || runtime === null} onClick={() => void continueFromWelcome()}>
              {installing || runtime === null ? (
                <LoaderCircle className="spin" size={16} />
              ) : runtime.running ? null : (
                <Download size={16} />
              )}
              {installing
                ? 'מתקין ומפעיל…'
                : runtime === null
                  ? 'בודק את Hermes…'
                  : runtime.running
                    ? 'המשך'
                    : runtime.error
                      ? 'נסה להפעיל את Hermes שוב'
                    : 'התקן את Hermes והמשך'}
              {!installing && runtime?.running ? <ArrowLeft size={16} /> : null}
            </button>
          ) : step < total ? (
            <button className="primary-button" onClick={() => setStep(value => value + 1)}>
              המשך <ArrowLeft size={16} />
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={saving || !runtime?.running}
              onClick={async () => {
                setSaving(true)
                setCompleteError('')
                try {
                  await onComplete(data)
                } catch (caught) {
                  // Fail closed: durable completion was not confirmed, so stay on
                  // onboarding and tell the user instead of silently "finishing".
                  setCompleteError(
                    caught instanceof Error ? caught.message : 'לא ניתן היה לשמור את ההיכרות ב־Hermes. נסה שוב.'
                  )
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
              פתח שיחה עם העוזר
            </button>
          )}
        </div>
        {completeError ? <p className="form-error onboarding__error">{completeError}</p> : null}
      </section>
    </div>
  )
}
