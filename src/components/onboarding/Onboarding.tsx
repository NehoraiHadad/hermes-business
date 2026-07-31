import { ArrowLeft, LoaderCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { EMPTY_ONBOARDING } from '../../constants'
import type { OnboardingData } from '../../types'
import { Logo } from '../ui/Logo'
import { OnboardingStep } from './OnboardingSteps'

// The onboarding wizard shell: brand, step progress and navigation. Each step's
// content lives in ./OnboardingSteps so this file stays focused on flow control.
export function Onboarding({
  runtime,
  onComplete,
  onProvider
}: {
  runtime: HermesRuntime | null
  onComplete: (data: OnboardingData) => Promise<void>
  onProvider: () => void
}) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState(EMPTY_ONBOARDING)
  const [saving, setSaving] = useState(false)
  const total = 5
  const patch = (values: Partial<OnboardingData>) => setData(current => ({ ...current, ...values }))
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
          <small>
            שלב {step} מתוך {total}
          </small>
        </div>

        <OnboardingStep step={step} data={data} patch={patch} runtime={runtime} onProvider={onProvider} />

        <div className="onboarding__footer">
          {step > 1 ? (
            <button className="ghost-button" onClick={() => setStep(value => value - 1)}>
              חזרה
            </button>
          ) : (
            <span />
          )}
          {step < total ? (
            <button className="primary-button" onClick={() => setStep(value => value + 1)}>
              המשך <ArrowLeft size={16} />
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                await onComplete(data)
                setSaving(false)
              }}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
              פתח שיחה עם העוזר
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
